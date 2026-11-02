#!/usr/bin/env python3
"""Audita colisiones del Maestro contra la UNIQUE legacy de master_series.

Solo lectura sobre master-data. No conecta ni modifica Supabase.
Compara:
  identidad canónica: publisher + header + volume + stage + startYear
  identidad legacy:   publisher + header + volume_stage + startYear

`volume_stage` se toma del registro si existe; en su ausencia se usa la
representación histórica disponible (`volumeStage`). Si tampoco existe, queda
vacío, que es deliberadamente conservador: cualquier colisión resultante debe
revisarse antes de retirar o conservar el constraint legacy.
"""
import json, re, unicodedata
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PUBDIR=ROOT/'master-data'/'publishers'
OUT=ROOT/'master-data'/'legacy-constraint-audit.json'

def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'\s+',' ',s).strip()

def canonical(r):
    return (norm(r.get('publisher')), norm(r.get('catalogHeader') or r.get('series')),
            norm(r.get('volume')), norm(r.get('stage')), str(r.get('startYear') or '').strip())

def legacy(r):
    return (norm(r.get('publisher')), norm(r.get('catalogHeader') or r.get('series')),
            norm(r.get('volume_stage') or r.get('volumeStage')), str(r.get('startYear') or '').strip())

def main():
    rows=[]
    for p in sorted(PUBDIR.glob('*.json')):
        d=json.loads(p.read_text(encoding='utf-8'))
        if isinstance(d,list): rows.extend(x for x in d if isinstance(x,dict))
    legacy_to_canonical=defaultdict(set)
    for r in rows:
        legacy_to_canonical[legacy(r)].add(canonical(r))
    collisions=[]
    for lk, identities in legacy_to_canonical.items():
        if len(identities)>1:
            collisions.append({
                'legacyIdentity': lk,
                'canonicalIdentityCount': len(identities),
                'canonicalIdentities': sorted(identities),
            })
    collisions.sort(key=lambda x:(-x['canonicalIdentityCount'], x['legacyIdentity']))
    audit={
        'rows':len(rows),
        'legacyIdentities':len(legacy_to_canonical),
        'legacyCollisions':len(collisions),
        'canonicalIdentitiesAffected':sum(x['canonicalIdentityCount'] for x in collisions),
        'samples':collisions[:250],
        'note':'Auditoría local/no destructiva; revisar colisiones antes de modificar constraints de Supabase.'
    }
    OUT.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:audit[k] for k in ('rows','legacyIdentities','legacyCollisions','canonicalIdentitiesAffected')},ensure_ascii=False))

if __name__=='__main__': main()
