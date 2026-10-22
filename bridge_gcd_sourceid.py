#!/usr/bin/env python3
import json,re
from pathlib import Path
from io import BytesIO
import requests
from PIL import Image

ROOT=Path(__file__).resolve().parent
REQ=ROOT/'bridge'/'requests'; RES=ROOT/'bridge'/'results'; CACHE=ROOT/'bridge'/'cache'; COVERS=ROOT/'bridge'/'covers'
for p in (REQ,RES,CACHE,COVERS): p.mkdir(parents=True,exist_ok=True)
OWNER='ramsesluque-ai';REPO='mi-comicoteca';BRANCH='bridge-data'
BASE='https://www.comics.org'
S=requests.Session();S.headers.update({'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA-GCD/1.0','Accept-Language':'es-ES,es;q=0.9','Referer':'https://www.comics.org/'})

def code(v):return re.sub(r'[^0-9Xx]','',str(v or '')).upper()
def get(url,timeout=25,accept=None):
 h={'Referer':'https://www.comics.org/'}
 if accept:h['Accept']=accept
 try:return S.get(url,headers=h,timeout=timeout,allow_redirects=True)
 except Exception as e:print('GCD_GET_ERROR',url,repr(e));return None
def image_url(d):
 cv=d.get('cover') if isinstance(d,dict) else None
 urls=[]
 if isinstance(cv,str):urls.append(cv)
 elif isinstance(cv,dict):
  for k in ('image','image_url','file','url','large','medium','thumbnail','api_url'):
   v=cv.get(k)
   if isinstance(v,str):urls.append(v)
 for k in ('cover_url','image','image_url'):
  v=d.get(k) if isinstance(d,dict) else None
  if isinstance(v,str):urls.append(v)
 for u in list(urls):
  if '/api/' in u:
   r=get(u+('&' if '?' in u else '?')+'format=json',accept='application/json')
   if r and r.status_code==200:
    try:j=r.json()
    except:j={}
    for k in ('image','image_url','file','url','large','medium','thumbnail'):
     v=j.get(k) if isinstance(j,dict) else None
     if isinstance(v,str) and v.startswith('http'):urls.insert(0,v)
 for u in urls:
  if isinstance(u,str) and u.startswith('http') and '/api/' not in u:return u
 return ''
def save_image(url,key):
 r=get(url,30,accept='image/avif,image/webp,image/apng,image/*,*/*;q=0.8')
 if not r or r.status_code!=200 or not r.content:
  print('GCD_IMAGE_FAIL',getattr(r,'status_code',None),url);return ''
 try:
  im=Image.open(BytesIO(r.content)).convert('RGB');im.thumbnail((900,1350),Image.LANCZOS)
  name=re.sub(r'[^a-zA-Z0-9_.-]','_',key)[:150]+'-gcd.webp';im.save(COVERS/name,'WEBP',quality=86,method=6)
  return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
 except Exception as e:print('GCD_IMAGE_DECODE',repr(e),url);return ''
def main():
 for rp in sorted(REQ.glob('*.json')):
  try:q=json.loads(rp.read_text(encoding='utf-8'))
  except:continue
  sid=str(q.get('sourceId') or '').strip();rid=str(q.get('requestId') or rp.stem);key=str(q.get('cacheKey') or rid);res=RES/f'{rid}.json'
  if not sid.isdigit():continue
  if res.exists():
   try:
    old=json.loads(res.read_text(encoding='utf-8'))
    if old.get('ok') and old.get('candidates'):continue
   except:pass
  api=f'{BASE}/api/issue/{sid}/?format=json';r=get(api,accept='application/json')
  if not r or r.status_code!=200:
   print('GCD_ISSUE_FAIL',sid,getattr(r,'status_code',None));continue
  try:d=r.json()
  except Exception as e:print('GCD_JSON_FAIL',sid,repr(e));continue
  cover=image_url(d)
  if not cover:
   print('GCD_NO_COVER',sid);continue
  stored=save_image(cover,key)
  if not stored:continue
  ser=d.get('series_name') or ((d.get('series') or {}).get('name') if isinstance(d.get('series'),dict) else '') or q.get('series','')
  issue=str(d.get('number') or d.get('issue_number') or q.get('issue') or '')
  isbn=code(d.get('isbn') or d.get('barcode') or q.get('isbn') or '')
  cand={'source':'Grand Comics Database · sourceId exacto','score':20000,'data':{
   'title':d.get('title') or d.get('descriptor') or ser,'publisher':q.get('publisher',''),'publicationDate':d.get('publication_date') or d.get('key_date') or '',
   'pages':d.get('page_count') or '','isbn':isbn,'series':ser,'issueNr':issue,'coverUrl':stored,'coverUrls':[stored],
   'originalCoverUrl':cover,'sourceUrl':f'{BASE}/issue/{sid}/'}}
  payload={'ok':True,'requestId':rid,'cacheKey':key,'query':q,'generatedAt':__import__('datetime').datetime.utcnow().isoformat()+'Z','candidates':[cand]}
  res.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8');(CACHE/f'{key}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
  print('GCD_SOURCEID_OK',sid,ser,issue,stored)
if __name__=='__main__':main()
