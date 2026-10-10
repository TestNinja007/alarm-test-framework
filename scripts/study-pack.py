#!/usr/bin/env python3
"""
Build a folder ready to upload to a Claude Project for revision.

It holds the revision guide and every file the guide's reading list names,
flattened into one folder so they can be selected together and dragged in.

The file list is read FROM the guide - its "The code to read alongside"
section - rather than kept here as well. Two copies of a list drift apart, which
is the lesson of DEF-15 and of the traceability matrix; this way the guide is
the only place the list lives, and adding a file to it adds it to the pack.

    python scripts/study-pack.py

Writes study-pack/, which is ignored by git: it is a build output, regenerated
whenever the guide or the code changes, and a committed copy would be stale the
moment either did.
"""

import io
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.dirname(HERE)
GUIDE = os.path.join(HERE, 'docs', 'revision-guide.md')
OUT = os.path.join(HERE, 'study-pack')

# Paths in the guide are written either from the folder holding both
# repositories ("alarm-configurator/README.md") or from this repository
# ("src/fixtures.ts"). Both are tried, in that order.
ROOTS = (PROJECT, HERE)


def reading_list(guide_text):
    section = guide_text[guide_text.index('## The code to read alongside'):]
    return re.findall(r'`([\w./-]+\.(?:md|ts|py))`', section)


def resolve(path):
    for root in ROOTS:
        candidate = os.path.join(root, path)
        if os.path.isfile(candidate):
            return candidate
    return None


def flat_name(path, source):
    """
    One folder, so names must not collide - and four of these files are called
    README.md. The repository and directories become part of the name, which
    also tells whoever reads it where the file lives.
    """
    relative = os.path.relpath(source, PROJECT).replace(os.sep, '/')
    return relative.replace('/', '__')


def main():
    if not os.path.isfile(GUIDE):
        sys.exit('The revision guide is missing: ' + GUIDE)

    guide = io.open(GUIDE, encoding='utf-8').read()
    wanted = reading_list(guide)

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)

    # The guide itself goes first in any listing.
    shutil.copyfile(GUIDE, os.path.join(OUT, '00__revision-guide.md'))

    missing = []
    copied = 0
    for path in wanted:
        source = resolve(path)
        if source is None:
            missing.append(path)
            continue
        shutil.copyfile(source, os.path.join(OUT, flat_name(path, source)))
        copied += 1

    total = sum(
        len(io.open(os.path.join(OUT, f), encoding='utf-8', errors='replace').readlines())
        for f in os.listdir(OUT)
    )
    print('study-pack/: the guide and {} files, about {:,} lines'.format(copied, total))

    if missing:
        # Loud, because a pack that silently drops a file the guide tells the
        # reader to look at is a guide pointing at nothing.
        print('Named in the guide but not found:')
        for path in missing:
            print('  ' + path)
        sys.exit(1)


if __name__ == '__main__':
    main()
