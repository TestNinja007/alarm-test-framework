# alarm-test-framework

[![Suite](https://github.com/TestNinja007/alarm-test-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/TestNinja007/alarm-test-framework/actions/workflows/ci.yml)

**[Read the latest run →](https://testninja007.github.io/alarm-test-framework/)**
— every spec, every engine, with traces. Published from `main` on each run, and
merged from the four matrix jobs so one page holds the lot.

> The badge is one bit of information. The report is the evidence behind it,
> which is the part worth reading.

Automated tests for **Nudge** ([alarm-configurator](https://github.com/TestNinja007/alarm-configurator)),
kept in a repository of their own.

The separation is deliberate. Tests here are written against the application's
published interface — its OpenAPI document, its rendered pages, its documented
requirements — rather than against internals they happen to be able to see. It
also removes the quiet failure mode where an application is adjusted until a
test passes.

Two things here are worth reading before the code: the
[defect register](docs/defects/), which records every defect found and what now
stops each one coming back, and the [load testing](#load-testing), which found
a bottleneck that every percentile threshold in the run reported as healthy.

## Running it

The suite needs an instance started with `TEST_SUPPORT=1`. Without those hooks
it cannot restore state or control time, and it refuses to start rather than
producing a wall of red that says nothing.

```bash
# In the application repository
cd src/api && TEST_SUPPORT=1 node dist/boot.js
```

```bash
# Here
npm ci
npx playwright install
cp .env.example .env
npm test
```

| Command | What it runs |
| --- | --- |
| `npm test` | everything, in the right passes |
| `npm run test:api` | the API project only, no browser |
| `npm run test:ui` | Chromium only |
| `npm run test:browsers` | all three engines, one at a time |
| `npm run test:smoke` | the framework's own checks |
| `npm run test:parallel` | everything except the clock-dependent specs |
| `npm run test:serial` | the clock-dependent specs, one worker |
| `npm run report` | opens the last HTML report |

`npm test` runs three passes rather than one command, and that is not
housekeeping. Pinning the clock is server-wide state, so a single
`playwright test` over both kinds of spec gives the other workers' sessions an
expiry taken from the pinned instant — which surfaces as
`Session is missing or expired` in some unrelated spec minutes later. The
split used to live only in `test:parallel` and `test:serial`, which meant the
obvious command was the wrong one; it is structural now, because that trap
caught the author of these specs twice.

`npm test` runs one engine on purpose. Three browser engines competing for
one laptop — and for the single Node process they are all testing — made the
slower ones time out. Cross-engine coverage is a continuous-integration
concern, where each engine gets a runner of its own, and `test:browsers`
runs them sequentially when it is wanted locally.

## How it is arranged

```
src/
  fixtures.ts           the fixtures every spec builds on
  globalSetup.ts        health check, then restore the seed profile
  globalTeardown.ts     release the clock, close the pool
  pages/                page objects: the wizard, dashboard, alarm table
  support/
    env.ts              one place that reads the environment
    apiClient.ts        sessions and the CSRF header
    testHooks.ts        /test/* — reset, clock, throwaway users, mail
    db.ts               direct SQL, for what the API cannot assert
tests/
  alarms/               creating, editing, deleting, switching off
  auth/                 signing in
  groups/               groups, and what deleting one takes with it
  smoke/                checks on the framework itself
docs/
  test-cases/           cases exported from TestQuality
  defects/              every defect found, how it was found, what guards it
k6/
  smoke|load|stress|spike|auth.js    the load profiles
  observability/        Prometheus and Grafana, for watching a run
  results/              what each run measured
```

Specs are named for the layer they run at: `*.api.spec.ts` runs without a
browser, `*.ui.spec.ts` runs in Chromium, Firefox and WebKit.

## The decisions worth knowing

**State is restored once per run, not between tests.** With workers running in
parallel, a reset between tests would have each worker wiping the others' data.

**Isolation comes from throwaway accounts.** A test that creates or changes
anything asks the application for a fresh account first, so two tests can never
see each other's data. Tests that only read use the seeded account, which
nothing mutates.

**Time is pinned, never waited for.** The application exposes a single clock it
will let a test set, so daylight-saving behaviour is a fixed instant and an
expected result rather than a wait until March. Pinning is server-wide, so
those specs carry `@serial` and run in a pass of their own.

**There are no retries.** A test that passes on the second attempt is one
nobody can trust, and retrying buries the evidence needed to fix it. Flaky
specs are repaired or deleted.

**The browser projects run two workers, the API project four.** Measured, not
guessed. The UI specs pass 24 of 24 executions at two workers in 21.6 s; at
three and four they fail intermittently, and each failure costs a flat ten
seconds, making the higher count both less reliable and slower. The
application is not the constraint — its event-loop lag stays at 2 ms, 548 of
549 requests complete inside two seconds, and raising the database pool from
10 to 40 changes nothing. The exact-ten-second signature is the same one in
[DEF-08](docs/defects/#def-08), and it is capped rather than explained, which
is the honest state of it.

**The clicks are the test; the API is the oracle.** A UI spec drives the
interface the way a person does, then asks the server what was actually
stored. Neither half alone is enough: an API spec cannot see a form that
reports success and writes nothing, or a feature with no button
([DEF-10](docs/defects/#def-10)), or a browser that keeps speaking after the
alarm is switched off ([DEF-05](docs/defects/#def-05)) — and a UI assertion
alone cannot tell a saved record from a cached row.

**Sign-in for browser specs happens through the API.** Thirty specs that each
fill in the sign-in form are thirty specs that fail when that form breaks,
which tells you nothing the one spec testing sign-in did not.

**The database is a last resort.** Asserting through the API exercises what a
user reaches. Direct SQL is for the questions the API cannot answer — whether a
cascade truly removed rows, whether a column really holds UTC. Those specs are
tagged `@db` and skip when `DATABASE_URL` is unset.

## Tags

| Tag | Meaning |
| --- | --- |
| `@smoke` | the framework's own checks, or a minimal product check |
| `@ui` | drives the interface in a browser, rather than the API |
| `@serial` | pins the clock, so it cannot run beside anything else |
| `@db` | needs direct database access |

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) stands up PostgreSQL,
checks out the application, builds and starts it with the test hooks on, and
runs the suite in two passes — parallel, then the clock-dependent specs alone.
The HTML report is kept as an artifact, and the application's log is kept when
a run fails.

CI is the authority. A test passing on a development machine is not evidence,
because a working tree is half-edited by definition.

## Load testing

Five k6 profiles in [`k6/`](k6/), each with a job rather than a number:
`smoke` proves the script before a long run wastes ten minutes discovering the
credentials were wrong, `load` is a plausible working day, `stress` steps
upward until something bends, `spike` jumps without warning, and `auth` measures
sign-in on purpose because it costs six times what anything else does.

The [first run](k6/results/2026-10-05-first-run.md) is written up in full. Its
headline:

> The stress profile drove one endpoint to 100 concurrent users and 84,285
> requests with no failures at all. The *mixed* profile, at a fifth of that
> concurrency, produced 50-second maximums and 0.75% failures — because the
> endpoint that scaled never touches the database and the ones that queued all
> do.

**Every p95 threshold passed while that was happening.** The measurement that
found it was the maximum. That is the argument for reading a distribution
rather than a summary, and it is the reason
[`observability/`](k6/observability/) exists: a Prometheus and Grafana stack
with a dashboard whose most useful panel is event-loop lag, which is the one
thing request timings cannot explain.

## Defects

[`docs/defects/`](docs/defects/) is the register: eighteen defects with
severity, priority, root cause, the fix, and — the column that matters — what
regression coverage each one has now, named specifically, or the honest word
*none*.

Sorted by how they were found, it is also an audit of this project's own
testing. Eight came from using the application, nine from reading
configuration, logs or documentation, from a failed deploy or from a load run,
and exactly one from the automated suite. That last number is low because the suite was written after
the product; the defect it caught was the first one nobody had found by using
it, and it was a success status returned for a request that meant something
else.
