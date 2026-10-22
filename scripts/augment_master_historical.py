#!/usr/bin/env python3
import json, re, shutil, unicodedata
from collections import defaultdict
from pathlib import Path

import duckdb

ROOT=Path(__file__).resolve().parents[1]
TMP=ROOT/'.master-tmp'
OUT=ROOT/'master-data'
PUBDIR=OUT/'publishers'
CHUNK_SIZE=4000

HISTORICAL_SPANISH_PUBLISHERS={
    'Novaro': ('novaro',),
}

STAGE_MARKERS=(
    ('aguila','Serie Águila'),
    ('avestruz','Serie Avestruz'),
    ('colibri','Serie Colibrí'),
    ('librocomic','Librocomic'),
)


def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'\s+',' ',s).strip()


def slug(v):
    s=re.sub(r'[^a-z0-9]+','-',norm(v)).strip('-')
    return s or 'sin-editorial'


def clean_code(v):
    return re.sub(r'[^0-9Xx]','',str(v or '')).upper()


def pubdate(v):
    s=str(v or '').strip()
    if not s or s=='0': return ''
    if len(s)>=8 and s[:8].isdigit(): return f'{s[:4]}-{s[4:6]}-{s[6:8]}'
    if len(s)>=6 and s[:6].isdigit(): return f'{s[:4]}-{s[4:6]}-01'
    if len(s)>=4 and s[:4].isdigit(): return f'{s[:4]}-01-01'
    return s


def issue_sort(v):
    s=str(v or '').strip()
    m=re.match(r'^0*(\d+)(?:\D|$)',s)
    return (0,int(m.group(1)),s) if m else (1,10**9,norm(s))


def stage_from_brand(v):
    n=norm(v)
    for marker,label in STAGE_MARKERS:
        if marker in n:
            return label
    return ''


def normalize_header_stage(series, stage=''):
    """Separa cabecera de etapa cuando GCD incrusta la etapa en el nombre de serie."""
    series=str(series or '').strip(); stage=str(stage or '').strip()
    patterns=[
        (r'\s*[-–—:]\s*serie\s+águila\s*$', 'Serie Águila'),
        (r'\s*[-–—:]\s*serie\s+aguila\s*$', 'Serie Águila'),
        (r'\s*[-–—:]\s*serie\s+avestruz\s*$', 'Serie Avestruz'),
        (r'\s*[-–—:]\s*serie\s+colibr[ií]\s*$', 'Serie Colibrí'),
        (r'\s*[-–—:]\s*librocomic\s*$', 'Librocomic'),
    ]
    for pat,label in patterns:
        if re.search(pat,series,re.I):
            series=re.sub(pat,'',series,flags=re.I).strip()
            if not stage: stage=label
            break
    return series,stage


def bindings(v):
    if v is None:return ''
    if isinstance(v,(list,tuple)):return ', '.join(str(x) for x in v if x)
    return str(v)


def existing_rows():
    rows=[]
    if not PUBDIR.exists(): return rows
    for p in sorted(PUBDIR.glob('*.json')):
        try:
            data=json.loads(p.read_text(encoding='utf-8'))
            if isinstance(data,list): rows.extend(x for x in data if isinstance(x,dict))
        except Exception as e:
            print('WARN read',p,e)
    return rows


def parquet_schema(con,files_sql):
    desc=con.execute(f"DESCRIBE SELECT * FROM read_parquet({files_sql}, union_by_name=true)").fetchall()
    return [str(r[0]) for r in desc]


def choose_brand_column(columns):
    prefs=['issue_brand_name','brand_emblem_name','brand_name','brand_names','brand_emblems']
    low={c.lower():c for c in columns}
    for p in prefs:
        if p in low:return low[p]
    candidates=[c for c in columns if 'brand' in c.lower() and ('name' in c.lower() or 'emblem' in c.lower())]
    return candidates[0] if candidates else ''


