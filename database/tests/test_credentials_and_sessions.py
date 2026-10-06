"""
Sessions, verification codes and reset codes, as rows.

These five tables were unexamined. Three of them hold live credentials, which
makes them the most consequential thing in the schema to look at directly and
the least visible from the interface.

The distinction this file is built on: the Playwright suite proves the API
*refuses* a stale session, a spent code, an expired code. That is the
behaviour, and it is the right thing to test there. It says nothing about
whether the row is gone. A session the API rejects but the table still holds
is a different security posture from one that was deleted - it is a credential
waiting for a bug in the rejecting code, and the next person to write a second
session lookup inherits it.
"""

import datetime

import pytest
import requests

from conftest import API, Api

pytestmark = pytest.mark.storage


def sessions_for(db, user_id):
    return db.rows("SELECT id, expires_at FROM sessions WHERE user_id = %s", (user_id,))


class TestSessionsAreRowsThatGetDeleted:
    def test_signing_in_creates_exactly_one_session(self, api, db):
        rows = sessions_for(db, api.user_id)

        assert len(rows) == 1, "one sign-in, one session: " + str(len(rows))

    def test_signing_out_removes_the_row_rather_than_marking_it(self, api, db):
        """
        There is no `revoked` column, so sign-out has to delete. If it ever
        becomes a flag instead, this fails - and it should, because a flag
        means every future reader has to remember to check it.
        """
        assert len(sessions_for(db, api.user_id)) == 1

        api.post("/auth/logout")

        assert sessions_for(db, api.user_id) == [], "the session row should be gone"

    def test_a_session_carries_an_expiry_in_the_future(self, api, db):
        row = sessions_for(db, api.user_id)[0]
        now = datetime.datetime.now(datetime.timezone.utc)

        assert row["expires_at"] > now, "a fresh session should not be expired"
        # Seven days by default. Asserted loosely - the point is that an expiry
        # exists and is bounded, not the exact figure, which is configurable.
        assert row["expires_at"] < now + datetime.timedelta(days=90)

    def test_tc56b_a_password_reset_deletes_every_other_session_row(
        self, api, db, unique
    ):
        """
        The row-level half of TC56.

        TC56 signs in twice, resets, and asserts the other client is refused.
        This asserts the rows are gone. A reset exists because someone may have
        lost control of the account, so a session that is merely rejected is
        not good enough: it is still there, and the whole point was to end it.
        """
        second = Api()
        second.sign_in(api.email, api.password)

        assert len(sessions_for(db, api.user_id)) == 2, "two clients, two sessions"

        api.post("/auth/forgot-password", {"email": api.email})
        # A GET with the address as a query parameter - the shape the hook
        # actually has. A POST returns 404, which an earlier version of this
        # read as "no hook on this instance" and skipped on, so the test
        # passed by never running.
        code = requests.get(
            API + "/test/password-reset-code", params={"email": api.email}, timeout=30
        )
        assert code.ok, "the reset-code hook should answer: " + str(code.status_code)
        reset_code = code.json()["code"]

        replaced = api.try_post(
            "/auth/reset-password",
            {"email": api.email, "code": reset_code, "password": "a-replacement-" + unique},
        )
        assert replaced.ok, "the reset should succeed: " + replaced.text

        rows = sessions_for(db, api.user_id)
        assert len(rows) <= 1, "a reset should leave at most the resetting client: " + str(rows)

    def test_deleting_an_account_takes_its_sessions_with_it(self, api, db):
        """
        A session row for a user who no longer exists would be a credential
        pointing at nothing - and the cascade is the only thing preventing it,
        since no code path goes looking for orphans.
        """
        user_id = api.user_id
        assert len(sessions_for(db, user_id)) == 1

        api.delete("/me?confirm=true", {"password": api.password})

        assert sessions_for(db, user_id) == []


