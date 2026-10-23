#!/usr/bin/env python3
"""Full-master Tebeosfera sweep using deterministic issue URLs only.

This pass is intentionally conservative and fast: it walks every Maestro row,
tries only direct Tebeosfera issue URLs, stores verified covers, and keeps a
separate cursor so publisher-specific validations do not disturb the full scan.
Unresolved records can be handled later by the slower collection/search fallback.
"""
from pathlib import Path
import master_cover_tebeosfera_fast as f

FULL_STATE = Path(__file__).resolve().parent / 'bridge' / 'cache' / 'master-cover-tebeosfera-full-state.json'
f.m.STATE = FULL_STATE


def resolve_direct_only(row):
    sid = str(row.get('sourceId') or '').strip()
    # Keep the bulk pass bounded. The most likely Tebeosfera slug variants are
    # ordered first; 12 candidates covers normal, dotted-title and publisher aliases.
    return f.try_links(row, sid, f.direct_issue_links(row)[:12], 'full-direct')


f.m.resolve = resolve_direct_only

if __name__ == '__main__':
    f.m.main()
