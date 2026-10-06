"""
Comparing what the API returns against what the database holds.

The other files here check one row at a time. This one checks whole result
sets, which is a different question: not "is this value right" but "is this
*the right set of values*, all of them, once each, in the order claimed".

Set comparison is where paging quietly goes wrong. A list sorted by a
non-unique key and fetched with LIMIT/OFFSET has no defined order within a
group of equal keys, so the database may return the same row on two pages and
another row on none. Every page looks plausible, the totals look right, and
one alarm is simply missing - which no single-row assertion can see, because
every row it looks at is correct.
"""

import pytest

from conftest import soon

pytestmark = pytest.mark.storage


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


def sql_ids_by_name(db, user_id):
    """The same ordering the API claims to use, straight from the database."""
    return [
        str(r["id"])
        for r in db.rows(
            """SELECT id FROM alarms
                WHERE user_id = %s
                ORDER BY lower(name) ASC, id ASC""",
            (user_id,),
        )
    ]


class TestTheListMatchesTheTable:
    def test_the_list_returns_exactly_the_rows_the_account_owns(self, api, db, unique):
        folder = api.post("/folders", {"name": "Set " + unique})
        created = [
            api.post("/alarms", make_alarm("Alpha " + unique, folder["id"], "09:01"))["id"],
            api.post("/alarms", make_alarm("Bravo " + unique, folder["id"], "09:02"))["id"],
            api.post("/alarms", make_alarm("Charlie " + unique, None, "09:03"))["id"],
        ]

        listed = {a["id"] for a in api.get("/alarms?pageSize=100")["items"]}
        stored = set(sql_ids_by_name(db, api.user_id))

        assert listed == stored, "the API and the table disagree about what exists"
        assert stored == set(created)

    def test_the_reported_total_is_the_row_count_and_not_the_page_size(
        self, api, db, unique
    ):
        """
        `total` is what pagination controls are drawn from. If it counts the
        page rather than the set, the last page is unreachable and nobody
        notices until someone has more alarms than fit on one.
        """
        folder = api.post("/folders", {"name": "Total " + unique})
        for i in range(5):
            api.post("/alarms", make_alarm("Count " + str(i) + " " + unique, folder["id"],
                                           "10:0" + str(i)))

        page = api.get("/alarms?pageSize=2")

        assert len(page["items"]) == 2, "a page of two should hold two"
        assert page["total"] == db.count("alarms", "user_id = %s", (api.user_id,))
        assert page["total"] == 5

    def test_the_claimed_order_is_the_order_the_database_gives(self, api, db, unique):
        """
        Sorted by name, case-insensitively. Submitted deliberately out of
        order, and with mixed case, because a comparison that forgets `lower()`
        sorts every capital letter ahead of every lower-case one and still
        looks sorted at a glance.
        """
        folder = api.post("/folders", {"name": "Order " + unique})
        # Distinct times: R-08 forbids two enabled alarms in one group sharing
        # an instant, so identical times here would be refused for a reason
        # that has nothing to do with ordering.
        for index, name in enumerate(("zebra", "Apple", "mango", "Banana")):
            api.post(
                "/alarms",
                make_alarm(name + " " + unique, folder["id"], "11:0" + str(index)),
            )

        listed = [a["id"] for a in api.get("/alarms?pageSize=100")["items"]]

        assert listed == sql_ids_by_name(db, api.user_id)


