# Load and stress testing

[k6](https://k6.io) scripts against the Nudge API, with a Prometheus and
Grafana stack for watching the application while they run.

## Running

The application must be running. Set `LIST_DELAY_MS=0` or the deliberate 600 ms
skeleton delay on the alarm list (A-01) dominates every measurement — it is a
testability feature, not latency.

```bash
# In the application repository
cd src/api && TEST_SUPPORT=1 LIST_DELAY_MS=0 node dist/boot.js
```

```bash
k6 run k6/smoke.js     # 1 user, 20s  — proves the script before a long run
k6 run k6/load.js      # 20 users     — normal mixed load
k6 run k6/stress.js    # steps to 100 — finds where it bends
k6 run k6/spike.js     # 5 → 100 → 5  — tests recovery, not peak
k6 run k6/auth.js      # sign-in only — characterises the hashing ceiling
```

`BASE_URL` overrides the target. An HTML report comes from
`K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html k6 run ...`, which
needs no other infrastructure.

## The scripts

| Script | Question it answers |
| --- | --- |
| `smoke.js` | Does the script work, against this target, with these credentials? |
| `load.js` | Does it hold up under the load a working day would produce? |
| `stress.js` | At what point does it stop coping, and how? |
| `spike.js` | After a sudden surge, does it recover or stay degraded? |
| `auth.js` | How many sign-ins a second, and where does that flatten? |

`load.js` mixes the endpoints a real session touches. The others isolate one
endpoint each, because a stress test that measures four things at once cannot
say which of them bent.

## Why sign-in happens once

Every script except `auth.js` signs in a single time in `setup()` and shares
the session. Passwords are hashed with scrypt — memory-hard by design, running
on Node's four-thread pool — so a hundred virtual users each signing in would
measure the hashing rather than the endpoint under test.

That ceiling is real and worth knowing, which is why `auth.js` measures it
deliberately instead of letting it contaminate everything else.

## Watching while it runs

```bash
docker compose -f k6/observability/docker-compose.yml up -d
k6 run k6/load.js
# http://localhost:3001 — admin / admin
```

Prometheus scrapes the application's `/metrics` every five seconds; Grafana is
provisioned with a dashboard showing request rate and p95 by route, responses
by status, memory, CPU, and **event loop lag** — the one that explains stalls
that request timings alone do not.

Needs Docker. The scripts and the findings do not.

## Results

[`results/`](results/) holds the write-up of each run: what was measured, what
it showed, and what it did not cover.
