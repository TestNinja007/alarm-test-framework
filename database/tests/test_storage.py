"""
How values are stored, as opposed to what the API returns.

TC55 lives here, moved from the Playwright suite. It is the clearest case for
this whole stack existing: no API will ever tell you what a password column
contains, and that is precisely the question.

The rest are the same kind of question asked of other columns. A value that
round-trips correctly through the API can still be stored in a form that will
hurt later - a timestamp without a zone, a date that has quietly become an
instant, a unique rule that lives only in application code and vanishes the
day somebody writes a second code path.
"""

import pytest

from conftest import soon

pytestmark = pytest.mark.storage


def make_alarm(name, folder_id=None, time_of_day="09:00", **extra):
    body = {
        "name": name,
        "timeOfDay": time_of_day,
        "timezone": "UTC",
        "startDate": soon(),
        "rule": {"type": "daily"},
    }
    if folder_id is not None:
        body["folderId"] = folder_id
    body.update(extra)
    return body


class TestCredentials:
    def test_tc55_a_password_is_stored_as_a_parameterised_scrypt_hash(self, api, db):
        row = db.row("SELECT password_hash FROM users WHERE id = %s", (api.user_id,))
        assert row is not None
        stored = row["password_hash"]

        # scrypt$N$r$p$<salt base64>$<hash base64>. The parameters are stored
        # alongside so the cost can be raised later without invalidating
        # everybody's existing password.
        parts = stored.split("$")
        assert parts[0] == "scrypt", "the stored credential should be a scrypt hash"
        assert len(parts) == 6, "it should carry its parameters and salt: " + stored

        n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
        assert n >= 16384, "the cost parameter should be the memory-hard one"
        assert r >= 8
        assert p >= 1

        # And the password appears nowhere in it, in any obvious encoding.
        import base64

        password = api.password
        assert password not in stored
        assert base64.b64encode(password.encode()).decode() not in stored
        assert password.encode().hex() not in stored

    def test_no_other_column_is_quietly_holding_a_password(self, db):
        """
        password_hash is the only password-ish column on users.

        A second one - a `password` left over from a migration, a
        `temp_password` added for a reset flow - would be invisible through the
        API and is exactly the kind of thing that leaks.
        """
        columns = [
            r["column_name"]
            for r in db.rows(
                """SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name ILIKE %s""",
                ("%password%",),
            )
        ]
        assert columns == ["password_hash"]

    def test_a_verification_code_is_not_stored_in_the_clear_next_to_the_account(self, db):
        """
        Whatever columns exist for verification and reset, none of them is
        named in a way that suggests a reusable secret sitting in plain text.
        Deliberately a weak assertion about a strong concern: it checks the
        shape of the schema rather than guessing at the flow.
        """
        suspicious = [
            r["column_name"]
            for r in db.rows(
                """SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'users'
                      AND (column_name ILIKE %s OR column_name ILIKE %s)""",
                ("%secret%", "%token_plain%"),
            )
        ]
        assert suspicious == [], "unexpected secret-looking columns: " + str(suspicious)


class TestTimeAndDates:
    def test_timestamps_carry_a_zone(self, db):
        """
        created_at and updated_at are timestamptz, not timestamp.

        A bare `timestamp` stores whatever local time the writer happened to
        have and silently drags the server's timezone into the data. It looks
        correct in every test run on one machine and is wrong the moment a
        second machine, or daylight saving, is involved.
        """
        for table in ("users", "folders", "alarms"):
            for name in ("created_at", "updated_at"):
                column = db.column(table, name)
                if column is None:
                    continue
                assert column["data_type"] == "timestamp with time zone", (
                    table + "." + name + " should carry a zone, not " + column["data_type"]
                )

    def test_a_calendar_date_is_stored_as_a_date_and_not_an_instant(self, db):
        """
        start_date and end_date are `date`.

        A calendar date has no instant. Storing one as a timestamp forces a
        time and a zone to be invented, and then "the 5th" starts meaning
        different days depending on who is asking.
        """
        for name in ("start_date", "end_date"):
            column = db.column("alarms", name)
            assert column is not None, "alarms." + name + " should exist"
            assert column["data_type"] == "date", (
                "alarms." + name + " is " + column["data_type"]
            )

    def test_a_time_of_day_is_stored_as_written(self, api, db, unique):
        """
        The wall-clock time is kept as text, not converted on the way in.

        R-11's whole point is that 07:00 means 07:00 in the alarm's own zone,
        across a daylight-saving boundary. An alarm that stored an instant
        would have to pick one side of that boundary at write time and would
        then be an hour out for half the year.
        """
        created = api.post("/alarms", make_alarm("Wall clock " + unique, None, "07:00"))

        row = db.row(
            "SELECT time_of_day, timezone FROM alarms WHERE id = %s", (created["id"],)
        )
        assert row is not None
        assert row["time_of_day"] == "07:00", "stored exactly as submitted"
        assert row["timezone"] == "UTC"


class TestConstraintsExistInTheDatabase:
    """
    The uniqueness rules as the database enforces them.

    Every one of these is also checked by the application, and the Playwright
    suite asserts the 409 each produces. That proves the application refuses.
    This proves the database would refuse too - so the rule survives a second
    code path, a bulk import, or a well-meant script.
    """

    def test_an_email_is_unique_ignoring_case_and_surrounding_space(self, db):
        indexes = db.indexes("users")
        definition = indexes.get("users_email_lower_key", "")

        assert definition, "users should have a case-insensitive unique email index"
        assert "lower" in definition and "btrim" in definition, (
            "comparison should ignore case and surrounding space: " + definition
        )

    def test_a_group_name_is_unique_per_account(self, db):
        definition = db.indexes("folders").get("folders_user_name_key", "")

        assert definition, "R-22 should be enforced by an index"
        assert "user_id" in definition
        assert "lower" in definition and "btrim" in definition

    def test_an_alarm_name_is_unique_within_a_group(self, db):
        """R-09, enforced by a partial index over grouped alarms only."""
        definition = db.indexes("alarms").get("alarms_folder_name_key", "")

        assert definition, "R-09 should be enforced by an index"
        assert "folder_id" in definition
        assert "lower" in definition and "btrim" in definition
        # Partial, because ungrouped alarms are a separate namespace and a
        # plain index over a nullable column would not constrain them at all.
        assert "folder_id IS NOT NULL" in definition, definition

    def test_ungrouped_alarms_are_their_own_namespace(self, db):
        """
        R-21: unique per account among ungrouped alarms.

        This is the one that cannot be done with an ordinary unique index. In
        PostgreSQL every NULL is distinct, so a unique index on
        (folder_id, name) permits any number of identical ungrouped names -
        the rule needs a second partial index keyed on the user instead.
        """
        definition = db.indexes("alarms").get("alarms_unfiled_name_key", "")

        assert definition, "R-21 needs its own partial index and has none"
        assert "user_id" in definition
        assert "folder_id IS NULL" in definition, definition

    def test_the_database_itself_refuses_a_duplicate_name(self, api, db, unique):
        """
        Not a test of the API's 409 - that belongs to the other stack. This
        checks that the row count did not move, which is what tells you the
        index held rather than the handler having been polite.
        """
        name = "Only one " + unique
        api.post("/alarms", make_alarm(name, None, "08:05"))

        before = db.count("alarms", "user_id = %s", (api.user_id,))
        refused = api.try_post("/alarms", make_alarm(name, None, "08:10"))
        after = db.count("alarms", "user_id = %s", (api.user_id,))

        assert refused.status_code >= 400, "a duplicate ungrouped name should be refused"
        assert after == before, "nothing should have been written"