class TestPagingLosesNothing:
    def test_paging_one_at_a_time_yields_every_row_exactly_once(
        self, api, db, unique
    ):
        folder = api.post("/folders", {"name": "Paged " + unique})
        for i in range(5):
            api.post(
                "/alarms",
                make_alarm("Page " + str(i) + " " + unique, folder["id"], "12:0" + str(i)),
            )

        seen = []
        for page in range(1, 7):
            items = api.get("/alarms?pageSize=1&page=" + str(page))["items"]
            if not items:
                break
            seen.extend(a["id"] for a in items)

        stored = sql_ids_by_name(db, api.user_id)

        assert len(seen) == len(set(seen)), "a row was returned on more than one page"
        assert sorted(seen) == sorted(stored), "paging and the table disagree"
        assert seen == stored, "the pages are not in the order the list claims"

    def test_paging_is_stable_when_many_rows_share_a_sort_key(
        self, api, db, unique
    ):
        """
        The case the `id` tiebreaker exists for.

        `ORDER BY lower(name), id` is stable; `ORDER BY lower(name)` alone is
        not, and with OFFSET it can repeat one row and skip another. Identical
        names are only possible in different groups - the unique index forbids
        them within one - so this builds exactly that, which is also the
        realistic shape: the same alarm name used in two groups.

        If the tiebreaker is ever removed while tidying, this is what fails.
        """
        name = "Stretch " + unique
        first = api.post("/folders", {"name": "Morning " + unique})
        second = api.post("/folders", {"name": "Evening " + unique})

        api.post("/alarms", make_alarm(name, first["id"], "13:01"))
        api.post("/alarms", make_alarm(name, second["id"], "13:02"))
        api.post("/alarms", make_alarm(name, None, "13:03"))

        assert db.count("alarms", "user_id = %s AND lower(name) = lower(%s)",
                        (api.user_id, name)) == 3

        seen = []
        for page in range(1, 5):
            items = api.get("/alarms?pageSize=1&page=" + str(page))["items"]
            if not items:
                break
            seen.extend(a["id"] for a in items)

        assert len(seen) == 3, "three rows share a name and three should come back"
        assert len(set(seen)) == 3, "the same row came back on two pages: " + str(seen)
        assert seen == sql_ids_by_name(db, api.user_id)


class TestFilteringAgreesWithSql:
    def test_asking_for_one_group_returns_that_group_and_no_other(
        self, api, db, unique
    ):
        wanted = api.post("/folders", {"name": "Wanted " + unique})
        other = api.post("/folders", {"name": "Other " + unique})
        api.post("/alarms", make_alarm("In scope " + unique, wanted["id"], "14:01"))
        api.post("/alarms", make_alarm("Out of scope " + unique, other["id"], "14:02"))
        api.post("/alarms", make_alarm("Unfiled " + unique, None, "14:03"))

        listed = {a["id"] for a in api.get("/alarms?folderId=" + wanted["id"])["items"]}
        stored = {
            str(r["id"])
            for r in db.rows("SELECT id FROM alarms WHERE folder_id = %s", (wanted["id"],))
        }

        assert listed == stored
        assert len(listed) == 1

    def test_the_unfiled_view_is_exactly_the_rows_with_no_group(
        self, api, db, unique
    ):
        """
        R-20's list. `folder_id IS NULL` in SQL, and the interface must agree
        - a view built with `folder_id != <something>` would quietly include
        nothing, since no comparison with NULL is ever true.
        """
        folder = api.post("/folders", {"name": "Somewhere " + unique})
        api.post("/alarms", make_alarm("Filed " + unique, folder["id"], "15:01"))
        loose = api.post("/alarms", make_alarm("Loose " + unique, None, "15:02"))

        listed = {a["id"] for a in api.get("/alarms?unfiled=true")["items"]}
        stored = {
            str(r["id"])
            for r in db.rows(
                "SELECT id FROM alarms WHERE user_id = %s AND folder_id IS NULL",
                (api.user_id,),
            )
        }

        assert listed == stored
        assert listed == {loose["id"]}

    def test_one_account_never_sees_another_accounts_rows(self, api, db, unique):
        """
        R-34 from the database's side. The Playwright suite asserts the 404 on
        a single alarm; this asserts the whole list, which is where a missing
        `user_id` in a WHERE clause would show up as somebody else's data
        appearing rather than as an error.
        """
        api.post("/alarms", make_alarm("Mine " + unique, None, "16:01"))

        everyone = db.count("alarms")
        mine = db.count("alarms", "user_id = %s", (api.user_id,))

        # The assertion that matters: the list counts this account and no more.
        listed = api.get("/alarms?pageSize=100")
        assert listed["total"] == mine, "the list total should count only this account"

        # And it is only a meaningful assertion if somebody else owns rows at
        # all. That depends on what else is in the database, which this test
        # does not control and must not assert - the Playwright suite restores
        # the seed when it starts, so a run interleaved with one can briefly
        # see an empty table. Stated as a precondition rather than a finding.
        if everyone <= mine:
            pytest.skip("no other account owns alarms right now; isolation is untestable")

        assert mine < everyone
