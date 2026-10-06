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

A direct SQL assertion belongs in pytest. It does not belong in a Playwright
`@db` spec, however convenient the TypeScript helper is.

*Agreed 6 October 2026.* Before it was written down, TC51, TC52 and TC55 were
built as Playwright specs against a TypeScript `pg` helper — the wrong side of
this line.

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
npm test                      # this suite: api, then browsers, then @serial
npx tsc --noEmit              # this suite's types
cd ../alarm-configurator && npm run lint && npm run typecheck && npm test
```

## Measurement

Read the maximum, not the p95. Every p95 threshold passed on both of the load
runs that found DEF-08.
