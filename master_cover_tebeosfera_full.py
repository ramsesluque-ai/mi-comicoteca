#!/usr/bin/env python3
"""Full-master Tebeosfera sweep using deterministic issue URLs only.

This pass walks every Maestro row, tries only direct Tebeosfera issue URLs,
stores verified covers, and keeps both its cursor and overlay isolated from
interactive searches/backfills. The app merges this full overlay at read time.
"""
from pathlib import Path
import master_cover_tebeosfera_fast as f

ROOT = Path(__file__).resolve().parent
FULL_STATE = ROOT / 'bridge' / 'cache' / 'master-cover-tebeosfera-full-state.json'
FULL_OVERLAY = ROOT / 'bridge' / 'cache' / 'master-cover-full-overrides.json'

# Isolate the long-running sweep from the interactive overlay so concurrent
# searches cannot overwrite or conflict with sweep progress.
f.m.STATE = FULL_STATE
f.m.OVERLAY = FULL_OVERLAY


def resolve_direct_only(row):
    sid = str(row.get('sourceId') or '').strip()
    # Keep the bulk pass bounded. Direct canonical URL variants are enough for
    # the first complete pass; unresolved rows are handled by slower fallback.
    return f.try_links(row, sid, f.direct_issue_links(row)[:12], 'full-direct')


f.m.resolve = resolve_direct_only

if __name__ == '__main__':
    f.m.main()
