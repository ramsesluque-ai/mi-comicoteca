#!/usr/bin/env python3
"""Second-pass Tebeosfera resolver for Maestro covers left uncovered.

Runs only after the four fast collection shards complete. It keeps the exact
collection identity (publisher + header + volume/stage + start year), tries a
broader set of Tebeosfera collection URLs, then uses the existing strict
per-issue Tebeosfera resolver only for rows still missing. No non-Tebeosfera
cover source is used.
"""
import argparse, json, re, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
import master_cover_tebeosfera_collections as c
import master_cover_tebeosfera_fast as f
import master_cover_tebeosfera_first as m

ROOT=Path(__file__).resolve().parent


def load(path,default):
    try:return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:return default


def save(path,data):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')


def all_existing_overlays():
    paths=[
        ROOT/'bridge/cache/master-cover-overrides.json',
        ROOT/'bridge/cache/master-cover-full-overrides.json',
    ]
    for i in range(4):
        paths += [
            ROOT/f'bridge/cache/master-cover-shard-{i}-overrides.json',
            ROOT/f'bridge/cache/master-cover-collection-shard-{i}-overrides.json',
        ]
    merged={}
    for p in paths:
        d=load(p,{})
        if isinstance(d,dict):merged.update(d)
    return merged


def collections_complete():
    states=[]
    for i in range(4):
        p=ROOT/f'bridge/cache/master-cover-collection-shard-{i}-state.json'
        d=load(p,{})
        states.append(bool(d.get('complete')))
    return all(states),states


def broader_candidates(row):
    ss=f.series_slugs(row);ys=f.years(row);ps=f.publisher_slugs(row.get('publisher') or '')
    out=[]
    for y in ys[:3]:
        for s in ss[:10]:
            for p in ps[:6]:
                u=f'{c.BASE}/colecciones/{s}_{y}_{p}.html'
                if u not in out:out.append(u)
    return out[:72]


def fetch_broad_collection(row):
    session=requests.Session();session.headers.update(c.HEADERS)
    for url in broader_candidates(row):
        try:r=session.get(url,timeout=12,allow_redirects=True)
        except Exception:continue
        if r.status_code!=200:continue
        soup=c.BeautifulSoup(r.text,'html.parser')
        if not c.collection_page_ok(row,r,soup):continue
        gal=c.choose_gallery(soup)
        gid=gal.get('data-id') or ''
        container=soup.select_one(f'#nkgal-galeria-{gid}') if gid else gal
        cards=c.extract_cards(container,r.url)
        cards=c.ajax_all(session,soup,gal,r.url,cards)
        if cards:return r.url,cards
    return '',{}


def strict_issue(row):
    # Keep Tebeosfera remote image URL after strict page validation. This avoids
    # bulk image duplication while preserving the verified source URL.
    old_save=m.save_image
    try:
        m.save_image=lambda url,sid:str(url or '').strip()
        return f.resolve(row)
    finally:
        m.save_image=old_save


def entry_from_hit(row,hit):
    if not hit:return None
    hit=dict(hit)
    hit['source']='Tebeosfera · fallback exacto'
    return hit


def process_group(key,rows,existing):
    missing=[r for r in rows if ('gcd:'+str(r.get('sourceId') or '').strip()) not in existing]
    if not missing:return key,{},'covered'
    entries={}
    url,cards=fetch_broad_collection(missing[0])
    if cards:
        for row in missing:
            sid=str(row.get('sourceId') or '').strip();n=c.issue_num(row)
            card=cards.get(n)
            if sid.isdigit() and card:
                e=c.make_entry(row,card,url);e['source']='Tebeosfera · colección fallback'
                entries['gcd:'+sid]=e
    remaining=[r for r in missing if ('gcd:'+str(r.get('sourceId') or '').strip()) not in entries]
    # Cap per-group individual fallback so pathological long collections do not
    # monopolise a worker. Later rounds revisit uncovered rows through their group.
    for row in remaining[:40]:
        sid=str(row.get('sourceId') or '').strip()
        if not sid.isdigit():continue
        try:hit=strict_issue(row)
        except Exception as e:
            print('FALLBACK_ISSUE_ERROR',sid,repr(e));hit=None
        if hit:entries['gcd:'+sid]=entry_from_hit(row,hit)
    return key,entries,'hit' if entries else 'miss'


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--master',required=True)
    ap.add_argument('--shard-index',type=int,required=True)
    ap.add_argument('--shard-count',type=int,default=4)
    ap.add_argument('--batch',type=int,default=40)
    ap.add_argument('--workers',type=int,default=3)
    a=ap.parse_args()
    ready,flags=collections_complete()
    if not ready:
        print('FALLBACK_NOT_READY',flags)
        raise SystemExit(3)

    groups,keys,ambiguous,total_rows=c.read_master(a.master)
    shard_keys=[k for pos,k in enumerate(keys) if pos%a.shard_count==a.shard_index]
    state_path=ROOT/f'bridge/cache/master-cover-fallback-shard-{a.shard_index}-state.json'
    overlay_path=ROOT/f'bridge/cache/master-cover-fallback-shard-{a.shard_index}-overrides.json'
    state=load(state_path,{})
    overlay=load(overlay_path,{})
    existing=all_existing_overlays();existing.update(overlay)
    cursor=int(state.get('cursor') or 0)
    if cursor>=len(shard_keys):
        state.update({'complete':True,'cursor':len(shard_keys),'groupsTotal':len(shard_keys),'masterRows':total_rows,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
        save(state_path,state);save(overlay_path,overlay);print('FALLBACK_COMPLETE',json.dumps(state));return

    batch_keys=shard_keys[cursor:cursor+max(1,a.batch)]
    stats={'hit':0,'miss':0,'covered':0,'linked':0}
    results={}
    workers=max(1,min(a.workers,4,len(batch_keys) or 1))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs={ex.submit(process_group,k,groups[k],existing):k for k in batch_keys}
        for fut in as_completed(futs):
            k=futs[fut]
            try:key,entries,status=fut.result()
            except Exception as e:
                print('FALLBACK_GROUP_ERROR',k,repr(e));key,entries,status=k,{},'miss'
            results[key]=entries;stats[status]=stats.get(status,0)+1;stats['linked']+=len(entries)
            print('FALLBACK_GROUP',status,len(entries),key)
    for k in batch_keys:overlay.update(results.get(k,{}) or {})
    cursor+=len(batch_keys)
    state.update({
        'shard':a.shard_index,'shardCount':a.shard_count,'cursor':cursor,'groupsTotal':len(shard_keys),
        'groupsProcessed':int(state.get('groupsProcessed') or 0)+len(batch_keys),
        'groupsHit':int(state.get('groupsHit') or 0)+stats['hit'],
        'groupsMiss':int(state.get('groupsMiss') or 0)+stats['miss'],
        'groupsAlreadyCovered':int(state.get('groupsAlreadyCovered') or 0)+stats['covered'],
        'linked':int(state.get('linked') or 0)+stats['linked'],
        'lastBatch':len(batch_keys),'lastLinked':stats['linked'],'masterRows':total_rows,
        'complete':cursor>=len(shard_keys),'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
    save(overlay_path,overlay);save(state_path,state)
    print('FALLBACK_PROGRESS',json.dumps(state,ensure_ascii=False))

if __name__=='__main__':main()
