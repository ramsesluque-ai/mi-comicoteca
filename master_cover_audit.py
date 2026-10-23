#!/usr/bin/env python3
import json,re,time
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def load(p,d):
    try:return json.loads(Path(p).read_text(encoding='utf-8'))
    except Exception:return d

def issue(v):
    s=str(v or '').strip();return str(int(s)) if re.fullmatch(r'0*\d+',s) else ''

def main():
    overlays={}
    paths=[ROOT/'bridge/cache/master-cover-overrides.json',ROOT/'bridge/cache/master-cover-full-overrides.json']
    for i in range(4):
        paths += [ROOT/f'bridge/cache/master-cover-shard-{i}-overrides.json',ROOT/f'bridge/cache/master-cover-collection-shard-{i}-overrides.json',ROOT/f'bridge/cache/master-cover-fallback-shard-{i}-overrides.json']
    for p in paths:
        d=load(p,{})
        if isinstance(d,dict):overlays.update(d)
    total=eligible=covered=0;pub_missing=Counter();source_counts=Counter();cover_keys=set()
    for k,v in overlays.items():
        if isinstance(v,dict) and v.get('coverUrl'):
            cover_keys.add(k)
            source_counts[str(v.get('source') or 'unknown')]+=1
    for fp in sorted((ROOT/'_main/master-data/publishers').glob('*.json')):
        rows=load(fp,[])
        if not isinstance(rows,list):continue
        for r in rows:
            if not isinstance(r,dict):continue
            total+=1
            sid=str(r.get('sourceId') or '').strip();n=issue(r.get('issueNr') or r.get('issue'))
            if sid.isdigit() and n:
                eligible+=1
                if 'gcd:'+sid in cover_keys:covered+=1
                else:pub_missing[str(r.get('publisher') or '(sin editorial)')]+=1
    collection_states=[load(ROOT/f'bridge/cache/master-cover-collection-shard-{i}-state.json',{}) for i in range(4)]
    fallback_states=[load(ROOT/f'bridge/cache/master-cover-fallback-shard-{i}-state.json',{}) for i in range(4)]
    out={
      'totalRows':total,'eligibleIssueRows':eligible,'coveredEligibleRows':covered,
      'missingEligibleRows':eligible-covered,'coveragePct':round((covered/eligible*100) if eligible else 0,2),
      'overlayKeysWithCover':len(cover_keys),'sourceCounts':dict(source_counts),
      'topMissingPublishers':pub_missing.most_common(25),
      'collectionComplete':[bool(s.get('complete')) for s in collection_states],
      'fallbackComplete':[bool(s.get('complete')) for s in fallback_states],
      'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    p=ROOT/'bridge/cache/master-cover-audit.json';p.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
