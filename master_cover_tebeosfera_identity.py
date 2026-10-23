#!/usr/bin/env python3
import argparse,json,re,time
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from master_cover_identity_backfill import (
    ROOT, OVERLAY, COVERS, norm, code, issue_num, year_of,
    tebeosfera_links, inspect_tebeosfera, save_image, hit_meta,
    priority_files, load_json
)

STATE=ROOT/'bridge'/'cache'/'master-cover-tebeosfera-identity-state.json'


def composite_key(row, blank_volume=False):
    def n(v): return re.sub(r'\s+',' ',norm(v)).strip()
    def ino(v):
        s=str(v or '').strip()
        return str(int(s)) if re.fullmatch(r'0*\d+',s) else n(s)
    return '@:'+'|'.join([
        n(row.get('publisher')),
        n(row.get('catalogHeader') or row.get('series')),
        '' if blank_volume else n(row.get('volume')),
        n(row.get('stage')),
        str(row.get('startYear') or '').strip(),
        ino(row.get('issueNr') if row.get('issueNr') is not None else row.get('issue'))
    ])


def keys_for(row):
    out=[]
    isbn=code(row.get('isbn') or row.get('barcode'))
    if len(isbn) in (10,13): out.append(isbn)
    sid=str(row.get('sourceId') or '').strip().replace('gcd_','')
    if sid: out.append('gcd:'+sid)
    for k in (composite_key(row), composite_key(row,True)):
        if k and k not in out: out.append(k)
    return out


def has_tebeosfera(row,overlay):
    for k in keys_for(row):
        old=overlay.get(k) or {}
        if old.get('coverUrl') and 'tebeosfera' in norm(old.get('source')):
            return True
    return False


def resolve_tebeosfera(row):
    sid=str(row.get('sourceId') or '').strip()
    # Tebeosfera es la autoridad única de portada. Sin ISBN se valida por
    # editorial + cabecera/serie + número + etapa/volumen + año cuando exista.
    for url in tebeosfera_links(row):
        cand=inspect_tebeosfera(url,row)
        if not cand:
            continue
        stored=save_image(cand['image'], sid or re.sub(r'\W+','-',norm(cand['title'])))
        if not stored:
            continue
        meta=hit_meta(row,sid,cand,stored,50000)
        meta['authority']='Tebeosfera'
        meta['match']='Identidad bibliográfica exacta sin depender de ISBN'
        meta['source']='Backfill · Tebeosfera principal'
        return meta
    return None


def store(row,meta,overlay):
    for k in keys_for(row):
        old=overlay.get(k) or {}
        # Tebeosfera prevalece sobre cualquier fuente anterior.
        if old.get('coverUrl') and 'tebeosfera' in norm(old.get('source')):
            continue
        overlay[k]=dict(meta)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--master',required=True)
    ap.add_argument('--batch',type=int,default=60)
    ap.add_argument('--workers',type=int,default=3)
    args=ap.parse_args()

    files=priority_files(args.master)
    overlay=load_json(OVERLAY,{})
    state=load_json(STATE,{'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0})
    fi=int(state.get('fileIndex') or 0); ri=int(state.get('rowIndex') or 0)
    targets=[]; seen=set(); scanned_this=0; max_scan=max(args.batch*500,15000)

    while len(targets)<args.batch and files and scanned_this<max_scan:
        if fi>=len(files):
            fi=0; ri=0; state['passes']=int(state.get('passes') or 0)+1
        rows=load_json(files[fi],[])
        if not isinstance(rows,list): rows=[]
        if ri>=len(rows):
            fi+=1; ri=0; continue
        row=rows[ri]; ri+=1; scanned_this+=1
        state['scanned']=int(state.get('scanned') or 0)+1
        if not isinstance(row,dict): continue
        n=issue_num(row.get('issueNr') or row.get('issue'))
        sid=str(row.get('sourceId') or '').strip()
        if not n: continue
        dedupe=sid or '|'.join([norm(row.get('publisher')),norm(row.get('catalogHeader') or row.get('series')),n,str(row.get('startYear') or '')])
        if dedupe in seen: continue
        seen.add(dedupe)
        if has_tebeosfera(row,overlay): continue
        targets.append(row)

    linked=0
    workers=max(1,min(int(args.workers or 3),3,len(targets) or 1))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs={ex.submit(resolve_tebeosfera,row):row for row in targets}
        for fut in as_completed(futs):
            row=futs[fut]
            try: hit=fut.result()
            except Exception as e:
                print('TEBEOSFERA_IDENTITY_ERROR',row.get('sourceId'),repr(e)); continue
            if not hit: continue
            store(row,hit,overlay); linked+=1
            state['linked']=int(state.get('linked') or 0)+1
            print('TEBEOSFERA_IDENTITY_LINKED',row.get('publisher'),row.get('catalogHeader') or row.get('series'),row.get('issueNr'),row.get('sourceId'),hit.get('sourceUrl'))

    state.update({
        'fileIndex':fi,'rowIndex':ri,'lastBatchChecked':len(targets),
        'lastBatchLinked':linked,'lastBatchScanned':scanned_this,
        'lastWorkers':workers,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
        'phase':'tebeosfera-identity-primary','yearRequired':False,'isbnRequired':False
    })
    OVERLAY.parent.mkdir(parents=True,exist_ok=True)
    OVERLAY.write_text(json.dumps(overlay,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8')
    STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
    print('TEBEOSFERA_IDENTITY_BACKFILL',json.dumps(state,ensure_ascii=False),'overlay',len(overlay))

if __name__=='__main__': main()
