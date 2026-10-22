#!/usr/bin/env python3
import json,re,time,html as htmlmod,unicodedata
from pathlib import Path
from urllib.parse import quote_plus,urljoin,urlparse,parse_qs,unquote
from io import BytesIO
import requests
from bs4 import BeautifulSoup
from PIL import Image

ROOT=Path(__file__).resolve().parent
REQ=ROOT/'bridge'/'requests';RES=ROOT/'bridge'/'results';CACHE=ROOT/'bridge'/'cache';COVERS=ROOT/'bridge'/'covers'
for p in (REQ,RES,CACHE,COVERS):p.mkdir(parents=True,exist_ok=True)
OWNER='ramsesluque-ai';REPO='mi-comicoteca';BRANCH='bridge-data'
S=requests.Session();S.headers.update({'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA-TEBEOSFERA/1.0','Accept-Language':'es-ES,es;q=0.9'})

def norm(v):
 s=unicodedata.normalize('NFD',str(v or ''));return re.sub(r'\s+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower()).strip()
def digits(v):return re.sub(r'[^0-9Xx]','',str(v or '')).upper()
def issue(v):
 s=norm(v).replace('º','').replace('°','').replace(' ','')
 return str(int(s)) if re.fullmatch(r'0*\d+',s) else s.lstrip('0')
def clean(u,base=''):
 u=htmlmod.unescape(str(u or '')).strip()
 if u.startswith('//'):u='https:'+u
 if base:u=urljoin(base,u)
 return u if u.startswith(('http://','https://')) else ''
def get(u,timeout=25,headers=None):
 try:return S.get(u,timeout=timeout,allow_redirects=True,headers=headers or {})
 except:return None

def canonical_series(v):
 s=norm(v)
 s=re.sub(r'\b(el\s+)?hombre\s+murcielago\b','batman',s)
 s=re.sub(r'\bbatman\s+el\s+batman\b','batman',s)
 s=re.sub(r'\b(el\s+)?hombre\s+arana\b','spiderman',s)
 s=re.sub(r'\bspider[-\s]?man\b','spiderman',s)
 s=re.sub(r'\bsuper[-\s]?man\b','superman',s)
 s=re.sub(r'\bserie\s+(aguila|avestruz|colibri)\b',' ',s)
 s=re.sub(r'\b(formato\s+)?(aguila|avestruz|colibri)\b',' ',s)
 s=re.sub(r'\bnovaro\b|\bediciones?\b|\beditorial\b',' ',s)
 return re.sub(r'[^a-z0-9]+',' ',s).strip()
def series_score(a,b):
 A=set(x for x in canonical_series(a).split() if len(x)>1);B=set(x for x in canonical_series(b).split() if len(x)>1)
 if not A or not B:return 0
 inter=len(A&B);return max(inter/len(A),inter/len(B))
def variants(series,stage=''):
 vals=[]
 def add(x):
  x=' '.join(str(x or '').split())
  if x and norm(x) not in [norm(v) for v in vals]:vals.append(x)
 add(series)
 c=canonical_series(series)
 if c=='batman':
  add('Batman');add('Batman el Hombre Murciélago')
 elif c=='spiderman':
  add('Spider-Man');add('Spiderman');add('El Hombre Araña')
 elif c=='superman':
  add('Superman');add('Supermán')
 if stage:
  for v in list(vals):add(v+' '+stage)
 return vals[:8]

def search_links(q):
 out=[]
 for base,sel in [('https://www.bing.com/search?q=','li.b_algo h2 a'),('https://html.duckduckgo.com/html/?q=','a.result__a')]:
  r=get(base+quote_plus(q),20,{'Accept':'text/html'})
  if not r or r.status_code not in (200,202):continue
  s=BeautifulSoup(r.text,'html.parser')
  for a in s.select(sel):
   u=a.get('href') or ''
   if 'uddg=' in u:
    try:u=unquote(parse_qs(urlparse(u).query).get('uddg',[''])[0])
    except:pass
   u=clean(u)
   if u and 'tebeosfera.com' in urlparse(u).netloc.lower() and u not in out:out.append(u)
   if len(out)>=24:return out
 return out

def extract_isbn(text):
 for p in [r'(?:ISBN(?:-13)?|EAN)\s*[:\-]?\s*((?:97[89][\s\-]?)?\d[\d\s\-]{8,18}[\dXx])',r'\b(97[89][\d\s\-]{10,16}\d)\b']:
  m=re.search(p,text or '',re.I)
  if m:
   d=digits(m.group(1))
   if len(d) in (10,13):return d
 return ''
def issue_hit(text,wanted):
 w=issue(wanted)
 if not w:return True
 pats=[rf'(?:núm(?:ero)?|num(?:ero)?|n[º°o]\.?|#)\s*0*{re.escape(w)}(?!\d)',rf'[-_/\s]0*{re.escape(w)}(?:[-_/\s\).,:]|$)']
 return any(re.search(p,text or '',re.I) for p in pats)
def stage_hit(text,stage):
 if not stage:return True
 sn=norm(stage)
 toks=[x for x in ('aguila','avestruz','colibri','librocomic') if x in sn]
 return not toks or any(x in norm(text) for x in toks)

def candidate(url,q):
 r=get(url)
 if not r or r.status_code!=200:return None
 s=BeautifulSoup(r.text,'html.parser');text=s.get_text(' ',strip=True)
 title='';m=s.find('meta',attrs={'property':'og:title'})
 if m:title=(m.get('content') or '').strip()
 if not title:title=s.title.get_text(' ',strip=True) if s.title else ''
 blob=title+' '+text[:20000]
 qi=digits(q.get('isbn'));found_isbn=extract_isbn(text)
 if qi and found_isbn and qi!=found_isbn:return None
 isbn_exact=bool(qi and found_isbn==qi)
 if not isbn_exact:
  if not issue_hit(blob,q.get('issue')):return None
  if q.get('series') and series_score(q.get('series'),blob)<0.45:return None
  pub=norm(q.get('publisher'))
  if pub and pub not in norm(blob):return None
  if not stage_hit(blob,q.get('stage')):return None
 img='';m=s.find('meta',attrs={'property':'og:image'})
 if m:img=clean(m.get('content'),url)
 if not img:
  best=[]
  for im in s.find_all('img'):
   src=clean(im.get('data-src') or im.get('data-original') or im.get('data-lazy') or im.get('src') or '',url)
   if not src:continue
   hint=norm(' '.join([im.get('alt') or '',im.get('title') or '',src]))
   score=(5 if any(x in hint for x in ('portada','cover','cubierta')) else 0)+(3 if canonical_series(q.get('series')) in canonical_series(hint) else 0)-(10 if 'logo' in hint else 0)
   best.append((score,src))
  if best:img=max(best,key=lambda x:x[0])[1]
 if not img:return None
 return {'source':'Tebeosfera · principal','score':30000+(5000 if isbn_exact else 0),'data':{'title':title or q.get('series',''),'publisher':q.get('publisher',''),'publicationDate':'','pages':'','isbn':found_isbn or qi,'series':q.get('series',''),'issueNr':str(q.get('issue') or ''),'volume':str(q.get('volume') or ''),'stage':str(q.get('stage') or ''),'startYear':str(q.get('startYear') or ''),'sourceId':str(q.get('sourceId') or ''),'coverUrl':img,'sourceUrl':url}}

def save_cover(url,key):
 r=get(url,30,{'Referer':'https://www.tebeosfera.com/'})
 if not r or r.status_code!=200 or not r.content:return ''
 try:
  im=Image.open(BytesIO(r.content)).convert('RGB');im.thumbnail((900,1350),Image.LANCZOS)
  name=f'{key}-tebeosfera.webp';im.save(COVERS/name,'WEBP',quality=86,method=6)
  return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
 except Exception:return ''

def process(path):
 q=json.loads(path.read_text(encoding='utf-8'));rid=str(q.get('requestId') or path.stem);key=str(q.get('cacheKey') or rid)
 res=RES/f'{rid}.json'
 if res.exists():
  try:
   old=json.loads(res.read_text(encoding='utf-8'))
   if old.get('ok') and any('tebeosfera' in norm(c.get('source')) for c in old.get('candidates') or []):return
  except:pass
 urls=[];isbn=digits(q.get('isbn'));ser=q.get('series','');stage=q.get('stage','');pub=q.get('publisher','');num=issue(q.get('issue'))
 queries=[]
 if isbn:queries.append(f'site:tebeosfera.com "{isbn}"')
 for v in variants(ser,stage):
  queries.append(f'site:tebeosfera.com "{v}" "{num}" "{pub}"')
  if stage:queries.append(f'site:tebeosfera.com "{v}" "{stage}" "{num}"')
 for query in queries:
  for u in search_links(query):
   if u not in urls:urls.append(u)
 cand=None
 for u in urls[:30]:
  cand=candidate(u,q)
  if cand:break
 if not cand:return
 saved=save_cover(cand['data']['coverUrl'],key)
 if not saved:return
 cand['data']['originalCoverUrl']=cand['data']['coverUrl'];cand['data']['coverUrl']=saved;cand['data']['coverUrls']=[saved]
 payload={'ok':True,'authority':'Tebeosfera','requestId':rid,'cacheKey':key,'query':q,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'candidates':[cand]}
 res.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8');(CACHE/f'{key}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
 print('TEBEOSFERA_AUTHORITY_OK',rid,cand['data']['sourceUrl'])

def main():
 files=sorted(REQ.glob('*.json'),key=lambda p:p.stat().st_mtime)
 for p in files[-20:]:
  try:process(p)
  except Exception as e:print('TEBEOSFERA_AUTHORITY_ERROR',p,repr(e))
if __name__=='__main__':main()
