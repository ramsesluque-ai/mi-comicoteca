#!/usr/bin/env python3
"""Deep Tebeosfera-only resolver for uncovered Maestro issues.

Uses the exact bibliographic identity Editorial + Cabecera + Volumen/Etapa +
Año + Número. It resolves collection pages first and reads Tebeosfera's own
issue gallery (including AJAX pagination). Existing verified covers are never
replaced. No secondary source is used.
"""
import argparse,json,re,time
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
import requests
from bs4 import BeautifulSoup
import master_cover_tebeosfera_collections as c
import master_cover_tebeosfera_fast as f
import master_cover_tebeosfera_first as m

ROOT=Path(__file__).resolve().parent
BASE='https://www.tebeosfera.com'


def load(p,d):
    try:return json.loads(Path(p).read_text(encoding='utf-8'))
    except Exception:return d

def save(p,d):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def existing_overlays():
    pats=['master-cover-overrides.json','master-cover-full-overrides.json']
    for i in range(4):
        pats += [f'master-cover-shard-{i}-overrides.json',f'master-cover-collection-shard-{i}-overrides.json',f'master-cover-fallback-shard-{i}-overrides.json',f'master-cover-exact-v2-shard-{i}-overrides.json']
    out={}
    for name in pats:
        d=load(ROOT/'bridge/cache'/name,{})
        if isinstance(d,dict):out.update(d)
    return out

def candidates(row):
    ss=f.series_slugs(row); ys=f.years(row); ps=f.publisher_slugs(row.get('publisher') or '')
    stage=str(row.get('stage') or row.get('volume') or '').strip()
    extra=[]
    if stage:
        for s in list(ss):
            for x in (f'{s}_{f.plain_slug(stage)}',f'{s} {stage}'):
                for v in f.tebeosfera_slug_variants(x):
                    if v not in extra:extra.append(v)
    ss=(extra+ss)[:18]
    out=[]
    for y in ys[:3]:
        for s in ss:
            for p in ps[:6]:
                for u in (f'{BASE}/colecciones/{s}_{y}_{p}.html',f'{BASE}/obras/publicaciones/{s}_{p}_{y}.html'):
                    if u not in out:out.append(u)
    return out[:160]

def page_cards(session,row,url):
    try:r=session.get(url,timeout=10,allow_redirects=True)
    except Exception:return '',{}
    if r.status_code!=200:return '',{}
    soup=BeautifulSoup(r.text,'html.parser')
    if not c.collection_page_ok(row,r,soup):return '',{}
    gal=c.choose_gallery(soup)
    if not gal:return '',{}
    gid=gal.get('data-id') or ''
    container=soup.select_one(f'#nkgal-galeria-{gid}') if gid else gal
    cards=c.extract_cards(container,r.url)
    try:cards=c.ajax_all(session,soup,gal,r.url,cards)
    except Exception:pass
    return r.url,cards

def resolve_group(key,rows,existing):
    missing=[r for r in rows if not (existing.get('gcd:'+str(r.get('sourceId') or '').strip()) or {}).get('coverUrl')]
    if not missing:return key,{},'covered'
    session=requests.Session();session.headers.update(c.HEADERS)
    needed={c.issue_num(r) for r in missing}
    for url in candidates(missing[0]):
        final,cards=page_cards(session,missing[0],url)
        if not cards:continue
        if not (needed & set(cards)):continue
        entries={}
        for row in missing:
            sid=str(row.get('sourceId') or '').strip(); n=c.issue_num(row); card=cards.get(n)
            if sid.isdigit() and card:
                e=c.make_entry(row,card,final);e['source']='Tebeosfera · ficha exacta v2';e['_score']=60000;entries['gcd:'+sid]=e
        if entries:return key,entries,'hit'
    # Last exact attempt: issue pages generated from every deterministic identity.
    entries={}
    for row in missing[:12]:
        sid=str(row.get('sourceId') or '').strip()
        if not sid.isdigit():continue
        try:hit=f.try_links(row,sid,f.direct_issue_links(row),'exact-v2')
        except Exception:hit=None
        if hit:
            hit=dict(hit);hit['source']='Tebeosfera · ficha exacta v2';hit['_score']=60000;entries['gcd:'+sid]=hit
    return key,entries,'hit' if entries else 'miss'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--shard-index',type=int,required=True);ap.add_argument('--shard-count',type=int,default=4);ap.add_argument('--batch',type=int,default=25);ap.add_argument('--workers',type=int,default=2);a=ap.parse_args()
    groups,keys,ambiguous,total=c.read_master(a.master)
    shard=[k for i,k in enumerate(keys) if i%a.shard_count==a.shard_index]
    sp=ROOT/f'bridge/cache/master-cover-exact-v2-shard-{a.shard_index}-state.json';op=ROOT/f'bridge/cache/master-cover-exact-v2-shard-{a.shard_index}-overrides.json'
    state=load(sp,{});overlay=load(op,{});existing=existing_overlays();existing.update(overlay);cursor=int(state.get('cursor') or 0)
    if cursor>=len(shard):
        state.update({'complete':True,'cursor':len(shard),'groupsTotal':len(shard),'masterRows':total,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});save(sp,state);save(op,overlay);return
    batch=shard[cursor:cursor+max(1,a.batch)];res={};stats={'hit':0,'miss':0,'covered':0,'linked':0}
    with ThreadPoolExecutor(max_workers=max(1,min(a.workers,3,len(batch) or 1))) as ex:
        fs={ex.submit(resolve_group,k,groups[k],existing):k for k in batch}
        for fu in as_completed(fs):
            k=fs[fu]
            try:key,entries,status=fu.result()
            except Exception as e:print('EXACT_V2_ERROR',k,repr(e));key,entries,status=k,{},'miss'
            res[key]=entries;stats[status]+=1;stats['linked']+=len(entries);print('EXACT_V2',status,len(entries),key)
    for k in batch:overlay.update(res.get(k,{}) or {})
    cursor+=len(batch);state.update({'shard':a.shard_index,'shardCount':a.shard_count,'cursor':cursor,'groupsTotal':len(shard),'groupsProcessed':int(state.get('groupsProcessed') or 0)+len(batch),'groupsHit':int(state.get('groupsHit') or 0)+stats['hit'],'groupsMiss':int(state.get('groupsMiss') or 0)+stats['miss'],'groupsAlreadyCovered':int(state.get('groupsAlreadyCovered') or 0)+stats['covered'],'linked':int(state.get('linked') or 0)+stats['linked'],'lastBatch':len(batch),'lastLinked':stats['linked'],'masterRows':total,'complete':cursor>=len(shard),'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});save(op,overlay);save(sp,state);print('EXACT_V2_PROGRESS',json.dumps(state,ensure_ascii=False))
if __name__=='__main__':main()
