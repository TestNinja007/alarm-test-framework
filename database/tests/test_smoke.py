"""
The database layer's own plumbing.

Every other test here assumes three things: that the connection reaches the
same database the application is writing to, that acting through the API
actually produces rows, and that a throwaway account starts empty. If any of
those is false the rest of this directory fails in confusing ways, so they are
checked on their own first.
"""

import pytest

from conftest import BASE_URL, soon

pytestmark = pytest.mark.smoke


def test_the_connection_reaches_a_schema_that_looks_like_this_application(db):
    tables = {
        r["table_name"]
        for r in db.rows(
            """SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'"""
        )
    }

    missing = {"users", "folders", "alarms"} - tables
    assert not missing, "not the application's database - missing " + str(sorted(missing))


def test_every_migration_has_been_applied(db):
    """
    The schema is not merely present but current.

    A connection to a database two migrations behind answers every query in
    this directory and answers some of them wrongly, which is worse than
    failing. `self_destruct` is from the most recent migration, so its presence
    stands in for the chain having been applied.
    """
    assert db.column("alarms", "self_destruct") is not None, (
        "the database is behind: migration 0012 has not been applied"
    )


def test_the_instance_under_test_and_the_database_are_the_same_system(api, db, unique):
    """
    The one assumption worth proving rather than trusting.

    BASE_URL and DATABASE_URL are two separate settings and nothing stops them
    pointing at different systems. If they did, every test here would act
    against one and assert against the other, and would fail or - much worse -
    pass by coincidence on an empty result.
    """
    created = api.post(
        "/alarms",
        {
            "name": "Plumbing " + unique,
            "timeOfDay": "12:00",
            "timezone": "UTC",
            "startDate": soon(),
            "rule": {"type": "daily"},
        },
    )

    row = db.row("SELECT name FROM alarms WHERE id = %s", (created["id"],))

    assert row is not None, (
        "an alarm created through " + BASE_URL + " is not in this database; "
        "BASE_URL and DATABASE_URL may point at different systems"
    )
    assert row["name"] == "Plumbing " + unique


def test_a_throwaway_account_starts_with_nothing(api, db):
    assert db.count("folders", "user_id = %s", (api.user_id,)) == 0
    assert db.count("alarms", "user_id = %s", (api.user_id,)) == 0


def test_two_throwaway_accounts_are_different_accounts(api, db, unique):
    """
    Isolation, from the database's side.

    The fixture is per-test, so two tests must never be handed the same
    account - if they were, one test's rows would be another's starting state
    and both would be unreliable.
    """
    first = api.user_id

    import requests

    from conftest import API, Api

    created = requests.post(API + "/test/users", json={}, timeout=30)
    created.raise_for_status()
    other = created.json()
    second_client = Api()
    second_client.sign_in(other["email"], other["password"])

    assert second_client.user_id != first
    assert db.count("users", "id = ANY(%s::uuid[])", ([first, second_client.user_id],)) == 2
