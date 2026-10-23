#!/usr/bin/env python3
"""Full-master Tebeosfera sweep using deterministic issue URLs only.

This pass walks every Maestro row, tries only direct Tebeosfera issue URLs,
stores verified covers, and keeps its cursor, overlay and cover files isolated
from interactive searches/backfills. The app merges this full overlay at read time.
"""
from pathlib import Path
import master_cover_tebeosfera_fast as f

ROOT = Path(__file__).resolve().parent
FULL_STATE = ROOT / 'bridge' / 'cache' / 'master-cover-tebeosfera-full-state.json'
FULL_OVERLAY = ROOT / 'bridge' / 'cache' / 'master-cover-full-overrides.json'
FULL_COVERS = ROOT / 'bridge' / 'full-covers'

f.m.STATE = FULL_STATE
f.m.OVERLAY = FULL_OVERLAY


def save_full_image(url, sid):
    r = f.m.get(url, 25, {'Referer':'https://www.tebeosfera.com/'})
    if not r or r.status_code != 200 or not r.content:
        return ''
    try:
        im = f.m.Image.open(f.m.BytesIO(r.content)).convert('RGB')
        w, h = im.size
        if w < 120 or h < 160 or h <= w:
            return ''
        ratio = w / h
        if ratio < 0.40 or ratio > 0.90:
            return ''
        im.thumbnail((900,1350), f.m.Image.LANCZOS)
        FULL_COVERS.mkdir(parents=True, exist_ok=True)
        name = f'tebeosfera-{sid}.webp'
        im.save(FULL_COVERS / name, 'WEBP', quality=86, method=6)
        return f'https://raw.githubusercontent.com/{f.m.OWNER}/{f.m.REPO}/{f.m.BRANCH}/bridge/full-covers/{name}'
    except Exception:
        return ''


def resolve_direct_only(row):
    sid = str(row.get('sourceId') or '').strip()
    return f.try_links(row, sid, f.direct_issue_links(row)[:6], 'full-direct')


# try_links calls m.save_image, so point it to the sweep-specific store.
f.m.save_image = save_full_image
f.m.resolve = resolve_direct_only

if __name__ == '__main__':
    f.m.main()
