#!/usr/bin/env python3
"""Parallel full-Maestro sweep.

Each shard owns a separate cursor/overlay. It validates the deterministic
Tebeosfera issue page and records Tebeosfera's cover URL directly; it does not
copy the whole Maestro image library into GitHub. Catalog items can still be
fixed locally by the app when they are owned.
"""
import argparse, os, sys
from pathlib import Path
import master_cover_tebeosfera_fast as f

ROOT = Path(__file__).resolve().parent

# Parse shard arguments before handing remaining options to the shared engine.
p = argparse.ArgumentParser(add_help=False)
p.add_argument('--shard-index', type=int, required=True)
p.add_argument('--shard-count', type=int, required=True)
known, remaining = p.parse_known_args()
IDX = known.shard_index
COUNT = known.shard_count
if IDX < 0 or COUNT < 1 or IDX >= COUNT:
    raise SystemExit('invalid shard')

# Separate cursor/overlay per shard: no two jobs write the same generated file.
f.m.STATE = ROOT / 'bridge' / 'cache' / f'master-cover-tebeosfera-shard-{IDX}-state.json'
f.m.OVERLAY = ROOT / 'bridge' / 'cache' / f'master-cover-shard-{IDX}-overrides.json'

# Keep validated remote image URLs in the master overlay. This avoids turning
# the repository into a multi-GB image archive. The source page itself remains
# validated by inspect_tebeosfera before this is accepted.
f.m.save_image = lambda url, sid: str(url or '').strip()

_original_master_files = f.m.master_files

def sharded_master_files(master, publisher_filter=''):
    files = _original_master_files(master, publisher_filter)
    return [fp for pos, fp in enumerate(files) if pos % COUNT == IDX]

f.m.master_files = sharded_master_files


def resolve_direct(row):
    sid = str(row.get('sourceId') or '').strip()
    # Three deterministic variants: canonical + punctuation/publisher alias.
    # This keeps the first exhaustive pass fast. Misses are handled later by
    # the slower fallback pass, never silently accepted.
    return f.try_links(row, sid, f.direct_issue_links(row)[:3], f'shard-{IDX}')

f.m.resolve = resolve_direct

# Remove shard-only args before the common argparse parser runs.
sys.argv = [sys.argv[0]] + remaining

if __name__ == '__main__':
    f.m.main()