class TestCodesAreConsumedAndBounded:
    def _verification(self, db, user_id):
        return db.row(
            """SELECT code, attempts, expires_at, created_at
                 FROM email_verifications WHERE user_id = %s""",
            (user_id,),
        )

    def test_a_fresh_account_has_no_outstanding_verification(self, api, db):
        """
        The throwaway accounts arrive verified, so there should be nothing
        outstanding. A left-behind row would be a code that still works.
        """
        assert self._verification(db, api.user_id) is None

    def test_a_code_is_stored_with_its_expiry_fifteen_minutes_out(self, db):
        """
        R-15's fifteen minutes, as the row records it rather than as the API
        enforces it. Registration is needed to produce one, so this uses a
        newly registered account rather than the verified throwaway.
        """
        email = "verify-row-" + str(datetime.datetime.now().timestamp()).replace(".", "") + "@example.test"
        registered = requests.post(
            API + "/auth/register",
            json={"email": email, "name": "Row Reader", "password": "a-long-enough-password"},
            timeout=30,
        )
        if not registered.ok:
            pytest.skip("registration is closed on this instance")

        row = db.row(
            """SELECT v.code, v.attempts, v.expires_at, v.created_at
                 FROM email_verifications v
                 JOIN users u ON u.id = v.user_id
                WHERE lower(btrim(u.email)) = lower(btrim(%s))""",
            (email,),
        )
        assert row is not None, "registering should leave a verification row"

        assert row["attempts"] == 0, "a fresh code has had no attempts"

        life = row["expires_at"] - row["created_at"]
        assert life == datetime.timedelta(minutes=15), (
            "R-15 says fifteen minutes; the row says " + str(life)
        )

        # Six digits, as issued. Worth pinning because the attempt limit is
        # only meaningful against a known, small code space.
        assert row["code"].isdigit() and len(row["code"]) == 6, row["code"]

    def test_a_wrong_attempt_is_counted_in_the_row(self, db):
        """
        R-16 allows five attempts, and the counter is what enforces it. If it
        lived only in memory the limit would reset whenever the process did,
        which is not a limit.
        """
        email = "attempts-" + str(datetime.datetime.now().timestamp()).replace(".", "") + "@example.test"
        registered = requests.post(
            API + "/auth/register",
            json={"email": email, "name": "Counter", "password": "a-long-enough-password"},
            timeout=30,
        )
        if not registered.ok:
            pytest.skip("registration is closed on this instance")

        requests.post(API + "/auth/verify", json={"email": email, "code": "000000"}, timeout=30)

        row = db.row(
            """SELECT v.attempts FROM email_verifications v
                 JOIN users u ON u.id = v.user_id
                WHERE lower(btrim(u.email)) = lower(btrim(%s))""",
            (email,),
        )
        assert row is not None
        assert row["attempts"] >= 1, "a wrong code should be counted where it persists"

    def test_the_tables_holding_codes_cannot_outlive_their_account(self, db):
        for table in ("email_verifications", "password_resets"):
            keys = {k["column_name"]: k for k in db.foreign_keys(table)}
            assert "user_id" in keys, table + " should reference its account"
            assert keys["user_id"]["on_delete"] == "c", (
                table + " should cascade, or a deleted account leaves a working code"
            )

    def test_a_code_is_stored_as_issued_rather_than_hashed(self, db):
        """
        **Stating the current behaviour, not endorsing it.**

        `email_verifications.code` and `password_resets.code` hold the code
        itself. Nothing in the documented rules says otherwise, so this is not
        a failure against spec - but it is the kind of thing that should be a
        decision rather than an accident, and it was unverified either way
        until now.

        What it means: anything that can read this table - a backup, a replica,
        a log, a query injected somewhere else - can verify any account or
        reset any password inside the fifteen-minute window, without needing
        the mailbox. Hashing would cost one function call and remove that.

        Against: the codes are six digits, so a hash of one is brute-forced in
        a million tries offline, and a reader of this table can usually do
        worse things anyway.

        This test is written to the behaviour as it is, so that changing it is
        a deliberate act that updates a test rather than a silent one. If the
        codes are ever hashed, this fails and should be replaced by the
        opposite assertion.
        """
        column = db.column("email_verifications", "code")
        assert column is not None
        assert column["data_type"] == "text"

        rows = db.rows("SELECT code FROM email_verifications LIMIT 20")
        plain = [r["code"] for r in rows if r["code"].isdigit() and len(r["code"]) == 6]

        if not rows:
            pytest.skip("no outstanding verification codes to look at")
        assert plain, (
            "codes no longer look like six plain digits - if they are now hashed, "
            "this test should be replaced with the opposite assertion"
        )


class TestTheSpeechCacheIsContentAddressedAndNotPersonal:
    def test_it_carries_no_owner(self, db):
        """
        `speech_audio` has no user_id, which is what makes it a cache rather
        than personal data: two accounts asking for the same words share one
        row. Worth asserting, because adding an owner later would silently
        turn a shared cache into per-user storage that nothing cleans up when
        an account goes.
        """
        columns = {
            r["column_name"]
            for r in db.rows(
                """SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'speech_audio'""",
            )
        }

        assert columns, "speech_audio should exist"
        assert "user_id" not in columns, (
            "an owner here would make this personal data with no cascade to remove it"
        )
        assert {"provider", "voice", "text", "bytes"} <= columns

    def test_nothing_references_it_so_an_account_deletion_cannot_orphan_it(self, db):
        referencing = db.rows(
            """SELECT rel.relname AS from_table
                 FROM pg_constraint con
                 JOIN pg_class rel ON rel.oid = con.conrelid
                 JOIN pg_class ref ON ref.oid = con.confrelid
                WHERE con.contype = 'f' AND ref.relname = 'speech_audio'""",
        )

        assert referencing == [], (
            "something points at the speech cache: " + str(referencing)
        )


def test_the_migration_ledger_records_every_file_that_exists(db):
    """
    The schema's version, read from the ledger rather than inferred.

    The smoke test checks one recent column as a proxy for "migrations have
    run". This reads the record itself, which also catches the opposite
    problem: a ledger claiming more migrations than the repository has, which
    is what a database restored from a newer branch looks like.
    """
    import os

    recorded = {r["filename"] for r in db.rows("SELECT filename FROM schema_migrations")}
    assert recorded, "schema_migrations should not be empty"

    migrations_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "..",
        "alarm-configurator",
        "db",
        "migrations",
    )
    if not os.path.isdir(migrations_dir):
        pytest.skip("the application's migrations are not checked out beside this repository")

    on_disk = {f for f in os.listdir(migrations_dir) if f.endswith(".sql")}

    assert len(recorded) == len(on_disk), (
        "the ledger records " + str(len(recorded)) + " migrations and the repository has "
        + str(len(on_disk)) + "; the database and the checkout disagree"
    )
