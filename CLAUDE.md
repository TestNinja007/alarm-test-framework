# Working on this repository

This file is the source of truth for decisions that are **not** derivable from
the code. It is loaded automatically at the start of every session, it is
version-controlled, and you can edit it — which my own memory is not and
cannot be.

**If a decision is made in conversation, it is written here immediately.** Four
things were lost across sessions before this file existed, each rediscovered
only when it had already been built the wrong way. That is the failure this
file exists to stop.

---

## The agreed shape of the test effort

Two stacks, split on purpose.

| Stack | Owns |
| --- | --- |
| **Playwright + TypeScript** | UI specs across Chromium, Firefox and WebKit, with the API tests as the oracle behind them |
| **pytest** | the database layer — query PostgreSQL directly after API and UI actions, compare result sets, check referential integrity, and check recurrence data **as stored** rather than as returned |

A direct SQL assertion belongs in pytest, in [`database/`](database/). The
TypeScript `pg` helper that used to make this easy to get wrong has been
deleted, along with the `@db` tag and the `describeWithDatabase` fixture.

*Agreed 6 October 2026.* Before it was written down, TC51, TC52 and TC55 were
built as Playwright specs against that helper — the wrong side of this line.
They now live in `database/tests/`, and the traceability matrix credits them
there: [`scripts/specscan.py`](scripts/specscan.py) reads both stacks, so a
case automated in pytest counts exactly as one automated in Playwright.

## Test cases live in TestQuality

Cases are designed, numbered and owned there. Qase was tried and abandoned;
do not reach for it.

**The test design is not mine to write.** Steps, expected results and
priorities come from whoever owns the cases. What this repository may do is
*plumbing*: automate a designed case, derive bookkeeping, generate a report,
and point out a gap. Generating steps — especially from the specs, which would
be reading the answer off the test written to the case — is not plumbing.

The exports in `docs/test-cases/` are the interchange format. One column in
them, `test_is_automated`, is bookkeeping rather than design and is derived by
`scripts/mark-automated.py`.

## Paid tiers are out of scope

Every account this suite uses is on the basic tier — the one
`POST /test/users` creates and the one a new user gets.

The tier *limits* are in scope, because a new user meets them on their first
day: two groups, and the refusal of a third. The features *behind* the gate
are not. R-26 and TC45 are therefore uncovered **by choice**, not by omission.

If this changes, the harness needs one thing: a `tier` on `POST /test/users`.

*Agreed 6 October 2026.* See [What is not under test](README.md#what-is-not-under-test).

---

## Where things stand

*Last updated 6 October 2026. Update this when it stops being true — it is the
first thing a session with no memory of the work should read.*

Both halves of the agreed shape are **built and green**.

| | Count | |
| --- | --- | --- |
| Playwright | 78 | api 49, chromium 27, firefox 27, webkit 27 |
| pytest | 62 | every one of the 10 tables examined |
| Application unit tests | 38 | in the other repository |
| CI | 6 jobs | green on both repositories |

Traceability: 34 of 34 requirements have a case, **33 of 34 have a spec**, 57
of 61 designed cases are automated. The one requirement without a spec is R-26,
uncovered on purpose — see "Paid tiers are out of scope" above. The four cases
without one are in [not-automated.md](docs/test-cases/not-automated.md), and
each is a decision rather than work outstanding.

Defects: **22 found, 20 fixed, 1 open ([DEF-08](docs/defects/README.md)), 1 by
design.**

### Open, in the order I would pick them up

1. **DEF-08** — database-backed endpoints show multi-second maxima under load
   and the cause is not established. The instrumentation to answer it is
   written and unit-tested (`k6/lib/diagnose.js`, phase breakdown per request),
   but **k6 is not installed on this machine, so no instrumented run exists.**
   The scripts are written and untested in exactly the way this project
   criticises elsewhere, and that is recorded in the defect entry rather than
   glossed.
2. **Verification and reset codes are stored as issued, not hashed.** Not a
   failure against any documented rule, so it is not filed as a defect. It is
   a decision waiting for a human, with the argument both ways written into
   `database/tests/test_credentials_and_sessions.py`.
3. **`docs/test-cases/core-cases.csv` is generated and not imported.** It holds
   TC1–TC10 for TestQuality; importing it creates records in the user's test
   management and is their action, not mine.
4. **`performance.yml` has never run.** It exists and has no run history, so
   the k6 profiles have only local results behind them.
5. **The compose stack has never been run.** It is the first command the
   application's README offers for running locally. A newcomer's-first-command
   problem, not a shipping one — Render deploys the Node runtime.

### Written up for sharing

The pytest layer has a prose write-up for people outside the repositories:
**[PyTest Database Layer — What Was Built](https://claude.ai/code/artifact/74ad60a7-103e-4584-8d9c-3f120f161c88)**.
It covers why there are two stacks, what the layer asserts, what it found, and
what is deliberately not in it. If the layer changes materially, that document
goes stale and should be updated with it.

## Conventions that are easy to get wrong

**Spec naming decides where it runs.** `*.api.spec.ts` runs without a browser;
`*.ui.spec.ts` runs on all three engines. A file matching neither is silently
collected by no project and runs nowhere.

**Anything that creates asks for a fresh account first.** `userApi` is
worker-scoped and shared, which is right for reading and wrong for creating
anything capped — the basic tier allows two groups, so three specs each making
one leave the third failing on a limit unrelated to what it tests. Use
`freshApi` or `freshUserPage`.

**Time is pinned, never waited for.** Pinning is server-wide, so a spec that
pins carries `@serial` and runs in its own pass.

**R-08 only compares the next ninety days.** A collision spec with dates
further out has nothing to collide with. Compute dates relative to now rather
than hardcoding them, or the spec starts passing for the wrong reason.

**The alarm update verb is `PUT`, and it is a whole-resource replace.** Not
`PATCH`, which is not routed.

## After adding a spec

```bash
python scripts/traceability.py --app ../alarm-configurator
python scripts/mark-automated.py
```

Both are generated from the repository. Neither touches test design.

## Verifying a change

The two repositories have **separate** lint and typecheck, and CI runs each
repository's own. Running this one's and reporting it as clean says nothing
about the application — that mistake left the application's CI red for four
commits.

```bash
npm test                      # Playwright: api, then browsers, then @serial
npx tsc --noEmit              # this suite's types
cd database && python -m pytest tests     # the database layer
cd ../alarm-configurator && npm run lint && npm run typecheck && npm test
```

Both stacks, every time. A green Playwright run says nothing about whether the
rows are right.

## Measurement

Read the maximum, not the p95. Every p95 threshold passed on both of the load
runs that found DEF-08.
