"""
Fixtures for the database layer.

This stack asks a different question from the Playwright suite. That one drives
the interface and asks what a user sees; this one acts, then looks at the rows,
and asks whether what was stored is what was promised. The two questions need
different tools, which is why there are two stacks rather than one with a
`@db` tag.

Every test here has the same shape: do something through the API (or let the
Playwright suite have done something through the UI), then query PostgreSQL
directly. The HTTP client below exists only to get the database into an
interesting state. It is not a second API test framework, and assertions about
status codes and response bodies belong in the other stack.
"""

from __future__ import annotations

import io
import os
import uuid
from dataclasses import dataclass
from typing import Any, Iterator

import psycopg
import pytest
import requests
from psycopg.rows import dict_row

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def _load_env() -> "dict[str, str]":
    """
    Read the repository's .env, the same file the Playwright suite reads.

    Deliberately a few lines rather than a dependency: both stacks must agree
    about which instance and which database they are pointed at, and the way to
    guarantee that is to read the same file, not to have a second mechanism
    that usually matches.
    """
    values: "dict[str, str]" = {}
    path = os.path.join(REPO, ".env")
    if os.path.exists(path):
        for line in io.open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    # A real environment variable wins, so CI needs no file.
    for key in ("BASE_URL", "DATABASE_URL"):
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values


ENV = _load_env()
BASE_URL = ENV.get("BASE_URL", "http://127.0.0.1:8080")
API = BASE_URL + "/api/v1"
DATABASE_URL = ENV.get("DATABASE_URL")


def pytest_collection_modifyitems(config: pytest.Config, items: "list[pytest.Item]") -> None:
    """
    Without a database this whole layer is meaningless, so it skips rather than
    fails - the same contract the Playwright `@db` specs had. A missing
    DATABASE_URL is a configuration state, not a defect.
    """
    if DATABASE_URL:
        return
    skip = pytest.mark.skip(reason="DATABASE_URL is not set; the database layer cannot run")
    for item in items:
        item.add_marker(skip)


@pytest.fixture(scope="session")
def connection() -> "Iterator[psycopg.Connection]":
    """One connection for the session. Autocommit, because these tests only read."""
    if not DATABASE_URL:
        pytest.skip("DATABASE_URL is not set")
    with psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row) as conn:
        yield conn


@dataclass
class Db:
    """A thin query surface. Deliberately not an ORM - the point is to see the SQL."""

    connection: "psycopg.Connection"

    def rows(self, sql: str, params: tuple = ()) -> "list[dict[str, Any]]":
        with self.connection.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())

    def row(self, sql: str, params: tuple = ()) -> "dict[str, Any] | None":
        found = self.rows(sql, params)
        return found[0] if found else None

    def count(self, table: str, where: str = "", params: tuple = ()) -> int:
        # The table name is interpolated because an identifier cannot be a bound
        # parameter. Every caller in this suite passes a literal.
        clause = " WHERE " + where if where else ""
        found = self.row("SELECT count(*) AS n FROM " + table + clause, params)
        return int(found["n"]) if found else 0

    def indexes(self, table: str) -> "dict[str, str]":
        """Index name to its definition, for asserting that a constraint exists."""
        return {
            r["indexname"]: r["indexdef"]
            for r in self.rows(
                "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = %s", (table,)
            )
        }

    def column(self, table: str, name: str) -> "dict[str, Any] | None":
        return self.row(
            """SELECT data_type, is_nullable, column_default
                 FROM information_schema.columns
                WHERE table_name = %s AND column_name = %s""",
            (table, name),
        )

    def foreign_keys(self, table: str) -> "list[dict[str, Any]]":
        """Every foreign key on a table, with what it does on delete."""
        return self.rows(
            """SELECT con.conname      AS name,
                      att.attname      AS column_name,
                      ref.relname      AS references_table,
                      con.confdeltype  AS on_delete
                 FROM pg_constraint con
                 JOIN pg_class rel  ON rel.oid = con.conrelid
                 JOIN pg_class ref  ON ref.oid = con.confrelid
                 JOIN pg_attribute att
                      ON att.attrelid = con.conrelid
                     AND att.attnum = con.conkey[1]
                WHERE con.contype = 'f' AND rel.relname = %s
                ORDER BY con.conname""",
            (table,),
        )


