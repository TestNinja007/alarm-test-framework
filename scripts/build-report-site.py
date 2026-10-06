#!/usr/bin/env python3
"""
Build the front page for the published results site.

The site holds two reports, because the two stacks are two stacks: Playwright's
own HTML report with its traces and screenshots, and pytest's. Merging them
into one format would mean going through JUnit XML, which is the only thing
both speak and which throws away the traces - the most useful thing in the
Playwright report.

So they stay native and this page is the way in. Without it, a visitor lands
on one report and draws the wrong conclusion about what is covered: 78 of 140
tests, presented as the results.

    python scripts/build-report-site.py \\
        --playwright-json playwright-results.json \\
        --database-xml database-report/results.xml \\
        --out site/index.html

Every input is optional. A missing one is reported as unavailable on the page
rather than left out or guessed at - a results page that quietly omits a stack
is the problem this page exists to solve.
"""

import argparse
import html
import io
import json
import os
import xml.etree.ElementTree as ET

STACKS = [
    ("Playwright", "playwright/index.html", "UI across Chromium, Firefox and WebKit, and the API behind it"),
    ("Database", "database/index.html", "pytest, querying PostgreSQL directly"),
]


def playwright_counts(path):
    """Totals from Playwright's JSON reporter."""
    if not path or not os.path.exists(path):
        return None
    try:
        with io.open(path, encoding="utf-8") as handle:
            report = json.load(handle)
    except (ValueError, OSError):
        return None

    counts = {"passed": 0, "failed": 0, "skipped": 0, "flaky": 0}

    def walk(suite):
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                status = test.get("status")
                if status in counts:
                    counts[status] += 1
                elif status == "unexpected":
                    counts["failed"] += 1
                elif status == "expected":
                    counts["passed"] += 1
        for child in suite.get("suites", []):
            walk(child)

    for suite in report.get("suites", []):
        walk(suite)

    if sum(counts.values()) == 0:
        return None
    return counts


def database_counts(path):
    """Totals from pytest's JUnit XML."""
    if not path or not os.path.exists(path):
        return None
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return None

    suite = root.find("testsuite")
    if suite is None:
        suite = root

    def number(name):
        try:
            return int(suite.get(name, 0))
        except (TypeError, ValueError):
            return 0

    total = number("tests")
    if total == 0:
        return None

    failed = number("failures") + number("errors")
    skipped = number("skipped")
    return {
        "passed": total - failed - skipped,
        "failed": failed,
        "skipped": skipped,
        "flaky": 0,
    }


def verdict(counts):
    if counts is None:
        return "unavailable", "This stack did not produce a report for this run."
    if counts["failed"]:
        return "failing", "{} failing".format(counts["failed"])
    note = "{} passing".format(counts["passed"])
    if counts["skipped"]:
        note += ", {} skipped".format(counts["skipped"])
    if counts["flaky"]:
        note += ", {} flaky".format(counts["flaky"])
    return "passing", note


def card(name, href, blurb, counts):
    state, note = verdict(counts)
    total = "—" if counts is None else str(sum(counts.values()))
    link = (
        '<a class="card {state}" href="{href}">'
        if state != "unavailable"
        else '<div class="card {state}">'
    ).format(state=state, href=html.escape(href))
    close = "</a>" if state != "unavailable" else "</div>"
    return """      {link}
        <p class="total">{total}</p>
        <h2>{name}</h2>
        <p class="blurb">{blurb}</p>
        <p class="note">{note}</p>
      {close}""".format(
        link=link,
        total=total,
        name=html.escape(name),
        blurb=html.escape(blurb),
        note=html.escape(note),
        close=close,
    )


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nudge — test results</title>
<style>
  :root {{
    --bg: #ffffff; --fg: #18181b; --muted: #71717a; --border: #e4e4e7;
    --surface: #fafafa; --pass: #15803d; --fail: #b91c1c;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --border: #27272a;
      --surface: #18181b; --pass: #4ade80; --fail: #f87171;
    }}
  }}
  :root[data-theme="dark"] {{
    --bg: #09090b; --fg: #fafafa; --muted: #a1a1aa; --border: #27272a;
    --surface: #18181b; --pass: #4ade80; --fail: #f87171;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 48px 16px; background: var(--bg); color: var(--fg);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }}
  main {{ max-width: 720px; margin: 0 auto; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.02em; }}
  .lede {{ color: var(--muted); margin: 0 0 32px; }}
  .cards {{ display: grid; gap: 16px; grid-template-columns: 1fr; }}
  @media (min-width: 560px) {{ .cards {{ grid-template-columns: 1fr 1fr; }} }}
  .card {{
    display: block; padding: 20px; border: 1px solid var(--border);
    border-radius: 10px; background: var(--surface); color: inherit;
    text-decoration: none; transition: border-color .15s;
  }}
  a.card:hover {{ border-color: var(--muted); }}
  .total {{ font-size: 2rem; font-weight: 650; margin: 0; letter-spacing: -0.03em; }}
  .card h2 {{ font-size: 1rem; margin: 2px 0 6px; }}
  .blurb {{ color: var(--muted); font-size: .875rem; margin: 0 0 10px; }}
  .note {{ font-size: .875rem; font-weight: 550; margin: 0; }}
  .passing .note {{ color: var(--pass); }}
  .failing .note {{ color: var(--fail); }}
  .unavailable {{ opacity: .7; }}
  .unavailable .note {{ color: var(--muted); font-weight: 400; }}
  footer {{ margin-top: 32px; color: var(--muted); font-size: .8125rem; }}
  footer p {{ margin: 0 0 6px; }}
</style>
</head>
<body>
<main>
  <h1>Nudge — test results</h1>
  <p class="lede">{total} tests across two stacks. Each report is the one its own
  tool produces, so the Playwright traces and screenshots survive.</p>

  <div class="cards">
{cards}
  </div>

  <footer>
    <p>Published from the latest run on <code>main</code>.</p>
    <p>Four cases are deliberately not automated, and one requirement is
    uncovered because paid tiers are out of scope. Both are written down in the
    repository rather than implied by these numbers.</p>
  </footer>
</main>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--playwright-json")
    parser.add_argument("--database-xml")
    parser.add_argument("--out", default="site/index.html")
    args = parser.parse_args()

    found = [playwright_counts(args.playwright_json), database_counts(args.database_xml)]
    total = sum(sum(c.values()) for c in found if c)

    cards = "\n".join(
        card(name, href, blurb, counts)
        for (name, href, blurb), counts in zip(STACKS, found)
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with io.open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(PAGE.format(total=total, cards=cards))

    for (name, _href, _blurb), counts in zip(STACKS, found):
        state, note = verdict(counts)
        print("  {:<12} {:<12} {}".format(name, state, note))
    print("wrote {} ({} tests in all)".format(args.out, total))


if __name__ == "__main__":
    main()
