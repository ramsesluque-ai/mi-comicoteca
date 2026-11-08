#!/usr/bin/env python3
"""Audit all Maestro publishers against an authorized Tebeosfera export.

No crawling. No cover downloads. Dry-run by default; generates review CSVs.
Input CSV fields: publisher,catalogHeader,volume,stage,startYear,issueNr,
isbn,title,publicationDate,coverUrl,sourceUrl,coverReuseAuthorized.
"""
import argparse,csv,json,re,unicodedata
from pathlib import Path
from collections import Counter,defaultdict

ROOT=Path(__file__).resolve().parents[1]
def norm(s):
    return re.sub(r'\s+',' ',''.join(c for c in unicodedata.normalize('NFKD',str(s or '')) if not unicodedata.combining(c)).casefold()).strip()
def pub(s):
    n=norm(s)
    return {'ecc ediciones':'ecc','editorial bruguera':'bruguera','bruguera editorial':'bruguera','panini comics':'panini','planeta deagostini':'planeta / deagostini'}.get(n,n)
def identity(r):
    return (pub(r.get('publisher')),norm(r.get('catalogHeader') or r.get('series')),norm(r.get('volume')),norm(r.get('stage')),norm(r.get('startYear')),norm(r.get('issueNr') or r.get('issue')))
def isbn(r):return re.sub('[^0-9X]','',str(r.get('isbn') or '').upper())
def match(ref, candidates):
    if not candidates:return None,'missing'
    exact=[x for x in candidates if isbn(ref) and isbn(x) and isbn(ref)==isbn(x)]
    if len(exact)==1:return exact[0],'isbn'
    if len(exact)>1:return None,'ambiguous'
    # Do not merge differing ISBNs or publication dates.
    compatible=[x for x in candidates if not(isbn(ref) and isbn(x) and isbn(ref)!=isbn(x)) and not(ref.get('publicationDate') and x.get('publicationDate') and ref['publicationDate']!=x['publicationDate'])]
    if len(compatible)==1:return compatible[0],'edition_fields'
    return None,'ambiguous'
def write(path,rows,fields):
    with path.open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
def main():
    p=argparse.ArgumentParser();p.add_argument('--reference',required=True,help='Authorized Tebeosfera CSV export');p.add_argument('--output',default='master-data/tebeosfera-audit');a=p.parse_args()
    out=ROOT/a.output;out.mkdir(parents=True,exist_ok=True)
    index=json.loads((ROOT/'master-data/index.json').read_text(encoding='utf-8'))
    master=[];bykey=defaultdict(list)
    for publisher in index['publishers']:
        for chunk in publisher['chunks']:
            for r in json.loads((ROOT/'master-data'/chunk).read_text(encoding='utf-8')):
                master.append(r);bykey[identity(r)].append(r)
    with open(a.reference,encoding='utf-8-sig',newline='') as f: refs=list(csv.DictReader(f))
    required={'publisher','catalogHeader','issueNr'}
    if not refs or not required.issubset(refs[0]):raise SystemExit('Reference must have publisher,catalogHeader,issueNr')
    missing=[];ambiguous=[];matched=[];covers=[];seen=set()
    for r in refs:
        k=identity(r)
        if not k[0] or not k[1] or not k[5]:ambiguous.append({**r,'reason':'insufficient identity'});continue
        m,reason=match(r,bykey.get(k,[]))
        if reason=='missing':
            missing.append({**r,'reason':'not present in Maestro'});continue
        if not m:
            ambiguous.append({**r,'reason':reason});continue
        seen.add(m.get('id'));matched.append({**r,'masterId':m.get('id'),'matchType':reason})
        if not m.get('coverUrl') and r.get('coverUrl'):
            covers.append({**r,'masterId':m.get('id'),'authorized':str(r.get('coverReuseAuthorized','')).lower() in ('true','yes','si','sí','1')})
    fields=['publisher','catalogHeader','volume','stage','startYear','issueNr','isbn','title','publicationDate','coverUrl','sourceUrl','coverReuseAuthorized','masterId','matchType','reason','authorized']
    for name,items in [('missing',missing),('ambiguous',ambiguous),('matched',matched),('cover-candidates',covers)]:
        write(out/(name+'.csv'),items,fields)
    summary={'masterRecords':len(master),'masterPublishers':len(index['publishers']),'referenceRecords':len(refs),'matched':len(matched),'missingCandidates':len(missing),'ambiguous':len(ambiguous),'coverCandidates':len(covers),'coverReuseAuthorized':sum(x['authorized'] for x in covers),'unmatchedMasterRecords':len(master)-len(seen),'note':'Dry run. Missing and cover candidates are not imported automatically. Reference must be licensed/authorized.'}
    (out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