def supplement_rows():
    files=sorted(TMP.glob('part-*.parquet'))
    if not files:
        print('No parquet parts found; historical supplement skipped')
        return []
    con=duckdb.connect()
    files_sql='['+','.join("'"+str(p).replace("'","''")+"'" for p in files)+']'
    cols=parquet_schema(con,files_sql)
    brand_col=choose_brand_column(cols)
    print('GCDATA brand column:',brand_col or '(none)')
    brand_expr=f'CAST({brand_col} AS VARCHAR)' if brand_col else "''"
    pub_terms=[]
    for _,patterns in HISTORICAL_SPANISH_PUBLISHERS.items():
        for pat in patterns:
            p=pat.lower().replace("'","''")
            pub_terms.append(f"lower(coalesce(publisher_name,'')) LIKE '%{p}%'")
            pub_terms.append(f"lower(coalesce(indicia_publisher_name,'')) LIKE '%{p}%'")
    pub_where=' OR '.join(pub_terms) or 'false'
    q=f'''
      SELECT DISTINCT
        issue_id, issue_number_raw, issue_number, publication_date, price_raw, page_count,
        isbn, barcode, title, variant_name, variant_of_issue_id,
        series_id, series_name, series_year_began, series_year_ended, series_is_current,
        series_country_code, series_language_code, series_color, series_dimensions,
        series_binding, series_publishing_format, series_publishing_type,
        publisher_id, publisher_name, publisher_country_code,
        indicia_publisher_id, indicia_publisher_name,
        {brand_expr} AS historical_brand
      FROM read_parquet({files_sql}, union_by_name=true)
      WHERE lower(coalesce(series_language_code,''))='es'
        AND coalesce(series_is_comics_publication,true)=true
        AND ({pub_where})
      ORDER BY publisher_name, series_name, series_year_began, issue_number, issue_number_raw
    '''
    cur=con.execute(q); names=[d[0] for d in cur.description]
    merged={}
    while True:
        batch=cur.fetchmany(10000)
        if not batch:break
        for values in batch:
            r=dict(zip(names,values)); iid=str(r.get('issue_id') or '')
            if not iid:continue
            prev=merged.get(iid)
            if prev:
                b=' | '.join(x for x in [str(prev.get('historical_brand') or ''),str(r.get('historical_brand') or '')] if x)
                prev['historical_brand']=b
            else:
                merged[iid]=r
    out=[]
    for r in merged.values():
        publisher='Novaro' if 'novaro' in norm(' '.join([str(r.get('publisher_name') or ''),str(r.get('indicia_publisher_name') or '')])) else str(r.get('publisher_name') or r.get('indicia_publisher_name') or 'Sin editorial')
        series=str(r.get('series_name') or '').strip()
        start_year=str(r.get('series_year_began') or '').strip()
        issue_raw=str(r.get('issue_number_raw') or r.get('issue_number') or '').strip()
        brand=str(r.get('historical_brand') or '')
        stage=stage_from_brand(brand)
        series,stage=normalize_header_stage(series,stage)
        out.append({
          'id':f"gcd_{r.get('issue_id')}",
          'source':'GCD/gcdata', 'sourceId':str(r.get('issue_id') or ''),
          'publisher':publisher, 'publisherOriginal':str(r.get('publisher_name') or ''),
          'catalogHeader':series, 'series':series, 'volume':'', 'stage':stage,
          'startYear':start_year, 'issueNr':issue_raw, 'issue':issue_raw,
          'title':str(r.get('title') or '').strip(), 'publicationDate':pubdate(r.get('publication_date')),
          'pages':str(r.get('page_count') or ''), 'isbn':clean_code(r.get('isbn')), 'barcode':clean_code(r.get('barcode')),
          'price':str(r.get('price_raw') or '').strip(), 'color':str(r.get('series_color') or '').strip(),
          'format':str(r.get('series_publishing_format') or r.get('series_publishing_type') or '').strip(),
          'dimensions':str(r.get('series_dimensions') or '').strip(), 'binding':bindings(r.get('series_binding')),
          'language':str(r.get('series_language_code') or '').strip(), 'coverUrl':'',
          'variant':str(r.get('variant_name') or '').strip(), 'variantOf':str(r.get('variant_of_issue_id') or ''),
          'status':'', 'tags':('GCD brand: '+brand) if brand else '', 'masterSnapshot':'20261001'
        })
    print('Historical Spanish-language candidates:',len(out))
    return out


def normalize_existing_historical(rows):
    for r in rows:
        if norm(r.get('publisher'))!='novaro':continue
        h,s=normalize_header_stage(r.get('catalogHeader') or r.get('series') or '',r.get('stage') or '')
        if h:
            r['catalogHeader']=h
            r['series']=h
        if s:r['stage']=s
    return rows


