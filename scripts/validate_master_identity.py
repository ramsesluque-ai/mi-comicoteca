#!/usr/bin/env python3
"""Valida el Maestro completo con identidad Editorial+Cabecera+Volumen+Etapa+Año.

No contiene excepciones por personaje/editorial. Los casos conocidos se usan solo como
regresiones adicionales; la detección de colisiones se ejecuta sobre todo master-data.
"""
import json, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PUBDIR=ROOT/'master-data'/'publishers'
OUT=ROOT/'master-data'/'identity-audit.json'

def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'\s+',' ',s).strip()

def ident(r):
    return (norm(r.get('publisher')),norm(r.get('catalogHeader') or r.get('series')),norm(r.get('volume')),norm(r.get('stage')),str(r.get('startYear') or '').strip())

def issue_key(r):
    return str(r.get('issueNr') or r.get('issue') or '').strip().lower()

def main():
    rows=[]
    for p in sorted(PUBDIR.glob('*.json')):
        d=json.loads(p.read_text(encoding='utf-8'))
        if isinstance(d,list): rows.extend(x for x in d if isinstance(x,dict))
    series=defaultdict(list); name_families=defaultdict(set)
    for r in rows:
        k=ident(r); series[k].append(r)
        name_families[(k[0],k[1])].add(k)
    duplicate_issues=[]
    for k,items in series.items():
        seen=defaultdict(list)
        for r in items:
            n=issue_key(r)
            if n: seen[n].append(str(r.get('id') or ''))
        for n,ids in seen.items():
            if len(ids)>1: duplicate_issues.append({'identity':k,'issue':n,'ids':ids})
    homonyms=[{'publisher':k[0],'header':k[1],'identities':len(v)} for k,v in name_families.items() if len(v)>1]
    blank_headers=sum(1 for r in rows if not norm(r.get('catalogHeader') or r.get('series')))
    audit={'rows':len(rows),'identities':len(series),'homonymousFamilies':len(homonyms),'duplicateIssuesWithinIdentity':len(duplicate_issues),'blankHeaders':blank_headers,'homonymSamples':sorted(homonyms,key=lambda x:-x['identities'])[:100],'duplicateSamples':duplicate_issues[:100]}
    OUT.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:audit[k] for k in ('rows','identities','homonymousFamilies','duplicateIssuesWithinIdentity','blankHeaders')},ensure_ascii=False))
    if blank_headers or duplicate_issues:
        sys.exit(1)

if __name__=='__main__': main()
