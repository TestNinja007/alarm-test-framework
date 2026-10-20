"""
The speech service's data, now that it is a service of its own.

Speech was extracted from the main API into its own service, which owns its own
schema - `speech` - while the main API keeps `public`. This is schema per
service: one of the three recognised ways to keep a service's data private,
chosen because the local database user can create a schema but not a database.

That makes the isolation **a convention, enforced here**, not a permission:
both services connect as the same role and either could technically read the
other's tables. These tests are what turns the convention into something that
fails when it is broken. See "The speech service" in the application's CLAUDE.md.

The previous tests in this area asked about `speech_audio` by name alone. Once
the table existed in two schemas, they quietly found the speech service's copy
and went on passing - believing they were looking at the main API's. A test
that passes for the wrong reason is the same failure as one that cannot fail.
"""

import pytest
import requests

from conftest import MAIN_SCHEMA, SPEECH_SCHEMA, SPEECH_SERVICE_TOKEN, SPEECH_URL

pytestmark = pytest.mark.storage


@pytest.fixture(scope="module")
def speech_service():
    """
    The speech service, reachable and holding a token we can present.

    Skips locally when it is not running - a configuration state, like a
    missing database. In CI the database job starts it, and the job refuses
    to pass with skips, so this cannot quietly stop running there.
    """
    try:
        health = requests.get(SPEECH_URL + "/health", timeout=5)
    except requests.RequestException as error:
        pytest.skip("the speech service is not reachable at " + SPEECH_URL + ": " + str(error))
    if not SPEECH_SERVICE_TOKEN:
        pytest.skip("SPEECH_SERVICE_TOKEN is not set, so the service cannot be called")
    return health.json()


class TestEachServiceOwnsItsData:
    def test_the_main_api_holds_no_speech_data(self, db):
        """
        The table moved out. If it ever reappears here - a stray migration, a
        merge that resurrected it - the main API is holding the speech
        service's data again and the extraction has quietly undone itself.
        """
        assert "speech_audio" not in db.tables(MAIN_SCHEMA), (
            "the main API's schema holds speech data again"
        )

    def test_the_speech_service_owns_a_schema_of_its_own(self, db):
        tables = db.tables(SPEECH_SCHEMA)

        assert "speech_audio" in tables, (
            "the speech schema has no speech_audio - has the speech service been migrated?"
        )
        # Only what the service needs: its cache and its own ledger.
        assert tables == {"speech_audio", "schema_migrations"}, tables

    def test_each_service_keeps_its_own_migration_ledger(self, db):
        """
        Separate ledgers are what let the two be migrated - and deployed -
        independently. A shared one would mean neither could migrate without
        the other's migrations being present.
        """
        main = {r["filename"] for r in db.rows("SELECT filename FROM public.schema_migrations")}
        speech = {
            r["filename"]
            for r in db.rows("SELECT filename FROM " + SPEECH_SCHEMA + ".schema_migrations")
        }

        assert "0001_speech_audio.sql" in speech
        assert "0001_speech_audio.sql" not in main
        # The main API's side of the move is recorded in its own ledger.
        assert any("speech_audio_moved" in name for name in main), sorted(main)
        assert not main & speech, "a migration recorded by both services: " + str(main & speech)

    def test_no_foreign_key_crosses_between_the_services(self, db):
        """
        A foreign key from one service's data into the other's would make
        them one database again - neither could be moved, restored or deleted
        alone. This is the assertion that keeps the boundary a boundary.
        """
        crossing = db.rows(
            """SELECT relns.nspname || '.' || rel.relname AS from_table,
                      refns.nspname || '.' || ref.relname AS to_table
                 FROM pg_constraint con
                 JOIN pg_class rel        ON rel.oid = con.conrelid
                 JOIN pg_namespace relns  ON relns.oid = rel.relnamespace
                 JOIN pg_class ref        ON ref.oid = con.confrelid
                 JOIN pg_namespace refns  ON refns.oid = ref.relnamespace
                WHERE con.contype = 'f'
                  AND relns.nspname IN (%s, %s)
                  AND refns.nspname IN (%s, %s)
                  AND relns.nspname <> refns.nspname""",
            (MAIN_SCHEMA, SPEECH_SCHEMA, MAIN_SCHEMA, SPEECH_SCHEMA),
        )

        assert crossing == [], "foreign keys crossing the service boundary: " + str(crossing)

    def test_the_cache_still_carries_no_owner(self, db):
        """
        Moved, not changed: still content-addressed, still not personal data.
        An owner column would make it per-user storage that no account
        deletion could reach - and now it lives in another service, nothing in
        the main API could reach it at all.
        """
        assert db.column("speech_audio", "user_id", schema=SPEECH_SCHEMA) is None
        assert db.column("speech_audio", "bytes", schema=SPEECH_SCHEMA) is not None


class TestActingThroughTheService:
    def test_generated_audio_lands_in_the_speech_schema_and_nowhere_else(
        self, db, speech_service, unique
    ):
        """
        The database layer's usual shape, applied to the new service: act
        through its API, then read its rows.

        Called directly, with the service token, rather than through the main
        API - because generated speech is a paid-tier feature, and paid tiers
        are out of scope, so no account this suite can obtain reaches it that
        way. The service itself has no tiers, so it can be exercised here.
        """
        text = "Stand up " + unique
        made = requests.post(
            SPEECH_URL + "/v1/syntheses",
            json={"text": text, "voice": "female"},
            headers={"Authorization": "Bearer " + SPEECH_SERVICE_TOKEN},
            timeout=30,
        )
        assert made.ok, made.text
        audio_id = made.json()["id"]

        row = db.row(
            "SELECT text, voice, content_type FROM " + SPEECH_SCHEMA + ".speech_audio WHERE id = %s",
            (audio_id,),
        )
        assert row is not None, "the service said it stored audio, and its schema has no row"
        assert row["text"] == text
        assert row["voice"] == "female"

        # And the main API's schema has nowhere to put it.
        assert "speech_audio" not in db.tables(MAIN_SCHEMA)

    def test_the_same_words_are_stored_once(self, db, speech_service, unique):
        """The cache, observed from its rows rather than from the API's flag."""
        text = "Back to work " + unique
        for _ in range(3):
            requests.post(
                SPEECH_URL + "/v1/syntheses",
                json={"text": text, "voice": "male"},
                headers={"Authorization": "Bearer " + SPEECH_SERVICE_TOKEN},
                timeout=30,
            ).raise_for_status()

        assert (
            db.count(SPEECH_SCHEMA + ".speech_audio", "text = %s", (text,)) == 1
        ), "three identical requests should store one row"

    def test_a_caller_without_the_token_cannot_write_to_it(self, db, speech_service, unique):
        """
        The token is the whole of the speech service's access control. Checked
        at the rows rather than at the status code: a refusal that still wrote
        would look correct from outside.
        """
        text = "Unauthorised " + unique
        refused = requests.post(
            SPEECH_URL + "/v1/syntheses",
            json={"text": text, "voice": "female"},
            timeout=30,
        )

        assert refused.status_code == 401
        assert db.count(SPEECH_SCHEMA + ".speech_audio", "text = %s", (text,)) == 0