@pytest.fixture(scope="session")
def db(connection: "psycopg.Connection") -> Db:
    return Db(connection)


class Api:
    """
    Enough HTTP to get the database somewhere interesting.

    It keeps the session cookie and the CSRF token, because the application
    refuses a write without both. It raises on failure rather than returning a
    status: here a failed setup call is a broken test, not a finding. Findings
    live in the rows.
    """

    def __init__(self) -> None:
        self.session = requests.Session()
        self.csrf = None
        self.user_id = None
        # Kept because account deletion is password-confirmed, and a test that
        # deletes an account should not have to go and make another one.
        self.email = None
        self.password = None

    def sign_in(self, email: str, password: str) -> None:
        self.email = email
        self.password = password
        response = self.session.post(
            API + "/auth/login", json={"email": email, "password": password}, timeout=30
        )
        response.raise_for_status()
        body = response.json()
        self.csrf = body.get("csrfToken")
        self.user_id = (body.get("user") or {}).get("id")

    def _headers(self) -> "dict[str, str]":
        return {"X-CSRF-Token": self.csrf} if self.csrf else {}

    def get(self, path: str) -> Any:
        response = self.session.get(API + path, timeout=30)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, body: Any = None) -> Any:
        response = self.session.post(
            API + path, json=body or {}, headers=self._headers(), timeout=30
        )
        response.raise_for_status()
        return response.json() if response.content else None

    def put(self, path: str, body: Any = None) -> Any:
        response = self.session.put(
            API + path, json=body or {}, headers=self._headers(), timeout=30
        )
        response.raise_for_status()
        return response.json() if response.content else None

    def delete(self, path: str, body: Any = None) -> int:
        response = self.session.delete(
            API + path, json=body, headers=self._headers(), timeout=30
        )
        response.raise_for_status()
        return response.status_code

    def try_post(self, path: str, body: Any = None) -> "requests.Response":
        """For when the refusal is the point. Returns the response unraised."""
        return self.session.post(
            API + path, json=body or {}, headers=self._headers(), timeout=30
        )


@pytest.fixture(scope="session")
def reachable() -> "dict[str, Any]":
    """The instance is up and has its test hooks on, or nothing here works."""
    try:
        health = requests.get(API + "/health", timeout=15).json()
    except requests.RequestException as error:
        pytest.skip(BASE_URL + " is not reachable: " + str(error))
    if not health.get("testSupport"):
        pytest.skip(BASE_URL + " has test support off; throwaway accounts cannot be created")
    return health


@pytest.fixture
def api(reachable: "dict[str, Any]") -> Api:
    """
    A client signed in as a throwaway account, fresh for each test.

    Per-test rather than shared: everything here creates rows, and the basic
    tier allows only two groups - three tests each making one against a shared
    account would leave the third failing on a limit unrelated to what it
    tests. The Playwright suite learned that the hard way.
    """
    created = requests.post(API + "/test/users", json={}, timeout=30)
    created.raise_for_status()
    user = created.json()

    client = Api()
    client.sign_in(user["email"], user["password"])
    assert client.user_id, "signing in should return the user id"
    return client


@pytest.fixture
def unique() -> str:
    """A short unique suffix, so names cannot collide across tests."""
    return uuid.uuid4().hex[:8]


def soon(days: int = 30) -> str:
    """
    A date inside R-08's ninety-day collision horizon, computed not written.

    A fixed date far in the future has nothing to collide with, which makes a
    collision test pass for the wrong reason. The Playwright suite hit exactly
    that.
    """
    import datetime

    return (datetime.date.today() + datetime.timedelta(days=days)).isoformat()
