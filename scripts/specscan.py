#!/usr/bin/env python3
"""
Finding the automated specs, across both stacks.

This repository has two test stacks on purpose - Playwright and TypeScript for
UI and API, pytest for the database layer - so "is this case automated?" has
two places to look. Keeping that in one module means the matrix, the
TestQuality bookkeeping and anything added later all agree about the answer.

Two copies of a spec-finding regex is not hypothetical: the matrix spent a
while reporting specs as missing because its pattern matched only
single-quoted test titles while some were written with double quotes. One
copy, used by everything.
"""

import io
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Playwright: test('TC51: ...') or test("TC32: ...")
# Either quote style, because a title containing an apostrophe is written with
# double quotes and matching only single ones hides it.
TS_TEST = re.compile(r"""test\(\s*['\"](TC(\d+)[a-z]?):\s*(.+?)['\"]""")

# pytest: def test_tc51_deleting_a_group_deletes_its_alarms(...)
# The suffix form (tc51b) is allowed for the same reason it is in TypeScript -
# a second spec against one case.
PY_TEST = re.compile(r'^\s*def (test_tc(\d+)([a-z]?)_([a-z0-9_]+))\s*\(')


def playwright_specs(tests_dir):
    """Case id -> [(file, case, title)] from the Playwright suite."""
    found = defaultdict(list)
    for root, _dirs, files in os.walk(tests_dir):
        for name in sorted(files):
            if not name.endswith('.spec.ts'):
                continue
            path = os.path.join(root, name)
            relative = os.path.relpath(path, HERE).replace('\\', '/')
            for line in io.open(path, encoding='utf-8'):
                match = TS_TEST.search(line)
                if match:
                    found[int(match.group(2))].append(
                        (relative, match.group(1), match.group(3))
                    )
    return found


def pytest_specs(database_dir):
    """
    Case id -> [(file, case, title)] from the database layer.

    The function name carries the case, so the readable title is reconstructed
    from the rest of it. Tests here that are not named for a case are real
    coverage but answer no designed case, and are counted separately rather
    than invented into one - the cases are not mine to create.
    """
    found = defaultdict(list)
    unnumbered = []
    if not os.path.isdir(database_dir):
        return found, unnumbered

    for root, _dirs, files in os.walk(database_dir):
        for name in sorted(files):
            if not (name.startswith('test_') and name.endswith('.py')):
                continue
            path = os.path.join(root, name)
            relative = os.path.relpath(path, HERE).replace('\\', '/')
            for line in io.open(path, encoding='utf-8'):
                stripped = line.strip()
                if not stripped.startswith('def test'):
                    continue
                match = PY_TEST.match(line)
                if match:
                    case = 'TC' + match.group(2) + match.group(3)
                    title = match.group(4).replace('_', ' ')
                    found[int(match.group(2))].append((relative, case, title))
                else:
                    unnumbered.append((relative, stripped[4:].split('(')[0]))
    return found, unnumbered


def specs(tests_dir=None, database_dir=None):
    """
    Everything automated, from both stacks, merged by case id.

    Signature kept compatible with the single-argument form the callers used
    when there was only one stack.
    """
    tests_dir = tests_dir or os.path.join(HERE, 'tests')
    database_dir = database_dir or os.path.join(HERE, 'database')

    merged = defaultdict(list)
    for case, entries in playwright_specs(tests_dir).items():
        merged[case].extend(entries)
    found, _unnumbered = pytest_specs(database_dir)
    for case, entries in found.items():
        merged[case].extend(entries)
    return merged


def database_layer_extras(database_dir=None):
    """The database tests that answer no designed case."""
    database_dir = database_dir or os.path.join(HERE, 'database')
    _found, unnumbered = pytest_specs(database_dir)
    return unnumbered
