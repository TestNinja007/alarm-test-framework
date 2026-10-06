"""
Rows written as a consequence of using the interface.

Everything else here acts over HTTP, because the shortest honest route to an
interesting row is an API call. These cannot: `alarm_drafts` and `ui_state` are
written by the browser as somebody moves through the application - not by a
deliberate save, and not by anything a test can usefully ask for directly.

That makes them the only place where "query PostgreSQL after a UI action"
means something more than "after an API action that the UI would also have
made". A half-finished wizard is a state no API caller would ever construct on
purpose, and it is exactly the state the draft table exists to survive.

The sign-in is done over HTTP and the cookies handed to the browser. Filling
in the sign-in form is the Playwright suite's job and it has a spec for it;
repeating it here would make every one of these tests fail whenever that form
breaks, which would say nothing about the database.
"""

import pytest

pytestmark = pytest.mark.storage


def _open_the_wizard(page):
    """
    Entered through the interface rather than by navigating to a route.

    The create route is nested under a group, and the ungrouped entry point is
    a link on the dashboard. Guessing at a URL would be testing a route that
    may not exist; clicking the link is what a person does and is what the
    Playwright suite's page object does too.
    """
    page.goto("/folders")
    link = page.get_by_test_id("alarm-create-unfiled-link")
    link.wait_for(state="visible", timeout=15_000)
    link.click()
    page.get_by_test_id("alarm-name-input").wait_for(state="visible", timeout=15_000)


def draft_row(db, user_id):
    return db.row(
        "SELECT step, payload FROM alarm_drafts WHERE user_id = %s", (user_id,)
    )


class TestTheWizardLeavesADraft:
    def test_a_half_filled_wizard_is_persisted(self, page, db, api, unique):
        """
        The state nobody would ask for.

        A person who types a name, moves to the next step and then closes the
        tab has created nothing - there is no alarm, and no API call said
        "save this". The draft table is what lets them come back to it, and
        the only way to produce the row is to do what they did.
        """
        assert draft_row(db, api.user_id) is None, "a new account has no draft"

        name = "Half finished " + unique
        _open_the_wizard(page)
        page.get_by_test_id("alarm-name-input").fill(name)
        page.get_by_test_id("wizard-next-button").click()

        row = None
        for _ in range(20):
            row = draft_row(db, api.user_id)
            if row is not None and name in str(row["payload"]):
                break
            page.wait_for_timeout(250)

        assert row is not None, "advancing the wizard should have left a draft"
        assert name in str(row["payload"]), (
            "the draft should hold what was typed: " + str(row["payload"])
        )
        # The step is recorded too, which is what lets the wizard reopen where
        # it was left rather than at the beginning.
        assert row["step"] >= 2, "the draft should remember the step reached"

        # And no alarm was created, which is the whole point of a draft.
        assert db.count("alarms", "user_id = %s", (api.user_id,)) == 0

    def test_the_draft_is_stored_as_json_and_not_as_a_blob_of_text(self, page, db, api, unique):
        """
        `draft` is jsonb, so what comes back should be a structure rather than
        a string that happens to contain braces. A draft stored as text reads
        identically in the application and cannot be queried, migrated or
        inspected - which is how a column quietly becomes write-only.
        """
        _open_the_wizard(page)
        page.get_by_test_id("alarm-name-input").fill("Shape " + unique)
        page.get_by_test_id("wizard-next-button").click()

        row = None
        for _ in range(20):
            row = draft_row(db, api.user_id)
            if row is not None:
                break
            page.wait_for_timeout(250)

        assert row is not None
        assert isinstance(row["payload"], dict), (
            "stored as " + type(row["payload"]).__name__ + ", so it cannot be queried"
        )

        column = db.column("alarm_drafts", "payload")
        assert column is not None
        assert column["data_type"] == "jsonb", column["data_type"]


class TestTheInterfaceRemembersWhereYouWere:
    def test_changing_the_sort_is_remembered_in_the_database(self, page, db, api, unique):
        """
        R-33's remembered view, from the row's side.

        The sort is a UI preference, and it survives a reload because it is
        written to ui_state rather than kept in the tab. Doing it through the
        browser is the point: there is no "set my sort" action a person
        performs deliberately, only a list they re-sorted.
        """
        folder = api.post("/folders", {"name": "Remembered " + unique})

        assert db.row("SELECT sort FROM ui_state WHERE user_id = %s", (api.user_id,)) is None

        # The alarm list lives under its group; there is no bare /alarms route.
        page.goto("/folders/" + folder["id"])
        sort = page.get_by_test_id("alarm-sort-select")
        sort.wait_for(state="visible", timeout=10_000)
        sort.select_option("created")

        row = None
        for _ in range(20):
            row = db.row("SELECT sort FROM ui_state WHERE user_id = %s", (api.user_id,))
            if row is not None and row["sort"] == "created":
                break
            page.wait_for_timeout(250)

        assert row is not None, "re-sorting the list should have been remembered"
        assert row["sort"] == "created"

    def test_one_row_per_account_however_often_the_view_changes(self, page, db, api, unique):
        """
        ui_state is keyed by user_id as its primary key, so changing a
        preference must update the row rather than add one. An insert-only
        implementation would work perfectly, grow forever, and give the wrong
        answer the first time two rows disagreed.
        """
        folder = api.post("/folders", {"name": "Once only " + unique})
        page.goto("/folders/" + folder["id"])
        sort = page.get_by_test_id("alarm-sort-select")
        sort.wait_for(state="visible", timeout=15_000)

        for choice in ("created", "name", "created"):
            sort.select_option(choice)
            page.wait_for_timeout(300)

        assert db.count("ui_state", "user_id = %s", (api.user_id,)) <= 1
