# Running the stack without Docker

Prometheus and Grafana both ship Windows binaries, so the observability stack
needs no container. This is the path that has actually been run; the compose
file one directory up is the containerised equivalent and remains unverified.

The two differ in exactly two settings, which is why the configuration here is
a separate copy rather than a parameter: inside Docker the application is
reached through a gateway alias and Grafana finds Prometheus by service name,
and natively both are on localhost. A single file with a placeholder would be
subtly wrong for one of them.

## What you need

| | |
| --- | --- |
| Prometheus | `prometheus-<version>.windows-amd64.zip` from [its releases](https://github.com/prometheus/prometheus/releases) |
| Grafana | `grafana-<version>.windows-amd64.zip` from [dl.grafana.com](https://grafana.com/grafana/download?platform=windows) |

Unzip both somewhere outside the repository. Nothing is installed and nothing
is registered as a service; both are run from where they were unzipped.

## Running it

The application has to be up first, with metrics exposed — they are always on,
at `/metrics`.

```bash
# In the application repository
cd src/api && TEST_SUPPORT=1 LIST_DELAY_MS=0 node dist/boot.js
```

Prometheus, pointed at the config in this directory:

```bash
./prometheus.exe \
  --config.file=<repo>/k6/observability/native/prometheus.yml \
  --storage.tsdb.path=./prom-data \
  --web.listen-address=127.0.0.1:9090
```

Grafana needs the two provisioning files copied into its own `conf/provisioning`
tree, and one environment variable so it can find the dashboard:

```bash
cp native/grafana/datasources/prometheus.yml  <grafana>/conf/provisioning/datasources/nudge.yml
cp native/grafana/dashboards/dashboards.yml   <grafana>/conf/provisioning/dashboards/nudge.yml
```

```bash
NUDGE_DASHBOARDS="<repo>/k6/observability/grafana/provisioning/dashboards" \
GF_SERVER_HTTP_ADDR=127.0.0.1 \
GF_AUTH_ANONYMOUS_ENABLED=true \
GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer \
./grafana.exe server --homepath <grafana>
```

`NUDGE_DASHBOARDS` points at the *container* path's dashboard directory on
purpose, so both ways of running the stack provision the same `nudge.json` and
cannot drift apart.

Anonymous viewing is on because this binds to `127.0.0.1` and the only thing it
shows is a local application's own metrics. It also means the dashboard opens
without a password, which is the point of a local dashboard. Do not carry that
setting to anything reachable from elsewhere.

The dashboard is then at
**http://127.0.0.1:3000/d/nudge-load/nudge-under-load**, and
`?from=now-15m&to=now&kiosk` drops the chrome if you want to screenshot it.

## Checking it works before running a load test

A dashboard with no data looks the same whether it is wired up wrongly or
nothing has happened yet, which is worth ruling out first:

```bash
# Is Prometheus scraping the application?
curl -s http://127.0.0.1:9090/api/v1/targets | grep -o '"health":"[a-z]*"'
```

The `nudge` job reports `unknown` until the first scrape completes — five
seconds — so give it a moment before concluding anything.

```bash
# Has it got the metric the most useful panel is built on?
curl -s 'http://127.0.0.1:9090/api/v1/query?query=nodejs_eventloop_lag_seconds'
```

## What it is for

The panel worth watching is **event loop lag**, and the reason is a comparison
this project has now seen both halves of.

During the spike profile, lag p99 rose to 364 ms and fell back to 17 ms while
p95 latency went to 2.4 s and recovered. That is a server genuinely busy, and
then not.

During the mixed load profile, requests took as long as a hundred seconds while
lag stayed at **2 ms** and the application's own log showed nothing slower than
ten seconds. That is a server doing nothing while something between it and the
client holds the request — a completely different fault with completely similar
request timings. See [DEF-08](../../../docs/defects/#def-08).

Request timings alone cannot tell those apart. That is what this stack is for.

## Publishing a run

[`scripts/publish-snapshot.py`](../../../scripts/publish-snapshot.py) turns a
dashboard into a Grafana snapshot — a dashboard that carries its own data, so
the link keeps working after the Prometheus that produced it is gone. That is
what makes it the right artefact for CI: the runner is destroyed minutes later.

```bash
python3 scripts/publish-snapshot.py \
  --grafana http://127.0.0.1:3000 --user admin --password <password> \
  --uid nudge-load --window now-30m --no-external
```

Drop `--no-external` to publish to Grafana's public snapshot service instead
of keeping it local. That posts the dashboard **and its data** somewhere
public, so it is opt-in rather than the default for a hand-run.

**Why the script fetches the data itself.** Grafana builds `snapshotData` in
the front end, out of panels it has already drawn. Creating a snapshot through
the API hands the backend a dashboard definition and nothing else — and the
result is a dashboard with no data and no datasource left to fetch any, which
still returns a URL and still looks like it worked. The first version of this
did exactly that: six panels, zero data points, a perfectly good link to an
empty chart. So the script queries Prometheus for each panel's expression and
attaches the frames itself, and refuses to publish when nothing came back.