def write_master(rows):
    old_index={}
    try: old_index=json.loads((OUT/'index.json').read_text(encoding='utf-8'))
    except: pass
    priority=old_index.get('priorityEditorials') or []
    rows=normalize_existing_historical(rows)

    years=defaultdict(set)
    for r in rows:
        if r.get('startYear'):
            years[(norm(r.get('publisher')),norm(r.get('catalogHeader')),norm(r.get('stage')))].add(str(r.get('startYear')))
    volmap={k:{y:str(i+1) for i,y in enumerate(sorted(v,key=lambda x:int(x) if str(x).isdigit() else 9999))} for k,v in years.items() if len(v)>1}
    for r in rows:
        vm=volmap.get((norm(r.get('publisher')),norm(r.get('catalogHeader')),norm(r.get('stage'))))
        if vm and str(r.get('startYear')) in vm:r['volume']=vm[str(r.get('startYear'))]

    rows.sort(key=lambda r:(norm(r.get('publisher')),norm(r.get('catalogHeader')),norm(r.get('stage')),int(r.get('startYear')) if str(r.get('startYear') or '').isdigit() else 9999,issue_sort(r.get('issueNr')),str(r.get('sourceId') or '')))
    bypub=defaultdict(list)
    for r in rows:bypub[r.get('publisher') or 'Sin editorial'].append(r)

    if PUBDIR.exists():shutil.rmtree(PUBDIR)
    PUBDIR.mkdir(parents=True,exist_ok=True)
    publisher_meta=[];series_index={};isbn_index={};issue_lookup={};total_series=0
    for pub in sorted(bypub,key=norm):
        group=bypub[pub];pslug=slug(pub);chunks=[]
        series_seen=defaultdict(lambda:{'years':set(),'issues':0,'chunks':set()})
        for ci in range(0,len(group),CHUNK_SIZE):
            part=group[ci:ci+CHUNK_SIZE];idx=ci//CHUNK_SIZE+1
            fn=f'{pslug}-{idx:03d}.json';rel=f'publishers/{fn}'
            (OUT/rel).write_text(json.dumps(part,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
            chunks.append(rel)
            for r in part:
                skey=f"{norm(pub)}|{norm(r.get('catalogHeader'))}|{norm(r.get('stage'))}"
                s=series_seen[skey];s['issues']+=1;s['chunks'].add(rel)
                if r.get('startYear'):s['years'].add(str(r.get('startYear')))
                if r.get('isbn'):isbn_index.setdefault(r['isbn'],[]).append([rel,r['id']])
                if r.get('barcode') and r.get('barcode')!=r.get('isbn'):isbn_index.setdefault(r['barcode'],[]).append([rel,r['id']])
                exact=f"{norm(pub)}|{norm(r.get('catalogHeader'))}|{r.get('startYear','')}|{r.get('volume','')}|{norm(r.get('stage'))}|{r.get('issueNr','')}"
                issue_lookup.setdefault(exact,[]).append([rel,r['id']])
        for skey,s in series_seen.items():
            parts=skey.split('|')
            series_index[skey]={'publisher':pub,'series':parts[1] if len(parts)>1 else '', 'stage':parts[2] if len(parts)>2 else '', 'years':sorted(s['years']),'issues':s['issues'],'chunks':sorted(s['chunks'])}
        total_series+=len(series_seen)
        publisher_meta.append({'publisher':pub,'slug':pslug,'issues':len(group),'series':len(series_seen),'chunks':chunks,'priority':pub in priority})

    from datetime import datetime,timezone
    index={
      'name':'MI COMICOTECA · Maestro España + histórico en español','version':3,'snapshot':'20261001',
      'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
      'scope':'Series GCD de España + suplementos históricos en español; cabecera y etapa normalizadas',
      'totalIssues':len(rows),'totalSeries':total_series,'totalPublishers':len(publisher_meta),
      'priorityEditorials':priority,'historicalSupplements':list(HISTORICAL_SPANISH_PUBLISHERS),'publishers':publisher_meta
    }
    (OUT/'index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (OUT/'isbn-index.json').write_text(json.dumps(isbn_index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (OUT/'issue-index.json').write_text(json.dumps(issue_lookup,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (OUT/'series-index.json').write_text(json.dumps(series_index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    summary={'snapshot':'20261001','issues':len(rows),'series':total_series,'publishers':len(publisher_meta),'historicalSupplements':list(HISTORICAL_SPANISH_PUBLISHERS),'priority':[p for p in publisher_meta if p['priority']]}
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print('AUGMENTED MASTER',json.dumps({'issues':len(rows),'series':total_series,'publishers':len(publisher_meta)},ensure_ascii=False))


def main():
    base=existing_rows();by_id={str(r.get('id') or ''):r for r in base if r.get('id')}
    before=len(by_id)
    for r in supplement_rows():
        key=str(r.get('id') or '')
        if not key:continue
        if key in by_id:
            old=by_id[key]
            if r.get('stage') and not old.get('stage'):old['stage']=r['stage']
            if r.get('tags') and not old.get('tags'):old['tags']=r['tags']
            for f in ('publisher','publisherOriginal','catalogHeader','series','startYear','issueNr','issue','title','publicationDate','pages','isbn','barcode','price','color','format','dimensions','binding','language'):
                if not old.get(f) and r.get(f):old[f]=r[f]
        else:
            by_id[key]=r
    print('Master rows before:',before,'after:',len(by_id),'added:',len(by_id)-before)
    write_master(list(by_id.values()))

if __name__=='__main__':main()
