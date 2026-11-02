#!/usr/bin/env python3
"""Exporta master-data a lotes JSON para master_series/master_comics de Supabase.

Identidad global: Editorial + Cabecera + Volumen + Etapa + Año inicio.
No fusiona homónimos. IDs UUIDv5 deterministas para permitir upsert idempotente.
"""
import json, re, unicodedata, uuid
from datetime import date, datetime
from pathlib import Path
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[1]
PUBDIR=ROOT/'master-data'/'publishers'
OUT=ROOT/'supabase-import'
NS=uuid.UUID('7b26bbf0-9a90-4b62-9a2a-87e0197a8b35')
BATCH=1000

def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'\s+',' ',s).strip()

def year(v):
    s=str(v or '').strip()
    return int(s) if s.isdigit() and 1000 <= int(s) <= 9999 else None

def pg_date(v):
    """Devuelve YYYY-MM-DD válido para Postgres o None si la fuente no contiene una fecha utilizable."""
    s=str(v or '').strip()
    if not s:
        return None
    candidates=[s, s[:10]]
    for raw in candidates:
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError:
            pass
    for fmt in ('%d/%m/%Y','%d-%m-%Y','%Y/%m/%d'):
        try:
            return datetime.strptime(s,fmt).date().isoformat()
        except ValueError:
            pass
    return None

def identity(r):
    pub=str(r.get('publisher') or '').strip()
    title=str(r.get('catalogHeader') or r.get('series') or '').strip()
    volume=str(r.get('volume') or '').strip()
    stage=str(r.get('stage') or '').strip()
    sy=year(r.get('startYear'))
    key='|'.join((norm(pub),norm(title),norm(volume),norm(stage),str(sy if sy is not None else -1)))
    return pub,title,volume,stage,sy,key

def uid(kind,key): return str(uuid.uuid5(NS,kind+'|'+key))

def chunks(items,n=BATCH):
    for i in range(0,len(items),n): yield i//n+1,items[i:i+n]

def main():
    rows=[]
    for p in sorted(PUBDIR.glob('*.json')):
        d=json.loads(p.read_text(encoding='utf-8'))
        if isinstance(d,list): rows.extend(x for x in d if isinstance(x,dict))
    series={}; comics=[]; seen_issue=defaultdict(set); dup=[]; invalid_dates=[]
    for r in rows:
        pub,title,volume,stage,sy,key=identity(r)
        if not pub or not title: raise SystemExit('Editorial/cabecera vacía: '+str(r.get('id')))
        sid=uid('series',key)
        series.setdefault(key,{'id':sid,'publisher':pub,'title':title,'volume_stage':' · '.join(x for x in (volume,stage) if x),'volume':volume,'stage':stage,'start_year':sy,'country':'ES'})
        issue=str(r.get('issueNr') or r.get('issue') or '').strip()
        ik=norm(issue)
        if ik and ik in seen_issue[key]: dup.append((key,issue,r.get('id')))
        if ik: seen_issue[key].add(ik)
        source_id=str(r.get('id') or r.get('sourceId') or '')
        raw_date=str(r.get('publicationDate') or '').strip()
        publication_date=pg_date(raw_date)
        if raw_date and publication_date is None:
            invalid_dates.append((r.get('id'),raw_date))
        comic_key=source_id or key+'|'+issue+'|'+raw_date+'|'+str(r.get('title') or '')
        metadata={k:r.get(k) for k in ('source','sourceId','publisherOriginal','pages','price','color','format','dimensions','binding','language','variant','variantOf','status','tags','masterSnapshot') if r.get(k) not in (None,'')}
        if raw_date and publication_date is None:
            metadata['publicationDateRaw']=raw_date
        comics.append({'id':uid('comic',comic_key),'series_id':sid,'issue_number':issue or None,'title':str(r.get('title') or '').strip() or None,'publication_date':publication_date,'isbn':str(r.get('isbn') or '').strip() or None,'barcode':str(r.get('barcode') or '').strip() or None,'cover_url':str(r.get('coverUrl') or '').strip() or None,'cover_status':'automatic','metadata':metadata})
    if dup: raise SystemExit(f'Duplicados dentro de identidad: {len(dup)}; muestra={dup[:10]}')
    OUT.mkdir(exist_ok=True)
    for p in OUT.glob('*.json'): p.unlink()
    slist=sorted(series.values(),key=lambda x:(norm(x['publisher']),norm(x['title']),norm(x['volume']),norm(x['stage']),x['start_year'] or -1))
    for i,b in chunks(slist): (OUT/f'master_series_{i:04d}.json').write_text(json.dumps(b,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    for i,b in chunks(comics): (OUT/f'master_comics_{i:04d}.json').write_text(json.dumps(b,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    manifest={'sourceRows':len(rows),'series':len(slist),'comics':len(comics),'batchSize':BATCH,'seriesBatches':(len(slist)+BATCH-1)//BATCH,'comicBatches':(len(comics)+BATCH-1)//BATCH,'identity':'publisher+title+volume+stage+start_year','idStrategy':'UUIDv5 deterministic','invalidPublicationDates':len(invalid_dates),'invalidPublicationDateSamples':invalid_dates[:20]}
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=False))

if __name__=='__main__': main()
