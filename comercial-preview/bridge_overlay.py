#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
RESULTS=ROOT/'bridge'/'results'
OUT=ROOT/'bridge'/'cache'/'master-cover-overrides.json'

def code(v):
    return ''.join(ch for ch in str(v or '').upper() if ch.isdigit() or ch=='X')

def main():
    current={}
    if OUT.exists():
        try: current=json.loads(OUT.read_text(encoding='utf-8'))
        except Exception: current={}
    for p in sorted(RESULTS.glob('*.json')):
        try: payload=json.loads(p.read_text(encoding='utf-8'))
        except Exception: continue
        for c in payload.get('candidates') or []:
            d=c.get('data') or {}
            isbn=code(d.get('isbn') or (payload.get('query') or {}).get('isbn'))
            cover=d.get('coverUrl') or ''
            if len(isbn) not in (10,13) or not cover: continue
            old=current.get(isbn) or {}
            score=int(c.get('score') or 0)
            if old and int(old.get('_score') or 0)>score: continue
            current[isbn]={
                'isbn':isbn,
                'title':d.get('title') or old.get('title',''),
                'publisher':d.get('publisher') or (payload.get('query') or {}).get('publisher') or old.get('publisher',''),
                'series':d.get('series') or (payload.get('query') or {}).get('series') or old.get('series',''),
                'issueNr':str(d.get('issueNr') or (payload.get('query') or {}).get('issue') or old.get('issueNr','')),
                'publicationDate':d.get('publicationDate') or old.get('publicationDate',''),
                'pages':d.get('pages') or old.get('pages',''),
                'coverUrl':cover,
                'sourceUrl':d.get('sourceUrl') or old.get('sourceUrl',''),
                'source':'Bridge · '+str(c.get('source') or 'fuente verificada'),
                '_score':score
            }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(current,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8')
    print('MASTER_COVER_OVERLAY',len(current),'portadas')

if __name__=='__main__': main()
