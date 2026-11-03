#!/usr/bin/env python3
"""Auditoría integral de calidad del Maestro de MI COMICOTECA.

No modifica datos. Recorre master-data/publishers/*.json y genera un informe JSON
con cobertura de campos esenciales, calidad por editorial y ejemplos de carencias.
La publicación comercial del Maestro debe basarse en este informe, no solo en el
número total de fichas.
"""
from __future__ import annotations
import json, re
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PUBDIR=ROOT/'master-data'/'publishers'
OUT=ROOT/'master-data'/'quality-audit.json'

FIELDS={
 'publisher': lambda r:r.get('publisher'),
 'catalogHeader': lambda r:r.get('catalogHeader') or r.get('series'),
 'volume': lambda r:r.get('volume'),
 'stage': lambda r:r.get('stage'),
 'startYear': lambda r:r.get('startYear'),
 'issueNumber': lambda r:r.get('issueNr') or r.get('issue'),
 'title': lambda r:r.get('title'),
 'publicationDate': lambda r:r.get('publicationDate'),
 'pages': lambda r:r.get('pages'),
 'isbn': lambda r:r.get('isbn'),
 'barcode': lambda r:r.get('barcode'),
 'price': lambda r:r.get('price'),
 'color': lambda r:r.get('color'),
 'format': lambda r:r.get('format'),
 'dimensions': lambda r:r.get('dimensions'),
 'binding': lambda r:r.get('binding'),
 'language': lambda r:r.get('language'),
 'coverUrl': lambda r:r.get('coverUrl'),
}
ESSENTIAL=('publisher','catalogHeader','startYear','issueNumber')
USEFUL=('publicationDate','pages','price','format','language','coverUrl')

def present(v):
 s=str(v or '').strip()
 return bool(s and s not in {'-1','0','null','None','N/A','n/a'})

def pct(n,d): return round(100*n/d,2) if d else 0.0

def main():
 rows=[]
 for p in sorted(PUBDIR.glob('*.json')):
  d=json.loads(p.read_text(encoding='utf-8'))
  if isinstance(d,list): rows.extend(x for x in d if isinstance(x,dict))
 total=len(rows)
 counts=Counter(); pub_total=Counter(); pub_counts=defaultdict(Counter); incomplete=[]
 for r in rows:
  pub=str(r.get('publisher') or '(sin editorial)').strip()
  pub_total[pub]+=1
  missing=[]
  for f,getter in FIELDS.items():
   ok=present(getter(r))
   if ok: counts[f]+=1; pub_counts[pub][f]+=1
   elif f in ESSENTIAL: missing.append(f)
  useful=sum(present(FIELDS[f](r)) for f in USEFUL)
  if missing or useful < 3:
   if len(incomplete)<100:
    incomplete.append({'id':r.get('id'),'publisher':pub,'series':r.get('catalogHeader') or r.get('series'),'issue':r.get('issueNr') or r.get('issue'),'missingEssential':missing,'usefulFieldsPresent':useful})
 coverage={f:{'present':counts[f],'missing':total-counts[f],'percent':pct(counts[f],total)} for f in FIELDS}
 publishers=[]
 for pub,n in pub_total.most_common():
  c=pub_counts[pub]
  score=sum(c[f] for f in ESSENTIAL+USEFUL)/(n*len(ESSENTIAL+USEFUL))*100 if n else 0
  publishers.append({'publisher':pub,'records':n,'qualityScore':round(score,2),'coverPercent':pct(c['coverUrl'],n),'datePercent':pct(c['publicationDate'],n),'pagesPercent':pct(c['pages'],n),'pricePercent':pct(c['price'],n),'formatPercent':pct(c['format'],n),'languagePercent':pct(c['language'],n)})
 essential_complete=sum(all(present(FIELDS[f](r)) for f in ESSENTIAL) for r in rows)
 report={'records':total,'essentialDefinition':list(ESSENTIAL),'usefulDefinition':list(USEFUL),'essentialComplete':essential_complete,'essentialCompletePercent':pct(essential_complete,total),'fieldCoverage':coverage,'publishers':publishers,'incompleteSamples':incomplete}
 OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'records':total,'essentialCompletePercent':report['essentialCompletePercent'],'coverPercent':coverage['coverUrl']['percent'],'output':str(OUT)},ensure_ascii=False))
if __name__=='__main__': main()
