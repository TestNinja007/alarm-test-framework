# Test summary report

**As of 6 October 2026.** A snapshot, not a living document — the numbers in
it come from the state recorded below and will age. What does not age is
[the matrix](traceability.md) and [the register](defects/), both generated or
maintained alongside the work.

## The short version

The suite is green and the product is not ready to release. Those are
compatible statements, and saying only the first would be the more common kind
of report.

87 automated tests pass on every push across four runners. 32 of 61 designed
cases are automated, covering 21 of 34 requirements. Twenty defects have been
found, seventeen fixed. Two remain open and one of those is unexplained rather
than merely unfixed.

**The exit criteria are not met.** Not because something is failing, but
because thirteen requirements have a designed case and no spec, and a
requirement nobody has run a test against is untested however green the
dashboard is.

## What was tested

| Project | Tests | Layer |
| --- | --- | --- |
| api | 33 | HTTP, no browser |
| chromium | 18 | the interface |
| firefox | 18 | the interface |
| webkit | 18 | the interface |

87 in all per CI run, on Node 24 and PostgreSQL 18, against the application
built from source on the same runner.

Five k6 profiles have been run against a local instance — smoke, load, stress,
spike and authentication — with Prometheus and Grafana attached for the last
of them.

## Coverage

| | |
| --- | --- |
| Requirements | 34 |
| …with at least one case | 34 |
| …with at least one automated spec | **21** |
| Cases designed | 61 |
| Cases automated | **32** |
| Specs | 40 |

The gap is specific rather than general, which is the useful thing about it.
Thirteen requirements have a case written and no spec running:

R-08 and R-09 (collision and name uniqueness), R-10 (deleting a group takes
its alarms), R-14 to R-17 and R-19 (password rules, code expiry and attempts,
session invalidation, account deletion), R-21 and R-22 (name uniqueness for
ungrouped alarms and for groups), R-25 and R-26 (voice resolution, closing
messages), R-27 (self-destructing alarms).

Three of those — R-19, R-17 and R-10 — are destructive or security-relevant
and are the ones to write next.

## Results

Every project passes. One spec skips locally and runs in CI: the direct-SQL
check, which needs a `DATABASE_URL` that CI provides and a development machine
usually does not.

**No retries, by policy.** Nothing in this suite passes on a second attempt,
because a test that does is one nobody can trust and retrying buries the
evidence. Three specs were repaired rather than retried while this report's
work was done, and each repair is a comment in the spec explaining what raced.

**Flakiness is bounded by configuration, not hidden.** The browser projects run
one worker. Above that, operations stall for exactly ten seconds at a time
while the application stays healthy — measured, unexplained, and recorded as
part of DEF-08 rather than silently worked around with retries.

## Defects

| Severity | Found | Open |
| --- | --- | --- |
| Critical | 2 | 0 |
| High | 6 | 0 |
| Medium | 5 | 2 |
| Low | 6 | 0 |
| Informational | 1 | — |

Twenty found, seventeen fixed, two open, one recorded as by design.

**Three were found by the automated suite**, all of them faults nobody had hit
by using the application:

- An occurrence count of zero accepted as "never ends" — a wrong answer
  returned with a success status, found seconds into the suite's first run, by
  a case rated P3.
- Completing registration answering 500 while the account was created and
  verified perfectly well, so the person is told it failed by an application
  that has just succeeded.
- A pool connection failure reaching the client as an unhandled 500.

The other seventeen came from using the application, reading configuration,
reading production logs, a failed deploy, a load run, and comparing
documentation against behaviour. Half were outside functional testing
altogether, which is the argument for the spread of testing types stated in
the plan and now demonstrated by it.

### The two still open

**DEF-08** — database-backed endpoints show multi-second maxima under modest
load. Originally diagnosed as connection-pool exhaustion; three experiments
disproved that, and the cause is not established. It is kept open with the
disproof attached rather than closed with a tidy story.

**DEF-19** — a connection the pool cannot obtain reaches the client as an
unhandled 500 rather than a 503. Half of this is a consequence of a hardening
change made against DEF-08, which converted a hang into an error exactly as
specified; the other half, that the error is unhandled, is a plain defect.

## Entry and exit criteria

| Criterion | Met |
| --- | --- |
| The application builds and starts from a clean checkout | yes — CI does it on every run |
| Test support hooks available in the test environment | yes |
| Every P1 case has a result | **no** |
| No open Critical or High defects | yes |
| Automated suite green on the target branch | yes |
| Requirements traceable to cases and specs | partly — 34 of 34 to cases, 21 of 34 to specs |
| Performance characterised under load | yes, with one bottleneck unexplained |

**Recommendation: not ready.** The product is in good shape and the testing is
not finished. The specific thing standing between here and an exit is thirteen
requirements with designed cases and no spec, three of which are destructive
or security-relevant.

## What would change this report

In order of what it would buy:

1. Specs for R-19, R-17 and R-10 — account deletion, session invalidation after
   a password reset, and group deletion taking its alarms. All destructive, all
   currently verified by reading.
2. Specs for R-14 to R-16 — the registration and verification rules around the
   path that already has one defect against it.
3. A cause for DEF-08, or a decision to accept it with the evidence attached.
4. The remaining 29 cases.

## Where the evidence is

| | |
| --- | --- |
| Latest run, every engine | <https://testninja007.github.io/alarm-test-framework/> |
| Traceability matrix | [`docs/traceability.md`](traceability.md) |
| Defect register | [`docs/defects/`](defects/) |
| Load test write-up | [`k6/results/`](../k6/results/2026-10-05-first-run.md) |
| Performance dashboard | <https://snapshots.raintank.io/dashboard/snapshot/4UAF0SpTmgYtP0SNrPMBVGOujoMth1qI> |
| CI | <https://github.com/TestNinja007/alarm-test-framework/actions> |
