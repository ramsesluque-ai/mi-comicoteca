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
        q=payload.get('query') or {}
        for c in payload.get('candidates') or []:
            d=c.get('data') or {}
            isbn=code(d.get('isbn') or q.get('isbn'))
            source_id=str(d.get('sourceId') or q.get('sourceId') or '').strip()
            cover=d.get('coverUrl') or ''
            if not cover: continue
            if len(isbn) in (10,13): key=isbn
            elif source_id.isdigit(): key='gcd:'+source_id
            else: continue
            old=current.get(key) or {}
            score=int(c.get('score') or 0)
            if old and int(old.get('_score') or 0)>score: continue
            current[key]={
                'isbn':isbn,
                'sourceId':source_id,
                'title':d.get('title') or old.get('title',''),
                'publisher':d.get('publisher') or q.get('publisher') or old.get('publisher',''),
                'series':d.get('series') or q.get('series') or old.get('series',''),
                'issueNr':str(d.get('issueNr') or q.get('issue') or old.get('issueNr','')),
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
