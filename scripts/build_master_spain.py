#!/usr/bin/env python3
import json, re, shutil, unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import requests

SNAPSHOT='20261001'
PARTS=[f'https://parquet.gcdata.org/snapshot={SNAPSHOT}/part-000{i}.parquet' for i in range(4)]
ROOT=Path(__file__).resolve().parents[1]
TMP=ROOT/'.master-tmp'
OUT=ROOT/'master-data'
CHUNK_SIZE=4000

PRIORITY_EDITORIALS=[
 'Novaro','Vértice','Bruguera','Zinco','Forum','Planeta / DeAgostini','Panini','ECC',
 'Norma','Glénat','Salvat','Astiberri','Toutain','Vid','Dibbuks','Grijalbo-Dargaud',
 'Epucol','Lumen','MC Ediciones','Plural','Selecta Visión','Editorial Valenciana','Maga',
 'Toray','Hispano Americana','Ferma','Molino','Juventud','La Cúpula','El Jueves','Dolmen',
 'Milky Way','Ivrea','Distrito Manga','Yermo','Aleta','Ponent Mon / Edicions de Ponent',
 'Ediciones B','Montena'
]

ALIASES=[
 ('ECC', [r'\becc\b', r'ecc ediciones']),
 ('Panini', [r'\bpanini\b', r'panini comics']),
 ('Planeta / DeAgostini', [r'planeta.*deagostini', r'planeta deagostini', r'planeta c[oó]mic', r'editorial planeta']),
 ('Forum', [r'c[oó]mics forum', r'comics forum', r'forum']),
 ('Zinco', [r'\bzinco\b', r'ediciones zinco']),
 ('Vértice', [r'v[eé]rtice']),
 ('Bruguera', [r'bruguera']),
 ('Novaro', [r'novaro', r'editorial novaro']),
 ('Norma', [r'norma editorial', r'^norma$']),
 ('Glénat', [r'gl[eé]nat', r'ediciones glenat']),
 ('Salvat', [r'salvat']),
 ('Astiberri', [r'astiberri']),
 ('Toutain', [r'toutain']),
 ('Vid', [r'^vid$', r'grupo editorial vid']),
 ('Dibbuks', [r'dibbuks']),
 ('Grijalbo-Dargaud', [r'grijalbo', r'dargaud']),
 ('Epucol', [r'epucol']),
 ('Lumen', [r'\blumen\b']),
 ('MC Ediciones', [r'mc ediciones']),
 ('Plural', [r'\bplural\b']),
 ('Selecta Visión', [r'selecta visi[oó]n']),
 ('Editorial Valenciana', [r'editorial valenciana', r'^valenciana$']),
 ('Maga', [r'editorial maga', r'^maga$']),
 ('Toray', [r'toray']),
 ('Hispano Americana', [r'hispano americana']),
 ('Ferma', [r'ferma']),
 ('Molino', [r'editorial molino', r'^molino$']),
 ('Juventud', [r'editorial juventud', r'^juventud$']),
 ('La Cúpula', [r'la c[uú]pula', r'ediciones la cupula']),
 ('El Jueves', [r'el jueves']),
 ('Dolmen', [r'dolmen']),
 ('Milky Way', [r'milky way']),
 ('Ivrea', [r'ivrea']),
 ('Distrito Manga', [r'distrito manga']),
 ('Yermo', [r'yermo']),
 ('Aleta', [r'aleta ediciones', r'^aleta$']),
 ('Ponent Mon / Edicions de Ponent', [r'ponent mon', r'edicions de ponent', r'ponente mon']),
 ('Ediciones B', [r'ediciones b', r'grupo zeta']),
 ('Montena', [r'montena'])
]


