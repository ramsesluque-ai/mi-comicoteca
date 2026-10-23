#!/usr/bin/env python3
"""Fast Tebeosfera-only second pass for Maestro covers left uncovered.

This pass broadens deterministic collection URL variants and, only for very
small residual groups, tries deterministic issue URLs. It deliberately avoids
Bing/DDG and per-issue deep search so the whole Maestro can be swept to
completion. Truly unresolved rows remain explicit for the final audit.
"""
import argparse,json,time
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
import requests
import master_cover_tebeosfera_collections as c
import master_cover_tebeosfera_fast as f
import master_cover_tebeosfera_first as m

ROOT=Path(__file__).resolve().parent
m.save_image=lambda url,sid:str(url or '').strip()

def load(path,default):
    try:return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:return default

def save(path,data):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def all_existing_overlays():
    paths=[ROOT/'bridge/cache/master-cover-overrides.json',ROOT/'bridge/cache/master-cover-full-overrides.json']
    for i in range(4):
        paths += [ROOT/f'bridge/cache/master-cover-shard-{i}-overrides.json',ROOT/f'bridge/cache/master-cover-collection-shard-{i}-overrides.json',ROOT/f'bridge/cache/master-cover-fallback-shard-{i}-overrides.json']
    merged={}
    for p in paths:
        d=load(p,{})
        if isinstance(d,dict):merged.update(d)
    return merged

def collections_complete():
    flags=[bool(load(ROOT/f'bridge/cache/master-cover-collection-shard-{i}-state.json',{}).get('complete')) for i in range(4)]
    return all(flags),flags

def broader_candidates(row):
    ss=f.series_slugs(row);ys=f.years(row);ps=f.publisher_slugs(row.get('publisher') or '')
    out=[]
    for y in ys[:3]:
        for s in ss[:10]:
            for p in ps[:6]:
                u=f'{c.BASE}/colecciones/{s}_{y}_{p}.html'
                if u not in out:out.append(u)
    return out[:36]

def fetch_broad_collection(row):
    session=requests.Session();session.headers.update(c.HEADERS)
    for url in broader_candidates(row):
        try:r=session.get(url,timeout=7,allow_redirects=True)
        except Exception:continue
        if r.status_code!=200:continue
        soup=c.BeautifulSoup(r.text,'html.parser')
        if not c.collection_page_ok(row,r,soup):continue
        gal=c.choose_gallery(soup);gid=gal.get('data-id') or ''
        container=soup.select_one(f'#nkgal-galeria-{gid}') if gid else gal
        cards=c.extract_cards(container,r.url);cards=c.ajax_all(session,soup,gal,r.url,cards)
        if cards:return r.url,cards
    return '',{}

def direct_issue(row):
    sid=str(row.get('sourceId') or '').strip()
    if not sid.isdigit():return None
    try:return f.try_links(row,sid,f.direct_issue_links(row)[:8],'fallback-direct')
    except Exception as e:print('FALLBACK_DIRECT_ERROR',sid,repr(e));return None

def process_group(key,rows,existing):
    missing=[r for r in rows if 'gcd:'+str(r.get('sourceId') or '').strip() not in existing]
    if not missing:return key,{},'covered'
    entries={};url,cards=fetch_broad_collection(missing[0])
    if cards:
        for row in missing:
            sid=str(row.get('sourceId') or '').strip();card=cards.get(c.issue_num(row))
            if sid.isdigit() and card:
                e=c.make_entry(row,card,url);e['source']='Tebeosfera · colección fallback';entries['gcd:'+sid]=e
    remaining=[r for r in missing if 'gcd:'+str(r.get('sourceId') or '').strip() not in entries]
    # Small residual groups can be checked cheaply with deterministic issue URLs.
    if len(remaining)<=5:
        for row in remaining:
            sid=str(row.get('sourceId') or '').strip();hit=direct_issue(row)
            if hit:
                hit=dict(hit);hit['source']='Tebeosfera · fallback directo';entries['gcd:'+sid]=hit
    return key,entries,'hit' if entries else 'miss'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--shard-index',type=int,required=True);ap.add_argument('--shard-count',type=int,default=4);ap.add_argument('--batch',type=int,default=80);ap.add_argument('--workers',type=int,default=4);a=ap.parse_args()
    ready,flags=collections_complete()
    if not ready:print('FALLBACK_NOT_READY',flags);raise SystemExit(3)
    groups,keys,ambiguous,total_rows=c.read_master(a.master);shard_keys=[k for pos,k in enumerate(keys) if pos%a.shard_count==a.shard_index]
    state_path=ROOT/f'bridge/cache/master-cover-fallback-shard-{a.shard_index}-state.json';overlay_path=ROOT/f'bridge/cache/master-cover-fallback-shard-{a.shard_index}-overrides.json'
    state=load(state_path,{});overlay=load(overlay_path,{});existing=all_existing_overlays();existing.update(overlay);cursor=int(state.get('cursor') or 0)
    if cursor>=len(shard_keys):
        state.update({'complete':True,'cursor':len(shard_keys),'groupsTotal':len(shard_keys),'masterRows':total_rows,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});save(state_path,state);save(overlay_path,overlay);print('FALLBACK_COMPLETE',json.dumps(state));return
    batch_keys=shard_keys[cursor:cursor+max(1,a.batch)];stats={'hit':0,'miss':0,'covered':0,'linked':0};results={};workers=max(1,min(a.workers,5,len(batch_keys) or 1))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs={ex.submit(process_group,k,groups[k],existing):k for k in batch_keys}
        for fut in as_completed(futs):
            k=futs[fut]
            try:key,entries,status=fut.result()
            except Exception as e:print('FALLBACK_GROUP_ERROR',k,repr(e));key,entries,status=k,{},'miss'
            results[key]=entries;stats[status]=stats.get(status,0)+1;stats['linked']+=len(entries);print('FALLBACK_GROUP',status,len(entries),key)
    for k in batch_keys:overlay.update(results.get(k,{}) or {})
    cursor+=len(batch_keys);state.update({'shard':a.shard_index,'shardCount':a.shard_count,'cursor':cursor,'groupsTotal':len(shard_keys),'groupsProcessed':int(state.get('groupsProcessed') or 0)+len(batch_keys),'groupsHit':int(state.get('groupsHit') or 0)+stats['hit'],'groupsMiss':int(state.get('groupsMiss') or 0)+stats['miss'],'groupsAlreadyCovered':int(state.get('groupsAlreadyCovered') or 0)+stats['covered'],'linked':int(state.get('linked') or 0)+stats['linked'],'lastBatch':len(batch_keys),'lastLinked':stats['linked'],'masterRows':total_rows,'complete':cursor>=len(shard_keys),'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});save(overlay_path,overlay);save(state_path,state);print('FALLBACK_PROGRESS',json.dumps(state,ensure_ascii=False))
if __name__=='__main__':main()
