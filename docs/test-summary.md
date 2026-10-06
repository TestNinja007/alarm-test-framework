# Test summary report

**As of 6 October 2026.** A snapshot, not a living document — the numbers in
it come from the state recorded below and will age. What does not age is
[the matrix](traceability.md) and [the register](defects/), both generated or
maintained alongside the work.

## The short version

**Released, with two known defects and one requirement the product will not
let anyone test.** That last clause is the interesting one.

127 automated tests pass on every push across four runners. 57 of 61 designed
cases are automated, covering 33 of 34 requirements. Twenty-five of the
twenty-six P1 cases have a spec; the twenty-sixth is what a desktop
notification looks like, which is outside anything a browser can see.

Twenty-two defects have been found and nineteen fixed. The two still open are
Medium, and one of them has no established cause rather than merely no fix.

**R-26 is the one to argue about.** Within-day repetition — one of the
product's two stated differentiators — is gated to paid tiers, and the only
account the test hooks can create is on the basic tier. The feature cannot be
exercised through the interface by any account this suite can obtain. That is
not a gap in the testing; it is a gap in what the product allows to be
tested.

## What was tested

| Project | Tests | Layer |
| --- | --- | --- |
| api | 46 | HTTP and direct SQL, no browser |
| chromium | 27 | the interface |
| firefox | 27 | the interface |
| webkit | 27 | the interface |

127 in all per CI run, on Node 24 and PostgreSQL 18, against the application
built from source on the same runner. Nothing skips: the direct-SQL specs run
wherever `DATABASE_URL` is set, which CI always does.

Five k6 profiles have been run against a local instance — smoke, load, stress,
spike and authentication — with Prometheus and Grafana attached for the last
of them.

## Coverage

| | |
| --- | --- |
| Requirements | 34 |
| …with at least one case | 34 |
| …with at least one automated spec | **33** |
| Cases designed | 61 |
| Cases automated | **57** |
| Specs | 64 |

The four cases without a spec each have a different reason, written up in
[not-automated.md](test-cases/not-automated.md) rather than totalled: a
judgement about audio (TC7), a case satisfied by how the suite is arranged
rather than by a spec (TC8), what the operating system draws (TC46), and the
tier gate (TC45).

Only TC45 is a gap in coverage rather than a decision about it.

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
| Medium | 6 | 2 |
| Low | 7 | 0 |
| Informational | 1 | — |

Twenty-two found, nineteen fixed, two open, one recorded as by design.

**Five were found by the automated suite**, all of them faults nobody had hit
by using the application:

- An occurrence count of zero accepted as "never ends" — a wrong answer
  returned with a success status, found seconds into the suite's first run, by
  a case rated P3.
- Completing registration answering 500 while the account was created and
  verified perfectly well, so the person is told it failed by an application
  that has just succeeded.
- A pool connection failure reaching the client as an unhandled 500.
- A sign-in form with no client-side validation, against a rule the
  application's own documentation states — found because the case was written
  from that rule rather than from watching the form.
- The create wizard scrolling sideways at phone width, because a layout rule
  that meant to stop fields growing also stopped them shrinking.

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
| Every P1 case has a result | 25 of 26; the exception is what the desktop draws |
| No open Critical or High defects | yes |
| Automated suite green on the target branch | yes |
| Requirements traceable to cases and specs | 34 of 34 to cases, 33 of 34 to specs |
| Performance characterised under load | yes, with one bottleneck unexplained |

**Recommendation: ship it, and say what is not covered.** No open Critical or
High defects, every requirement traceable, and the one requirement without a
spec is unverifiable by design rather than unverified by omission.

The honest caveat to ship alongside: R-26 has never been executed by a test,
and DEF-08 is a reproducible performance fault with no established cause. Both
belong in a release note, not in a footnote.

## What would change this report

In order of what it would buy:

1. A tier on `POST /test/users`, which unblocks R-26 and with it the product's
   own differentiator. The notification harness TC45 needs already exists.
2. A cause for DEF-08, or a decision to accept it with the evidence attached.
3. Handling the pool failure in DEF-19 as a 503 rather than an unhandled 500.
4. A container build in CI, which is the one environment nothing verifies.

## Where the evidence is

| | |
| --- | --- |
| Latest run, every engine | <https://testninja007.github.io/alarm-test-framework/> |
| Traceability matrix | [`docs/traceability.md`](traceability.md) |
| Defect register | [`docs/defects/`](defects/) |
| Load test write-up | [`k6/results/`](../k6/results/2026-10-05-first-run.md) |
| Performance dashboard | <https://snapshots.raintank.io/dashboard/snapshot/4UAF0SpTmgYtP0SNrPMBVGOujoMth1qI> |
| CI | <https://github.com/TestNinja007/alarm-test-framework/actions> |
