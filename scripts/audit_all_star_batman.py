#!/usr/bin/env python3
import json, re, unicodedata
from pathlib import Path
from collections import Counter, defaultdict
ROOT=Path(__file__).resolve().parents[1]
PUB=ROOT/'master-data'/'publishers'

def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    s=s.replace('\u200b',' ').replace('\u00a0',' ')
    return re.sub(r'\s+',' ',s).strip()

rows=[]
for p in sorted(PUB.glob('ecc-*.json')):
    try:data=json.loads(p.read_text(encoding='utf-8'))
    except:continue
    for r in data if isinstance(data,list) else []:
        hay=' '.join(str(r.get(k) or '') for k in ('catalogHeader','series','title'))
        n=norm(hay)
        if 'all-star' in n or 'all star' in n:
            if 'batman' in n and 'renacimiento' in n:
                rows.append(r)

groups=defaultdict(list)
for r in rows:
    key=(str(r.get('publisher') or ''),str(r.get('catalogHeader') or ''),str(r.get('series') or ''),str(r.get('volume') or ''),str(r.get('stage') or ''),str(r.get('startYear') or ''))
    groups[key].append(r)
out={'matched':len(rows),'groups':[]}
for k,grp in sorted(groups.items(), key=lambda kv:(kv[0][1],kv[0][5],kv[0][3],kv[0][4])):
    out['groups'].append({
      'publisher':k[0],'catalogHeader':k[1],'series':k[2],'volume':k[3],'stage':k[4],'startYear':k[5],
      'count':len(grp),'issues':[str(x.get('issueNr') or x.get('issue') or '') for x in grp],
      'sourceIds':[str(x.get('sourceId') or '') for x in grp[:20]],
      'isbns':[str(x.get('isbn') or '') for x in grp if x.get('isbn')][:20]
    })
(ROOT/'master-data'/'audit-all-star-batman.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False))
