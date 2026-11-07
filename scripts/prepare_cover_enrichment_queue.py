#!/usr/bin/env python3
"""Prepare a bulk ISBN enrichment queue from the Spain master, without guessing covers."""
import csv, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'master-data'
idx=json.loads((base/'index.json').read_text(encoding='utf-8'))\nassert idx.get('publishers'), 'Maestro index missing publishers'
over=json.loads((base/'cover-overrides.json').read_text(encoding='utf-8'))
priority=['Forum','Zinco','Novaro','Panini','Norma','Bruguera','Vértice','ECC','Planeta / DeAgostini']
items=[]; seen=set(); counts={}
for pub in idx['publishers']:
 for chunk in pub['chunks']:
  for r in json.loads((base/chunk).read_text(encoding='utf-8')):
   isbn=re.sub('[^0-9Xx]','',str(r.get('isbn') or '')).upper()
   if len(isbn) not in (10,13) or isbn in seen or r.get('coverUrl') or (over.get(isbn) or {}).get('coverUrl'):continue
   seen.add(isbn)
   name=str(r.get('publisher') or pub['publisher'])
   counts[name]=counts.get(name,0)+1
   items.append({'isbn':isbn,'publisher':name,'series':r.get('catalogHeader') or r.get('series') or '', 'volume':r.get('volume') or '', 'stage':r.get('stage') or '', 'startYear':r.get('startYear') or '', 'issueNr':r.get('issueNr') or r.get('issue') or '', 'title':r.get('title') or '', 'source':r.get('source') or '', 'sourceId':r.get('sourceId') or ''})
items.sort(key=lambda r:(priority.index(r['publisher']) if r['publisher'] in priority else len(priority),r['publisher'],r['series'],str(r['issueNr'])))
dest=base/'cover-enrichment-queue.csv'
with dest.open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=['isbn','publisher','series','volume','stage','startYear','issueNr','title','source','sourceId']);w.writeheader();w.writerows(items)
print(json.dumps({'eligibleMissingCoversWithIsbn':len(items),'byPublisher':counts},ensure_ascii=False))
