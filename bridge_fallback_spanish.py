#!/usr/bin/env python3
import json,re,html as htmlmod
from pathlib import Path
from urllib.parse import quote_plus,urljoin,urlparse,parse_qs,unquote
from io import BytesIO
import requests
from bs4 import BeautifulSoup
from PIL import Image

ROOT=Path(__file__).resolve().parent
REQ=ROOT/'bridge'/'requests'; RES=ROOT/'bridge'/'results'; CACHE=ROOT/'bridge'/'cache'; COVERS=ROOT/'bridge'/'covers'
for p in (REQ,RES,CACHE,COVERS): p.mkdir(parents=True,exist_ok=True)
OWNER='ramsesluque-ai'; REPO='mi-comicoteca'; BRANCH='bridge-data'
DOMAINS=['tienda.dreamers.es','librotea.eldiario.es','fnac.es','iberlibro.com']
S=requests.Session();S.headers.update({'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA/2.1','Accept-Language':'es-ES,es;q=0.9'})

def digits(s):return re.sub(r'[^0-9Xx]','',str(s or '')).upper()
def norm(s):
 import unicodedata
 s=unicodedata.normalize('NFD',str(s or ''));return ''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
def clean(u,base=''):
 u=htmlmod.unescape(str(u or '')).strip()
 if u.startswith('//'):u='https:'+u
 if base:u=urljoin(base,u)
 return u if u.startswith(('http://','https://')) else ''
def get(u,timeout=25):
 try:return S.get(u,timeout=timeout,allow_redirects=True)
 except:return None
def search(q):
 out=[]
 for base,selector in [('https://www.bing.com/search?q=','li.b_algo h2 a'),('https://html.duckduckgo.com/html/?q=','a.result__a')]:
  r=get(base+quote_plus(q))
  if not r or r.status_code not in (200,202):continue
  s=BeautifulSoup(r.text,'html.parser')
  for a in s.select(selector):
   u=a.get('href') or ''
   if 'uddg=' in u:
    try:u=unquote(parse_qs(urlparse(u).query).get('uddg',[''])[0])
    except:pass
   u=clean(u)
   if u and any(d in urlparse(u).netloc.lower() for d in DOMAINS) and u not in out:out.append(u)
 return out[:20]
def page_candidate(url,q):
 r=get(url)
 if not r or r.status_code!=200:return None
 s=BeautifulSoup(r.text,'html.parser'); text=s.get_text(' ',strip=True); qi=digits(q.get('isbn'))
 if qi and qi not in digits(text):return None
 title=(s.find('meta',attrs={'property':'og:title'}) or {}).get('content','') if s else ''
 if not title:title=s.title.get_text(' ',strip=True) if s.title else ''
 issue=str(q.get('issue') or '')
 if issue and not re.search(r'(?:#|n[úu]m\.?|batman\s*)\s*0*'+re.escape(issue)+r'(?!\d)',norm(title+' '+text[:5000]),re.I):
  if qi not in digits(text):return None
 img=''
 m=s.find('meta',attrs={'property':'og:image'})
 if m:img=clean(m.get('content'),url)
 if not img:
  best=[]
  for im in s.find_all('img'):
   src=clean(im.get('data-src') or im.get('src') or '',url); hint=norm(' '.join([im.get('alt') or '',im.get('title') or '',src]))
   if not src:continue
   score=(5 if 'portada' in hint or 'cover' in hint else 0)+(4 if 'all-star' in hint else 0)-(8 if 'logo' in hint else 0)
   best.append((score,src))
  if best:img=max(best,key=lambda x:x[0])[1]
 if not img:return None
 return {'source':'Fuente española · respaldo','score':15000,'data':{'title':title or q.get('series',''),'publisher':q.get('publisher',''),'publicationDate':'','pages':'','isbn':qi,'series':q.get('series',''),'issueNr':issue,'coverUrl':img,'sourceUrl':url}}
def save_cover(url,key):
 r=get(url,30)
 if not r or r.status_code!=200 or not r.content:return ''
 try:
  im=Image.open(BytesIO(r.content)).convert('RGB');im.thumbnail((900,1350),Image.LANCZOS)
  name=f'{key}-fallback.webp';im.save(COVERS/name,'WEBP',quality=86,method=6)
  return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
 except:return ''
def main():
 for rp in sorted(REQ.glob('*.json')):
  q=json.loads(rp.read_text(encoding='utf-8'));rid=str(q.get('requestId') or rp.stem);res=RES/f'{rid}.json'
  if res.exists():
   try:
    old=json.loads(res.read_text(encoding='utf-8'))
    if old.get('ok') and old.get('candidates'):continue
   except:old={}
  isbn=digits(q.get('isbn'))
  if not isbn:continue
  urls=search(f'"{isbn}" "{q.get("series","")}" comic portada')+search(f'"{isbn}"')
  cand=None
  for u in dict.fromkeys(urls):
   cand=page_candidate(u,q)
   if cand:break
  if not cand:continue
  key=str(q.get('cacheKey') or rid);saved=save_cover(cand['data']['coverUrl'],key)
  if not saved:continue
  cand['data']['originalCoverUrl']=cand['data']['coverUrl'];cand['data']['coverUrl']=saved;cand['data']['coverUrls']=[saved]
  payload={'ok':True,'requestId':rid,'cacheKey':key,'query':q,'candidates':[cand]}
  res.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8');(CACHE/f'{key}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
  print('FALLBACK_OK',rid,cand['data']['sourceUrl'])
if __name__=='__main__':main()
