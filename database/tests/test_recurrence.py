"""
Recurrence data as stored, rather than as returned.

The rule is a jsonb column, which makes this the most interesting table in the
schema to look at directly. Everything else is a scalar that either matches or
does not; a rule is a structure the application writes, the database normalises,
and the application reads back - and there are three places for those to
disagree.

The sharpest case is R-03. Duplicate weekdays are de-duplicated rather than
rejected, and the API returns a tidy list either way. Whether the duplicates
were removed *before* storage or only on the way out is invisible from the
interface and matters a great deal: a row still holding ["MO","MO"] behaves
correctly only for as long as every reader remembers to de-duplicate it.
"""

import pytest

from conftest import soon

pytestmark = pytest.mark.recurrence


def make_alarm(name, rule, time_of_day="09:00", **extra):
    body = {
        "name": name,
        "timeOfDay": time_of_day,
        "timezone": "UTC",
        "startDate": soon(),
        "rule": rule,
    }
    body.update(extra)
    return body


def stored_rule(db, alarm_id):
    row = db.row("SELECT rule FROM alarms WHERE id = %s", (alarm_id,))
    assert row is not None, "the alarm should exist in the database"
    return row["rule"]


class TestTheRuleSurvivesStorage:
    def test_a_daily_rule_is_stored_as_submitted(self, api, db, unique):
        created = api.post("/alarms", make_alarm("Daily " + unique, {"type": "daily"}, "09:01"))

        assert stored_rule(db, created["id"]) == {"type": "daily"}

    def test_a_weekly_rule_keeps_its_weekdays(self, api, db, unique):
        rule = {"type": "weekly", "byWeekday": ["MO", "WE", "FR"]}
        created = api.post("/alarms", make_alarm("Weekly " + unique, rule, "09:02"))

        assert stored_rule(db, created["id"]) == rule

    def test_r03_duplicate_weekdays_are_de_duplicated_before_storage(
        self, api, db, unique
    ):
        """
        The row itself must not hold duplicates.

        R-03 de-duplicates rather than rejecting, and the API's response looks
        identical whether that happened on write or on read. Only the row can
        tell you - and a row holding ["MO","MO"] is a trap for the next reader,
        who has no reason to expect it.
        """
        created = api.post(
            "/alarms",
            make_alarm(
                "Duplicates " + unique,
                {"type": "weekly", "byWeekday": ["MO", "MO", "WE", "MO"]},
                "09:03",
            ),
        )

        weekdays = stored_rule(db, created["id"])["byWeekday"]

        assert len(weekdays) == len(set(weekdays)), "stored with duplicates: " + str(weekdays)
        assert set(weekdays) == {"MO", "WE"}

    def test_the_stored_rule_and_the_returned_rule_agree(self, api, db, unique):
        """
        The general form of the question this stack exists to ask.

        Written once, read back through the API, and compared against the row.
        Any normalisation the application does on the way out - sorting,
        defaulting, filling in a field - shows up here as a difference.
        """
        rule = {"type": "monthly_nth", "nth": -1, "weekday": "FR"}
        created = api.post("/alarms", make_alarm("Last Friday " + unique, rule, "09:04"))

        returned = api.get("/alarms/" + created["id"])["rule"]

        assert stored_rule(db, created["id"]) == returned

    def test_a_negative_nth_is_stored_as_a_number_not_a_string(self, api, db, unique):
        """
        R-05 allows -1 for "the last". jsonb preserves the JSON type, so this
        checks that -1 did not become "-1" somewhere in the round trip - which
        would compare falsely and sort absurdly.
        """
        created = api.post(
            "/alarms",
            make_alarm(
                "Last " + unique, {"type": "monthly_nth", "nth": -1, "weekday": "MO"}, "09:05"
            ),
        )

        nth = stored_rule(db, created["id"])["nth"]

        assert nth == -1
        assert isinstance(nth, int), "stored as " + type(nth).__name__

    def test_an_interval_rule_keeps_its_unit(self, api, db, unique):
        rule = {"type": "interval", "every": 3, "unit": "weeks"}
        created = api.post("/alarms", make_alarm("Every three " + unique, rule, "09:06"))

        stored = stored_rule(db, created["id"])

        assert stored == rule
        assert isinstance(stored["every"], int)

    def test_a_rule_carries_no_fields_the_schema_does_not_define(self, api, db, unique):
        """
        jsonb stores whatever it is handed. A field that is not part of the
        rule's shape - left over from an earlier version, or passed through
        from a request - would sit in the row unnoticed, since the API returns
        only what it knows about.
        """
        created = api.post("/alarms", make_alarm("Clean " + unique, {"type": "daily"}, "09:07"))

        assert set(stored_rule(db, created["id"])) == {"type"}


class TestTheBoundsAroundTheRule:
    def test_an_occurrence_limit_is_stored_as_given(self, api, db, unique):
        created = api.post(
            "/alarms",
            make_alarm("Five times " + unique, {"type": "daily"}, "10:01", endAfterOccurrences=5),
        )

        row = db.row(
            "SELECT end_after_occurrences, end_date FROM alarms WHERE id = %s",
            (created["id"],),
        )
        assert row is not None
        assert row["end_after_occurrences"] == 5
        # The two ways of ending are exclusive; setting one must not quietly
        # populate the other with something derived.
        assert row["end_date"] is None

    def test_self_destruct_is_stored_and_defaults_to_off(self, api, db, unique):
        plain = api.post("/alarms", make_alarm("Ordinary " + unique, {"type": "daily"}, "10:02"))
        marked = api.post(
            "/alarms",
            make_alarm("Temporary " + unique, {"type": "daily"}, "10:03", selfDestruct=True),
        )

        # str() because psycopg returns a uuid column as a uuid.UUID, not a
        # string, so keying on it directly never matches an id from the API.
        rows = {
            str(r["id"]): r["self_destruct"]
            for r in db.rows(
                # ::uuid[] because the column is uuid and psycopg sends a
                # text array, which matches nothing and returns no rows
                # rather than failing - a silent empty result.
                "SELECT id, self_destruct FROM alarms WHERE id = ANY(%s::uuid[])",
                ([plain["id"], marked["id"]],),
            )
        }

        assert rows[plain["id"]] is False, "an ordinary alarm should not self-destruct"
        assert rows[marked["id"]] is True


class TestWithinDayRepetition:
    """
    The columns exist; the behaviour is not under test.

    Within-day repetition sits behind a paid tier and paid tiers are out of
    scope, so no account this suite can obtain is able to create one. What can
    still be checked is that the schema has somewhere to put it and that an
    ordinary alarm leaves those columns empty - which is what says the feature
    is dormant rather than half-applied to everybody.
    """

    def test_the_schema_has_columns_for_it(self, db):
        for name in ("repeat_every", "repeat_unit", "end_time"):
            assert db.column("alarms", name) is not None, "alarms." + name + " is missing"

    def test_an_ordinary_alarm_leaves_them_empty(self, api, db, unique):
        created = api.post(
            "/alarms", make_alarm("Once a day " + unique, {"type": "daily"}, "11:01")
        )

        row = db.row(
            "SELECT repeat_every, repeat_unit, end_time FROM alarms WHERE id = %s",
            (created["id"],),
        )
        assert row is not None
        assert row["repeat_every"] is None
        assert row["repeat_unit"] is None
        assert row["end_time"] is None
