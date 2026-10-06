#!/usr/bin/env python3
"""
Generate a TestQuality import for the original ten cases.

TC1-TC10 live in requirement-mapping.md as a title and a requirement. They
were never exported, so nine of them are absent from TestQuality's CSVs and
their automation status cannot be imported with the others - seven have specs
and nothing says so.

This writes those rows in the same eighteen-column schema the other exports
use, filling only what the repository actually knows:

    test_key, test_name, test_requirements   from requirement-mapping.md
    test_is_automated                        from the specs in tests/
    folder, type, labels                     conventions, see below

**The step fields are left empty on purpose.** Steps and expected results are
test design, and test design is not generated from a repository - least of all
from the specs, which would be reading the answer off the test that was
written to the case. They are left for whoever owns the cases to fill in
TestQuality, which is where cases live.

One structural choice was made and is easy to change before importing: these
go in a new folder, key 5, "Functional/Core", because every existing folder is
a specialisation (Negative, Recurrence, Lifecycle, Notification, Compatibility,
Destructive, Security, Boundary) and the original ten are the plain
capabilities none of those describe.

    python scripts/export-core-cases.py
"""

import csv
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'scripts'))

from traceability import specs  # noqa: E402

CASES = os.path.join(HERE, 'docs', 'test-cases')
MAPPING = os.path.join(CASES, 'requirement-mapping.md')
OUT = os.path.join(CASES, 'core-cases.csv')

FIELDS = [
    'folder_key', 'folder_name', 'test_key', 'test_name', 'test_description',
    'test_type', 'test_priority', 'test_precondition', 'test_assigned_to',
    'test_is_automated', 'test_estimate', 'test_attachments',
    'test_requirements', 'test_labels', 'step_description',
    'step_expected_result', 'step_sequence', 'data_set',
]

FOLDER = ('5', 'Functional/Core')

# Cross-browser behaviour is Compatibility in the vocabulary the other exports
# already use; everything else here is plain Functionality.
TYPES = {8: 'Compatibility'}


def read_mapping():
    """[(number, name, requirements, manual)] from the mapping table."""
    text = io.open(MAPPING, encoding='utf-8').read()
    rows = []
    for number, name, verifies in re.findall(
            r'^\| TC(\d+) \| (.+?) \| (.+?) \|$', text, re.M):
        requirements = ', '.join(re.findall(r'R-\d+', verifies))
        rows.append((int(number), name.strip(), requirements,
                     'manual' in verifies.lower()))
    return rows


def already_exported():
    keys = set()
    for name in ['negative-cases.csv', 'coverage-cases.csv']:
        path = os.path.join(CASES, name)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding='utf-8', newline='') as handle:
            for row in csv.DictReader(handle):
                if row.get('test_key', '').strip().isdigit():
                    keys.add(int(row['test_key']))
    return keys


def main():
    automated = specs(os.path.join(HERE, 'tests'))
    exported = already_exported()

    rows = []
    skipped = []
    for number, name, requirements, manual in read_mapping():
        if number in exported:
            # TC4 is already there under a fuller name. Re-exporting it would
            # either duplicate the case or overwrite the better description.
            skipped.append(number)
            continue

        labels = ['Core']
        if manual:
            labels.append('Manual')

        rows.append({
            'folder_key': FOLDER[0],
            'folder_name': FOLDER[1],
            'test_key': str(number),
            'test_name': name,
            'test_description': '',
            'test_type': TYPES.get(number, 'Functionality'),
            'test_priority': '',
            'test_precondition': '',
            'test_assigned_to': '',
            'test_is_automated': '1' if number in automated else '0',
            'test_estimate': '0',
            'test_attachments': '',
            'test_requirements': requirements,
            'test_labels': ','.join(labels),
            'step_description': '',
            'step_expected_result': '',
            'step_sequence': '1',
            'data_set': '',
        })

    with io.open(OUT, 'w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)

    flagged = [r['test_key'] for r in rows if r['test_is_automated'] == '1']
    print('{}: {} cases'.format(os.path.relpath(OUT, HERE).replace(os.sep, '/'), len(rows)))
    print('  automated: {}'.format(', '.join('TC' + k for k in flagged) or 'none'))
    print('  not automated: {}'.format(
        ', '.join('TC' + r['test_key'] for r in rows if r['test_is_automated'] == '0') or 'none'))
    if skipped:
        print('  already in the other exports, left alone: {}'.format(
            ', '.join('TC{}'.format(n) for n in skipped)))
    print('  steps are empty by design - they are test design, not repository data')


if __name__ == '__main__':
    main()
