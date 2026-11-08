#!/usr/bin/env python3
"""Resolve ISBN-exact cover candidates from Open Library; never overwrite existing covers."""
import csv,json,time,urllib.parse,urllib.request,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'master-data'
p=argparse.ArgumentParser();p.add_argument('--limit',type=int,default=40);a=p.parse_args()
queue=list(csv.DictReader((ROOT/'cover-enrichment-queue.csv').open(encoding='utf-8-sig')))
over=json.loads((ROOT/'cover-overrides.json').read_text(encoding='utf-8'))
statepath=ROOT/'cover-enrichment-state.json'
state=json.loads(statepath.read_text()) if statepath.exists() else {'offset':0,'checked':0,'linked':0}
offset=int(state['offset']);linked=0;checked=0
for row in queue[offset:offset+max(1,min(a.limit,100))]:
 isbn=row['isbn'];checked+=1
 if isbn in over and over[isbn].get('coverUrl'):continue
 key='ISBN:'+isbn
 url='https://openlibrary.org/api/books?'+urllib.parse.urlencode({'bibkeys':key,'format':'json','jscmd':'data'})
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'MiComicotecaBibliographicAudit/1.0 (ISBN matching)'})
  with urllib.request.urlopen(req,timeout=12) as res: data=json.load(res)
  record=data.get(key) or {};covers=record.get('cover') or {}
  image=covers.get('large') or covers.get('medium') or covers.get('small')
  identifiers=record.get('identifiers') or {}
  listed={str(x).replace('-','') for k,v in identifiers.items() if k.lower() in ('isbn_10','isbn_13') for x in (v if isinstance(v,list) else [v])}
  if image and isbn in listed and image.startswith('https://'):
   over[isbn]={'isbn':isbn,'coverUrl':image,'source':'Open Library (ISBN verified)','sourceUrl':record.get('url') or url}
   linked+=1
 except Exception as exc:print('SKIP',isbn,str(exc)[:120])
 time.sleep(.25)
state.update(offset=offset+checked,checked=int(state.get('checked',0))+checked,linked=int(state.get('linked',0))+linked)
(ROOT/'cover-overrides.json').write_text(json.dumps(over,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
statepath.write_text(json.dumps(state,indent=2)+'\n')
print(json.dumps({'checkedThisRun':checked,'newVerifiedCoverLinks':linked,'state':state}))
