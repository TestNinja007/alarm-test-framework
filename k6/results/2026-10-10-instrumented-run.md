# 10 October 2026 — the first instrumented run

The run DEF-08's instrumentation was written for. **The fault did not
reproduce**, at the load that found it or at five times that load.

This is not a fix. Nothing was changed to make it go away, and the evidence
below is about where the time went rather than about what was wrong.

| | |
| --- | --- |
| k6 | v2.2.0, installed for this run |
| Target | one local process, PostgreSQL 18, Windows |
| Configuration | `TEST_SUPPORT=1 REGISTRATION_OPEN=1 LIST_DELAY_MS=0` |
| Profiles | smoke (1 VU), load (20 VUs), stress (to 100 VUs) |

## What the phase breakdown says

The question DEF-08 could not answer was *where* the missing time went. The
application's own log showed nothing above about ten seconds and never once
between one and five, against a client-measured maximum of 1m40s. These are
the phases that argument needed.

### load — 20 VUs, 90s, 16,514 requests, 0.00% failed

| Metric | avg | med | p95 | max |
| --- | --- | --- | --- | --- |
| `phase_blocked` | 3.53µs | 0s | 0s | **1.84ms** |
| `phase_connecting` | 647ns | 0s | 0s | **1.69ms** |
| `phase_waiting` | 91.03ms | 86.34ms | 183.26ms | 303.43ms |
| `http_req_duration` | 91.08ms | 86.38ms | 183.28ms | 303.43ms |

Every endpoint threshold passed: list p95 198ms (<300), upcoming 197ms (<400),
preview 112ms (<400), conflicts 169ms (<800).

### stress — to 100 VUs, 2m50s, 101,501 requests at 597/s, 0.00% failed

| Metric | avg | med | p95 | max |
| --- | --- | --- | --- | --- |
| `phase_blocked` | 2.73µs | 0s | 0s | **2.38ms** |
| `phase_connecting` | 463ns | 0s | 0s | **580.9µs** |
| `phase_waiting` | 85.93ms | 79.22ms | 165.4ms | 286.87ms |

**Five times the users that found the fault, and the maximum went down.**

## Reading it

**Essentially no time on the connection path.** `blocked` and `connecting`
together peaked at a few milliseconds across 118,000 requests. The prediction
written into DEF-08 was that a reproduction would show the ten-second cluster
in those two phases; there is no cluster to place, because there are no slow
requests at all.

**All the time is the server thinking**, and it thinks quickly: a 287ms
maximum under a hundred concurrent users, with every request answered.

**So the application is not where the fault was.** That was already the
conclusion from comparing the client against the server's request log, and
this says the same thing from the other direction: the same code at five times
the load produces nothing like the original numbers. What changed between the
runs is the machine, not the code — including a Windows version change between
sessions.

## What this does and does not settle

Settled: **it is not the request handling, and it is not load.** 101,501
requests at 597 a second is far more than the original run and produced a
maximum two orders of magnitude smaller.

Not settled: **what it actually was.** A fault that does not reproduce has not
been explained, and the direction recorded in DEF-08 — interference on the
connection path, on this machine — is still a direction. It is better
supported now, because the application has been ruled out twice by independent
measurements, but it has not been demonstrated.

The honest status is: reproducible when it happens, absent today, cause not
established, and the instrumentation is in place to localise it the next time
it appears.

## One mistake worth recording

The first load run today crossed the `endpoint_list` threshold — p95 678ms
against a limit of 300. That was mine: I started the application without
`LIST_DELAY_MS=0`, so every list request paid the deliberate 600ms skeleton
delay from A-01. `k6/README.md` says to set it, in its third line, and CI sets
it. The measurement was of a sleep I had configured.

`endpoint_list` min was 603ms, which is what gives it away — a floor that
exact is a constant, not contention. Worth remembering as a reading habit: a
minimum far above zero is a configured delay or a round trip, never load.