def norm(s):
    s=unicodedata.normalize('NFD',str(s or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'\s+',' ',s).strip()


def slug(s):
    x=norm(s)
    x=re.sub(r'[^a-z0-9]+','-',x).strip('-')
    return x or 'sin-editorial'


def canon_publisher(raw, indicia=''):
    text=' '.join(x for x in [raw,indicia] if x).strip()
    n=norm(text)
    for label,pats in ALIASES:
        if any(re.search(p,n,re.I) for p in pats):
            return label
    return raw or indicia or 'Sin editorial'


def clean_code(v):
    return re.sub(r'[^0-9Xx]','',str(v or '')).upper()


def pubdate(v):
    s=str(v or '').strip()
    if not s or s=='0': return ''
    if len(s)>=8 and s[:8].isdigit():
        return f'{s[:4]}-{s[4:6]}-{s[6:8]}'
    if len(s)>=6 and s[:6].isdigit():
        return f'{s[:4]}-{s[4:6]}-01'
    if len(s)>=4 and s[:4].isdigit():
        return f'{s[:4]}-01-01'
    return s


def issue_sort(v):
    s=str(v or '').strip()
    m=re.match(r'^0*(\d+)(?:\D|$)',s)
    return (0,int(m.group(1)),s) if m else (1,10**9,norm(s))


def download_parts():
    TMP.mkdir(parents=True,exist_ok=True)
    local=[]
    headers={'User-Agent':'MI-COMICOTECA/1.0 master builder'}
    for i,url in enumerate(PARTS):
        p=TMP/f'part-{i:04d}.parquet'
        local.append(str(p))
        if p.exists() and p.stat().st_size>1_000_000:
            continue
        print('DOWNLOAD',url)
        with requests.get(url,headers=headers,stream=True,timeout=120) as r:
            r.raise_for_status()
            with p.open('wb') as f:
                for block in r.iter_content(1024*1024):
                    if block:f.write(block)
    return local


def load_rows(files):
    con=duckdb.connect()
    file_sql='['+','.join("'"+f.replace("'","''")+"'" for f in files)+']'
    q=f'''\n      SELECT DISTINCT\n        issue_id, issue_number_raw, issue_number, publication_date, price_raw, page_count,\n        isbn, barcode, title, variant_name, variant_of_issue_id,\n        series_id, series_name, series_year_began, series_year_ended, series_is_current,\n        series_country_code, series_language_code, series_color, series_dimensions,\n        series_binding, series_publishing_format, series_publishing_type,\n        publisher_id, publisher_name, publisher_country_code,\n        indicia_publisher_id, indicia_publisher_name\n      FROM read_parquet({file_sql}, union_by_name=true)\n      WHERE lower(coalesce(series_country_code,''))='es'\n        AND coalesce(series_is_comics_publication,true)=true\n      ORDER BY publisher_name, series_name, series_year_began, issue_number, issue_number_raw\n    '''
    print('QUERY Spain issues…')
    cur=con.execute(q)
    cols=[d[0] for d in cur.description]
    while True:
        batch=cur.fetchmany(10000)
        if not batch:break
        for row in batch:
            yield dict(zip(cols,row))


def bindings(v):
    if v is None:return ''
    if isinstance(v,(list,tuple)):return ', '.join(str(x) for x in v if x)
    return str(v)


def main():
    files=download_parts()
    if OUT.exists(): shutil.rmtree(OUT)
    (OUT/'publishers').mkdir(parents=True,exist_ok=True)

    rows=[]
    for r in load_rows(files):
        publisher=canon_publisher(r.get('publisher_name'),r.get('indicia_publisher_name'))
        series=str(r.get('series_name') or '').strip()
        start_year=str(r.get('series_year_began') or '').strip()
        issue_raw=str(r.get('issue_number_raw') or r.get('issue_number') or '').strip()
        isbn=clean_code(r.get('isbn'))
        barcode=clean_code(r.get('barcode'))
        rows.append({
          'id':f"gcd_{r.get('issue_id')}",
          'source':'GCD/gcdata', 'sourceId':str(r.get('issue_id') or ''),
          'publisher':publisher, 'publisherOriginal':str(r.get('publisher_name') or ''),
          'catalogHeader':series, 'series':series, 'volume':'', 'stage':'',
          'startYear':start_year, 'issueNr':issue_raw, 'issue':issue_raw,
          'title':str(r.get('title') or '').strip(), 'publicationDate':pubdate(r.get('publication_date')),
          'pages':str(r.get('page_count') or ''), 'isbn':isbn, 'barcode':barcode,
          'price':str(r.get('price_raw') or '').strip(), 'color':str(r.get('series_color') or '').strip(),
          'format':str(r.get('series_publishing_format') or r.get('series_publishing_type') or '').strip(),
          'dimensions':str(r.get('series_dimensions') or '').strip(), 'binding':bindings(r.get('series_binding')),
          'language':str(r.get('series_language_code') or '').strip(), 'coverUrl':'',
          'variant':str(r.get('variant_name') or '').strip(), 'variantOf':str(r.get('variant_of_issue_id') or ''),
          'status':'', 'tags':'', 'masterSnapshot':SNAPSHOT
        })

    # Assign volume number when the same editorial+cabecera has several GCD series start years.
    years=defaultdict(set)
    for r in rows:
        if r['startYear']:years[(norm(r['publisher']),norm(r['catalogHeader']))].add(r['startYear'])
    volmap={k:{y:str(i+1) for i,y in enumerate(sorted(v,key=lambda x:int(x) if x.isdigit() else 9999))} for k,v in years.items() if len(v)>1}
    for r in rows:
        vm=volmap.get((norm(r['publisher']),norm(r['catalogHeader'])))
        if vm and r['startYear'] in vm:r['volume']=vm[r['startYear']]

    # Stable sort + chunking by normalized publisher.
    rows.sort(key=lambda r:(norm(r['publisher']),norm(r['catalogHeader']),int(r['startYear']) if r['startYear'].isdigit() else 9999,issue_sort(r['issueNr']),r['sourceId']))
    bypub=defaultdict(list)
    for r in rows:bypub[r['publisher']].append(r)

    publisher_meta=[]; series_index={}; isbn_index={}; issue_lookup={}
    total_series=0
    for pub in sorted(bypub,key=norm):
        group=bypub[pub]; pslug=slug(pub); chunks=[]
        series_seen=defaultdict(lambda:{'years':set(),'issues':0,'chunks':set()})
        for ci in range(0,len(group),CHUNK_SIZE):
            part=group[ci:ci+CHUNK_SIZE]; idx=ci//CHUNK_SIZE+1
            fn=f'{pslug}-{idx:03d}.json'; rel=f'publishers/{fn}'
            (OUT/rel).write_text(json.dumps(part,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
            chunks.append(rel)
            for r in part:
                skey=f"{norm(pub)}|{norm(r['catalogHeader'])}"
                s=series_seen[skey]; s['issues']+=1; s['chunks'].add(rel)
                if r['startYear']:s['years'].add(r['startYear'])
                if r['isbn']:isbn_index.setdefault(r['isbn'],[]).append([rel,r['id']])
                if r['barcode'] and r['barcode']!=r['isbn']:isbn_index.setdefault(r['barcode'],[]).append([rel,r['id']])
                exact=f"{norm(pub)}|{norm(r['catalogHeader'])}|{r['startYear']}|{str(r['volume'])}|{norm(r['stage'])}|{str(r['issueNr'])}"
                issue_lookup.setdefault(exact,[]).append([rel,r['id']])
        for skey,s in series_seen.items():
            series_index[skey]={'publisher':pub,'series':skey.split('|',1)[1],'years':sorted(s['years']),'issues':s['issues'],'chunks':sorted(s['chunks'])}
        total_series+=len(series_seen)
        publisher_meta.append({'publisher':pub,'slug':pslug,'issues':len(group),'series':len(series_seen),'chunks':chunks,'priority':pub in PRIORITY_EDITORIALS})

    index={
      'name':'MI COMICOTECA · Maestro España', 'version':1, 'snapshot':SNAPSHOT,
      'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
      'scope':'Series catalogadas por GCD con series_country_code=es',
      'totalIssues':len(rows),'totalSeries':total_series,'totalPublishers':len(publisher_meta),
      'priorityEditorials':PRIORITY_EDITORIALS,'publishers':publisher_meta
    }
    (OUT/'index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (OUT/'isbn-index.json').write_text(json.dumps(isbn_index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (OUT/'issue-index.json').write_text(json.dumps(issue_lookup,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (OUT/'series-index.json').write_text(json.dumps(series_index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    summary={'snapshot':SNAPSHOT,'issues':len(rows),'series':total_series,'publishers':len(publisher_meta),'priority':[p for p in publisher_meta if p['priority']]}
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
