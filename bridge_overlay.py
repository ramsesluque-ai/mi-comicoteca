#!/usr/bin/env python3
import json,re,unicodedata
from pathlib import Path

ROOT=Path(__file__).resolve().parent
RESULTS=ROOT/'bridge'/'results'
OUT=ROOT/'bridge'/'cache'/'master-cover-overrides.json'

def code(v):
    return ''.join(ch for ch in str(v or '').upper() if ch.isdigit() or ch=='X')

def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    return re.sub(r'\s+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower()).strip()

def issue(v):
    s=str(v or '').strip().lower().replace('º','').replace('°','')
    s=re.sub(r'\s+','',s)
    if re.fullmatch(r'0*\d+',s):return str(int(s))
    return re.sub(r'^0+(?=\d)','',s)

def canon_pub(v):
    n=norm(v)
    rules=[('ECC',r'\becc\b'),('Panini',r'panini'),('Planeta / DeAgostini',r'planeta|deagostini'),('Forum',r'forum'),('Zinco',r'zinco'),('Vértice',r'vertice'),('Bruguera',r'bruguera'),('Novaro',r'novaro'),('Norma',r'norma'),('Glénat',r'glenat'),('Salvat',r'salvat')]
    for label,pat in rules:
        if re.search(pat,n):return label
    return str(v or '').strip()

def composite_key(d,q,blank_volume=False):
    pub=canon_pub(d.get('publisher') or q.get('publisher') or '')
    series=d.get('series') or q.get('series') or ''
    volume='' if blank_volume else str(d.get('volume') or q.get('volume') or '')
    stage=d.get('stage') or q.get('stage') or ''
    year=str(d.get('startYear') or q.get('startYear') or '').strip()
    num=d.get('issueNr') or q.get('issue') or ''
    if not pub or not series or not issue(num):return ''
    return '@:'+ '|'.join([norm(pub),norm(series),norm(volume),norm(stage),year,issue(num)])

def store(current,key,d,q,c,isbn,source_id):
    if not key:return
    old=current.get(key) or {}
    score=int(c.get('score') or 0)
    # Tebeosfera es autoridad: una coincidencia válida no puede ser desplazada por una fuente secundaria.
    new_teb='tebeosfera' in norm(c.get('source'))
    old_teb='tebeosfera' in norm(old.get('source'))
    if old and old_teb and not new_teb:return
    if old and not new_teb and int(old.get('_score') or 0)>score:return
    current[key]={
        'isbn':isbn,
        'sourceId':source_id,
        'title':d.get('title') or old.get('title',''),
        'publisher':d.get('publisher') or q.get('publisher') or old.get('publisher',''),
        'series':d.get('series') or q.get('series') or old.get('series',''),
        'volume':str(d.get('volume') or q.get('volume') or old.get('volume','')),
        'stage':d.get('stage') or q.get('stage') or old.get('stage',''),
        'startYear':str(d.get('startYear') or q.get('startYear') or old.get('startYear','')),
        'issueNr':str(d.get('issueNr') or q.get('issue') or old.get('issueNr','')),
        'publicationDate':d.get('publicationDate') or old.get('publicationDate',''),
        'pages':d.get('pages') or old.get('pages',''),
        'coverUrl':d.get('coverUrl') or old.get('coverUrl',''),
        'sourceUrl':d.get('sourceUrl') or old.get('sourceUrl',''),
        'source':'Bridge · '+str(c.get('source') or 'fuente verificada'),
        '_score':score
    }

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
            if not d.get('coverUrl'): continue
            keys=[]
            if len(isbn) in (10,13):keys.append(isbn)
            if source_id.isdigit():keys.append('gcd:'+source_id)
            ck=composite_key(d,q)
            if ck:keys.append(ck)
            # Alias sin volumen: año + etapa + número siguen discriminando y cubre catálogos históricos
            # donde el volumen es una numeración interna distinta entre Catálogo y Maestro.
            ck0=composite_key(d,q,blank_volume=True)
            if ck0 and ck0 not in keys:keys.append(ck0)
            for key in keys:store(current,key,d,q,c,isbn,source_id)
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(current,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8')
    print('MASTER_COVER_OVERLAY',len(current),'claves de portada')

if __name__=='__main__': main()
