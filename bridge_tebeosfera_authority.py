#!/usr/bin/env python3
import json,re,time
from pathlib import Path
from io import BytesIO
import requests
from PIL import Image
from master_cover_backfill_direct import tebeosfera_isbn, norm, code

ROOT=Path(__file__).resolve().parent
REQ=ROOT/'bridge'/'requests';RES=ROOT/'bridge'/'results';CACHE=ROOT/'bridge'/'cache';COVERS=ROOT/'bridge'/'covers'
for p in (REQ,RES,CACHE,COVERS):p.mkdir(parents=True,exist_ok=True)
OWNER='ramsesluque-ai';REPO='mi-comicoteca';BRANCH='bridge-data'
S=requests.Session();S.headers.update({'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA-TEBEOSFERA-DIRECT/2.0','Accept-Language':'es-ES,es;q=0.9','Referer':'https://www.tebeosfera.com/'})

def safe_key(v):return re.sub(r'[^A-Za-z0-9_.-]+','-',str(v or ''))[:170] or 'cover'
def save_cover(url,key):
    try:r=S.get(url,timeout=30,allow_redirects=True)
    except Exception:return ''
    if not r.ok or not r.content:return ''
    try:
        im=Image.open(BytesIO(r.content)).convert('RGB');im.thumbnail((900,1350),Image.LANCZOS)
        name=f'{safe_key(key)}-tebeosfera.webp';im.save(COVERS/name,'WEBP',quality=86,method=6)
        return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
    except Exception:return ''

def direct_candidate(q):
    isbn=code(q.get('isbn') or '')
    if len(isbn) not in (10,13):return None
    hit=tebeosfera_isbn(isbn)
    if not hit:return None
    img,source,source_url,extra=hit
    return {'source':'Tebeosfera · principal','score':40000,'data':{
        'title':extra.get('tebeosferaTitle') or q.get('series',''),
        'publisher':q.get('publisher',''),'publicationDate':'','pages':'','isbn':isbn,
        'series':q.get('series',''),'issueNr':str(q.get('issue') or ''),'volume':str(q.get('volume') or ''),
        'stage':str(q.get('stage') or ''),'startYear':str(q.get('startYear') or ''),'sourceId':str(q.get('sourceId') or ''),
        'coverUrl':img,'sourceUrl':source_url,'authority':'Tebeosfera','match':'ISBN exacto'
    }}

def process(path):
    q=json.loads(path.read_text(encoding='utf-8'));rid=str(q.get('requestId') or path.stem);key=str(q.get('cacheKey') or rid)
    res=RES/f'{rid}.json'
    # Si ya existe una respuesta Tebeosfera válida, no repetirla.
    if res.exists():
        try:
            old=json.loads(res.read_text(encoding='utf-8'))
            if old.get('ok') and any('tebeosfera' in norm(c.get('source')) for c in old.get('candidates') or []):return
        except Exception:pass
    cand=direct_candidate(q)
    if not cand:return
    raw=cand['data']['coverUrl'];saved=save_cover(raw,key)
    if not saved:return
    cand['data']['originalCoverUrl']=raw;cand['data']['coverUrl']=saved;cand['data']['coverUrls']=[saved]
    payload={'ok':True,'authority':'Tebeosfera','requestId':rid,'cacheKey':key,'query':q,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'candidates':[cand]}
    res.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    (CACHE/f'{key}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print('TEBEOSFERA_DIRECT_OK',rid,cand['data']['sourceUrl'])

def main():
    files=sorted(REQ.glob('*.json'),key=lambda p:p.stat().st_mtime)
    for p in files[-30:]:
        try:process(p)
        except Exception as e:print('TEBEOSFERA_DIRECT_ERROR',p,repr(e))
if __name__=='__main__':main()
