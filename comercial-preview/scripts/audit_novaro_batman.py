#!/usr/bin/env python3
import json,re,unicodedata
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PUB=ROOT/'master-data'/'publishers'
OUT=ROOT/'master-data'/'audit-novaro-batman.json'

def norm(v):
 s=unicodedata.normalize('NFD',str(v or ''))
 return re.sub(r'\s+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower()).strip()
def issue_key(v):
 s=str(v or '').strip();m=re.match(r'^0*(\d+)',s)
 return (0,int(m.group(1))) if m else (1,s)
def batman_row(r):
 text=norm(' '.join(str(r.get(k) or '') for k in ('catalogHeader','series','title','tags')))
 return 'batman' in text or 'hombre murcielago' in text

def main():
 rows=[]
 for p in sorted(PUB.glob('novaro-*.json')):
  try:d=json.loads(p.read_text(encoding='utf-8'))
  except:continue
  if isinstance(d,list):rows.extend(r for r in d if isinstance(r,dict) and batman_row(r))
 groups=defaultdict(list)
 for r in rows:
  key=(str(r.get('catalogHeader') or r.get('series') or ''),str(r.get('stage') or ''),str(r.get('startYear') or ''),str(r.get('volume') or ''))
  groups[key].append(r)
 out=[]
 for (header,stage,year,volume),a in sorted(groups.items(),key=lambda z:(norm(z[0][0]),norm(z[0][1]),z[0][2],z[0][3])):
  issues=sorted({str(x.get('issueNr') or x.get('issue') or '') for x in a if str(x.get('issueNr') or x.get('issue') or '')},key=issue_key)
  out.append({'catalogHeader':header,'stage':stage,'startYear':year,'volume':volume,'issues':len(a),'firstIssue':issues[0] if issues else '','lastIssue':issues[-1] if issues else '','sampleIssues':issues[:12]})
 payload={'publisher':'Novaro','character':'Batman / Hombre Murciélago','totalMatchedIssues':len(rows),'groups':len(out),'collections':out}
 OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'matched':len(rows),'groups':len(out)},ensure_ascii=False))
if __name__=='__main__':main()
