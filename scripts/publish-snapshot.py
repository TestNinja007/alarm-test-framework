#!/usr/bin/env python3
"""Publish a Grafana dashboard as a public snapshot, and print its URL.

A snapshot carries its own data. That is what makes it the right artefact for
a load test run in CI: the runner is destroyed minutes later, and the link
still opens an interactive dashboard showing what happened. The alternative --
a hosted Grafana with a live datasource -- needs infrastructure that stays up
and keeps costing something to show a graph nobody is looking at.

Used by .github/workflows/performance.yml, and runnable by hand against a
local Grafana:

    python3 scripts/publish-snapshot.py --grafana http://127.0.0.1:3000 \\
        --user admin --password <password> --uid nudge-load --name "A spike"
"""

import argparse
import base64
import datetime
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def request(url, token, payload=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method='POST' if data else 'GET')
    req.add_header('Authorization', f'Basic {token}')
    req.add_header('Accept', 'application/json')
    if data:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode())


def query_range(prometheus, expression, window, step):
    """One Prometheus range query, returned as its raw result list."""
    params = urllib.parse.urlencode(
        {'query': expression, 'start': window[0], 'end': window[1], 'step': step}
    )
    url = f'{prometheus.rstrip("/")}/api/v1/query_range?{params}'
    with urllib.request.urlopen(url, timeout=60) as response:
        body = json.loads(response.read().decode())
    if body.get('status') != 'success':
        raise RuntimeError(body.get('error', 'query failed'))
    return body['data']['result']


def series_name(metric, legend):
    """Grafana's legendFormat, resolved against a series' labels.

    Only the `{{label}}` substitution, which is all this dashboard uses. A
    series with nothing left to call itself falls back to its metric name,
    because an unnamed line in a legend is no use to anyone.
    """
    if legend:
        name = re.sub(r'\{\{\s*(\w+)\s*\}\}', lambda m: metric.get(m.group(1), ''), legend)
        if name.strip():
            return name.strip()
    labels = {k: v for k, v in metric.items() if k != '__name__'}
    base = metric.get('__name__', 'value')
    return f'{base}{{{", ".join(f"{k}={v}" for k, v in labels.items())}}}' if labels else base


def embed_data(dashboard, prometheus, window_from, step):
    """Attach each panel's data to it, the way the browser would.

    Grafana builds `snapshotData` in the front end, from panels it has already
    rendered. Creating a snapshot through the API instead hands the backend a
    dashboard definition and nothing else, and the result is a dashboard with
    no data and no datasource left to fetch it from -- which still returns a
    URL, and still looks like it worked.

    So the data is fetched here and attached in the same shape: one frame per
    series, a time field and a value field.
    """
    end = int(time.time())
    minutes = int(re.sub(r'\D', '', window_from) or 30)
    start = end - minutes * 60
    total = 0

    for panel in dashboard.get('panels', []):
        frames = []
        for target in panel.get('targets', []):
            expression = target.get('expr')
            if not expression:
                continue
            try:
                results = query_range(prometheus, expression, (start, end), step)
            except Exception as error:  # noqa: BLE001 - one bad panel is not fatal
                print(f'  panel "{panel.get("title")}": {error}', file=sys.stderr)
                continue

            for series in results:
                values = series.get('values', [])
                if not values:
                    continue
                times = [int(float(t) * 1000) for t, _ in values]
                # NaN and +Inf are what a quantile over an empty bucket gives
                # back, and they belong in the chart as gaps, not as zeroes.
                numbers = [None if v in ('NaN', '+Inf', '-Inf') else float(v) for _, v in values]
                frames.append(
                    {
                        'name': series_name(series.get('metric', {}), target.get('legendFormat')),
                        'refId': target.get('refId', 'A'),
                        'meta': {},
                        'fields': [
                            {'name': 'Time', 'type': 'time', 'config': {}, 'values': times},
                            {
                                'name': 'Value',
                                'type': 'number',
                                'config': {
                                    'displayNameFromDS': series_name(
                                        series.get('metric', {}), target.get('legendFormat')
                                    )
                                },
                                'values': numbers,
                            },
                        ],
                    }
                )
                total += len(values)

        if frames:
            panel['snapshotData'] = frames
        # Without this the panel still names a datasource the snapshot cannot
        # reach, and Grafana prefers querying it to reading what is embedded.
        panel.pop('datasource', None)
        for target in panel.get('targets', []):
            target.pop('datasource', None)

    dashboard['snapshot'] = {'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--grafana', required=True)
    parser.add_argument('--user', required=True)
    parser.add_argument('--password', required=True)
    parser.add_argument('--uid', required=True, help='Dashboard uid, e.g. nudge-load')
    parser.add_argument('--name', default='Snapshot')
    parser.add_argument(
        '--window',
        default='now-30m',
        help='Start of the range to capture. The default covers a CI load run with room either side.',
    )
    parser.add_argument('--expires', type=int, default=0, help='Seconds; 0 means never.')
    parser.add_argument(
        '--prometheus',
        default='http://127.0.0.1:9090',
        help='Where to read the panel data from, since the snapshot has to carry its own.',
    )
    parser.add_argument('--step', default='10', help='Resolution of the embedded series, in seconds.')
    parser.add_argument(
        '--no-external',
        action='store_true',
        help='Keep the snapshot on this Grafana instead of publishing it. For checking the '
        'script without posting anything publicly.',
    )
    args = parser.parse_args()

    base = args.grafana.rstrip('/')
    token = base64.b64encode(f'{args.user}:{args.password}'.encode()).decode()

    try:
        found = request(f'{base}/api/dashboards/uid/{args.uid}', token)
    except urllib.error.HTTPError as error:
        print(f'Could not read dashboard {args.uid}: {error.code} {error.reason}', file=sys.stderr)
        return 1

    dashboard = found['dashboard']
    # A snapshot keeps whatever range it was taken over, so it has to be set
    # here rather than inherited from the dashboard's saved default.
    dashboard['time'] = {'from': args.window, 'to': 'now'}
    # Nothing is watching a frozen snapshot; refreshing it only makes the page
    # work for no reason.
    dashboard['refresh'] = False

    points = embed_data(dashboard, args.prometheus, args.window, args.step)
    if points == 0:
        print(
            'Refusing to publish: no data came back for any panel. A snapshot '
            'with no data renders as an empty dashboard and looks like a '
            'successful publish.',
            file=sys.stderr,
        )
        return 1
    print(f'Embedded {points} data points across {len(dashboard.get("panels", []))} panels.')

    payload = {
        'dashboard': dashboard,
        'name': args.name,
        'expires': args.expires,
        # Hand it to the public snapshot service rather than keeping it on a
        # Grafana that is about to be deleted with the runner.
        'external': not args.no_external,
    }

    try:
        created = request(f'{base}/api/snapshots', token, payload)
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors='replace')[:300]
        print(f'Snapshot was refused: {error.code} {error.reason} — {body}', file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f'Could not reach the snapshot service: {error.reason}', file=sys.stderr)
        return 1

    url = created.get('url') or created.get('externalUrl')
    if not url:
        print(f'No URL in the response: {created}', file=sys.stderr)
        return 1

    print(f'Dashboard: {args.name}')
    if created.get('deleteUrl'):
        # Printed because an external snapshot is public and this is the only
        # way to take it down again.
        print(f'Delete:    {created["deleteUrl"]}')
    print(url)
    return 0


if __name__ == '__main__':
    sys.exit(main())
