"""
Referential integrity: what deleting a row actually takes with it.

TC51 and TC52 live here, moved out of the Playwright suite where they had been
written against a TypeScript `pg` helper. They belong here: both ask a question
the API cannot answer. An API can report rows gone simply by filtering on a
parent that no longer exists, and a cascade that removes a row from one table
while orphaning it in another looks identical through the interface - right up
until a foreign key or a report finds it months later.

The declaration tests are the other half, and they are new. Asserting that a
cascade *happened* proves the application did the right thing once. Asserting
that the constraint *exists* proves the database will keep doing it even if
somebody deletes the application's own tidy-up code. Those are different
guarantees and both are wanted.
"""

import pytest

from conftest import soon

pytestmark = pytest.mark.cascade


def make_alarm(name, folder_id=None, time_of_day="09:00"):
    body = {
        "name": name,
        "timeOfDay": time_of_day,
        "timezone": "UTC",
        "startDate": soon(),
        "rule": {"type": "daily"},
    }
    if folder_id is not None:
        body["folderId"] = folder_id
    return body


class TestDeclarations:
    """The constraints as the schema declares them, independent of any action."""

    def test_an_alarm_belongs_to_a_user_and_cannot_outlive_them(self, db):
        keys = {k["column_name"]: k for k in db.foreign_keys("alarms")}

        assert "user_id" in keys, "an alarm should reference the user who owns it"
        # 'c' is ON DELETE CASCADE in pg_constraint.confdeltype. Anything else
        # here - 'a' for no action, 'n' for set null - would leave rows behind
        # or silently disown them when an account goes.
        assert keys["user_id"]["on_delete"] == "c"
        assert keys["user_id"]["references_table"] == "users"

        column = db.column("alarms", "user_id")
        assert column is not None
        # NOT NULL matters as much as the cascade: a nullable owner is a row
        # that belongs to nobody and that no cascade will ever reach.
        assert column["is_nullable"] == "NO", "every alarm must have an owner"

    def test_an_alarm_may_have_no_group_but_cannot_point_at_a_missing_one(self, db):
        keys = {k["column_name"]: k for k in db.foreign_keys("alarms")}

        assert "folder_id" in keys
        assert keys["folder_id"]["on_delete"] == "c", "deleting a group takes its alarms"
        assert keys["folder_id"]["references_table"] == "folders"

        column = db.column("alarms", "folder_id")
        assert column is not None
        # Nullable on purpose - R-20's ungrouped alarms live at the top level,
        # and the alternative implementation is a pseudo-group the person did
        # not make and cannot delete.
        assert column["is_nullable"] == "YES", "an alarm is allowed to have no group"

    def test_a_group_cannot_outlive_its_owner(self, db):
        keys = {k["column_name"]: k for k in db.foreign_keys("folders")}

        assert "user_id" in keys
        assert keys["user_id"]["on_delete"] == "c"
        assert keys["user_id"]["references_table"] == "users"

    def test_every_set_null_in_the_schema_is_one_that_was_meant(self, db):
        """
        A cascade and a set-null look alike in a migration and are opposites in
        effect: one removes the row, the other keeps it pointing at nothing.
        So every SET NULL has to be deliberate, and this is the list of the
        ones that are.

        `ui_state.folder_id` is the only one, and it is right: the remembered
        folder selection should fall back to "none" when that folder is
        deleted, not take the person's whole saved view with it.

        An earlier version of this test looked only at `alarms` and `folders`
        and therefore passed while knowing nothing - which is worse than
        failing, because it reads as coverage.
        """
        allowed = {("ui_state", "folder_id")}

        found = set()
        for table in ("alarms", "folders", "ui_state", "alarm_drafts"):
            for key in db.foreign_keys(table):
                if key["on_delete"] == "n":
                    found.add((table, key["column_name"]))

        unexpected = found - allowed
        assert unexpected == set(), (
            "these would be orphaned rather than deleted, and nobody said so: "
            + str(sorted(unexpected))
        )

        missing = allowed - found
        assert missing == set(), (
            "expected a deliberate SET NULL that is no longer there: " + str(sorted(missing))
        )

    def test_the_tables_the_interface_writes_cannot_outlive_their_owner(self, db):
        """
        alarm_drafts and ui_state are per-account scratch space, written by the
        browser rather than by a deliberate save. Nothing in the interface ever
        lists them, so a row left behind by a deleted account would never be
        seen again and never be cleaned up.
        """
        for table in ("alarm_drafts", "ui_state"):
            keys = {k["column_name"]: k for k in db.foreign_keys(table)}
            assert "user_id" in keys, table + " should reference its owner"
            assert keys["user_id"]["on_delete"] == "c", (
                table + ".user_id should cascade, not " + keys["user_id"]["on_delete"]
            )


class TestCascadesInPractice:
    """And now the same guarantees, exercised rather than read."""

    def test_tc51_deleting_a_group_deletes_its_alarms(self, api, db, unique):
        folder = api.post("/folders", {"name": "Cascade " + unique})
        api.post("/alarms", make_alarm("First " + unique, folder["id"], "05:05"))
        api.post("/alarms", make_alarm("Second " + unique, folder["id"], "05:10"))

        assert db.count("alarms", "folder_id = %s", (folder["id"],)) == 2

        api.delete("/folders/" + folder["id"] + "?confirm=true")

        # The question the API cannot answer: are the rows gone, or still
        # there pointing at a group that is not?
        assert db.count("alarms", "folder_id = %s", (folder["id"],)) == 0
        assert db.count("folders", "id = %s", (folder["id"],)) == 0

    def test_tc51b_deleting_a_group_leaves_other_groups_alarms_alone(self, api, db, unique):
        """
        The half a cascade test usually forgets.

        A delete that removes too much is as wrong as one that removes too
        little, and far quieter: nobody notices the alarms that are missing
        from a group they were not looking at.
        """
        doomed = api.post("/folders", {"name": "Doomed " + unique})
        kept = api.post("/folders", {"name": "Kept " + unique})
        api.post("/alarms", make_alarm("Goes " + unique, doomed["id"], "06:05"))
        survivor = api.post("/alarms", make_alarm("Stays " + unique, kept["id"], "06:10"))

        api.delete("/folders/" + doomed["id"] + "?confirm=true")

        assert db.count("alarms", "id = %s", (survivor["id"],)) == 1
        assert db.count("alarms", "folder_id = %s", (kept["id"],)) == 1

    def test_tc52_deleting_an_account_removes_everything_it_owned(self, api, db, unique):
        user_id = api.user_id

        folder = api.post("/folders", {"name": "Everything " + unique})
        api.post("/alarms", make_alarm("Owned " + unique, folder["id"], "04:05"))
        api.post("/alarms", make_alarm("Unfiled and owned " + unique, None, "04:10"))

        assert db.count("folders", "user_id = %s", (user_id,)) == 1
        assert db.count("alarms", "user_id = %s", (user_id,)) == 2

        api.delete("/me?confirm=true", {"password": api.password})

        assert db.count("users", "id = %s", (user_id,)) == 0
        assert db.count("folders", "user_id = %s", (user_id,)) == 0, "no groups remain"
        assert db.count("alarms", "user_id = %s", (user_id,)) == 0, "no alarms remain"

    def test_an_unfiled_alarm_survives_the_deletion_of_an_unrelated_group(
        self, api, db, unique
    ):
        """
        An alarm with no group has a null folder_id, and a cascade keyed on
        folder_id must not reach it. Worth asserting because the obvious
        implementation of "delete this group's alarms" is a query that an
        off-by-one WHERE clause turns into "delete alarms with no group".
        """
        folder = api.post("/folders", {"name": "Unrelated " + unique})
        loose = api.post("/alarms", make_alarm("Loose " + unique, None, "07:15"))

        api.delete("/folders/" + folder["id"] + "?confirm=true")

        row = db.row("SELECT folder_id FROM alarms WHERE id = %s", (loose["id"],))
        assert row is not None, "an ungrouped alarm is nobody's child and should remain"
        assert row["folder_id"] is None
