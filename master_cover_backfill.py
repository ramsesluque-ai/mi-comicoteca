#!/usr/bin/env python3
import argparse,json,re,time,unicodedata
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from urllib.parse import quote_plus,urljoin,urlparse,parse_qs,unquote
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parent
OVERLAY=ROOT/'bridge'/'cache'/'master-cover-overrides.json'
STATE=ROOT/'bridge'/'cache'/'master-cover-backfill-state.json'
HEADERS={'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA-MASTER/3.0','Accept-Language':'es-ES,es;q=0.9'}
S=requests.Session();S.headers.update(HEADERS)
PRIORITY=['novaro','vertice','bruguera','zinco','forum','planeta','panini','ecc','salvat','norma','glenat','toutain','toray','maga','ferma','hispano americana']

def code(v):return re.sub(r'[^0-9Xx]','',str(v or '')).upper()
def norm(v):
 s=unicodedata.normalize('NFD',str(v or ''));return re.sub(r'\s+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower()).strip()
def issue(v):
 s=norm(v).replace('º','').replace('°','').replace(' ','')
 if re.fullmatch(r'0*\d+',s):return str(int(s))
 return re.sub(r'^0+(?=\d)','',s)
def get(url,timeout=12,headers=None):
 try:return S.get(url,timeout=timeout,allow_redirects=True,headers=headers or {})
 except Exception:return None

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
 A={x for x in canonical_series(a).split() if len(x)>1};B={x for x in canonical_series(b).split() if len(x)>1}
 if not A or not B:return 0
 i=len(A&B);return max(i/len(A),i/len(B))
def stage_tokens(v):return [x for x in ('aguila','avestruz','colibri','librocomic') if x in norm(v)]
def composite_key(r,blank_volume=False):
 return '@:'+'|'.join([norm(r.get('publisher')),norm(r.get('catalogHeader') or r.get('series')),'' if blank_volume else norm(r.get('volume')),norm(r.get('stage')),str(r.get('startYear') or '').strip(),issue(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue'))])

def search_links(q,domains=None,limit=8):
 out=[]
 for base,selector in [('https://www.bing.com/search?q=','li.b_algo h2 a, h2 a'),('https://html.duckduckgo.com/html/?q=','a.result__a, a.result-link')]:
  r=get(base+quote_plus(q),12,{'Accept':'text/html'})
  if not r or r.status_code not in (200,202):continue
  s=BeautifulSoup(r.text,'html.parser')
  for a in s.select(selector):
   u=a.get('href') or ''
   if 'uddg=' in u:
    try:u=unquote(parse_qs(urlparse(u).query).get('uddg',[''])[0])
    except:pass
   if not u.startswith(('http://','https://')):continue
   host=urlparse(u).netloc.lower()
   if domains and not any(d in host for d in domains):continue
   if u not in out:out.append(u)
   if len(out)>=limit:return out
 return out

def image_from_page(s,base):
 m=s.find('meta',attrs={'property':'og:image'});img=(m.get('content') or '').strip() if m else ''
 if img:return urljoin(base,img).replace('http:','https:')
 best=[]
 for im in s.find_all('img'):
  src=im.get('data-src') or im.get('data-original') or im.get('data-lazy') or im.get('src') or ''
  src=urljoin(base,src);hint=norm(' '.join([im.get('alt') or '',im.get('title') or '',src]))
  if not src.startswith(('http://','https://')):continue
  score=(6 if any(x in hint for x in ('portada','cover','cubierta')) else 0)-(10 if 'logo' in hint else 0)
  best.append((score,src))
 return max(best,key=lambda z:z[0])[1].replace('http:','https:') if best else ''

def tebeosfera_isbn(isbn):
 for u in search_links(f'site:tebeosfera.com "{isbn}"',['tebeosfera.com'],10):
  r=get(u,15)
  if not r or r.status_code!=200:continue
  s=BeautifulSoup(r.text,'html.parser');txt=code(s.get_text(' ',strip=True))
  if isbn not in txt:continue
  img=image_from_page(s,r.url)
  if img:return img,'Tebeosfera',r.url,{}
 return None

def tebeosfera_identity(r):
 pub=str(r.get('publisher') or '').strip();series=str(r.get('catalogHeader') or r.get('series') or '').strip();num=issue(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue'));stage=str(r.get('stage') or '').strip();year=str(r.get('startYear') or '').strip()
 if not pub or not series or not num:return None
 variants=[series]
 cs=canonical_series(series)
 if cs=='batman':variants+=['Batman','Batman el Hombre Murciélago']
 elif cs=='spiderman':variants+=['Spider-Man','Spiderman','El Hombre Araña']
 elif cs=='superman':variants+=['Superman','Supermán']
 qs=[]
 for v in dict.fromkeys(variants):
  qs.append(f'site:tebeosfera.com "{v}" "{num}" "{pub}"')
  if stage:qs.append(f'site:tebeosfera.com "{v}" "{stage}" "{num}"')
 urls=[]
 for q in qs:
  for u in search_links(q,['tebeosfera.com'],10):
   if u not in urls:urls.append(u)
 for u in urls[:20]:
  rr=get(u,15)
  if not rr or rr.status_code!=200:continue
  s=BeautifulSoup(rr.text,'html.parser');text=s.get_text(' ',strip=True);blob=norm((s.title.get_text(' ',strip=True) if s.title else '')+' '+text[:20000])
  # Debe coincidir la cabecera de forma fuerte.
  if series_score(series,blob)<0.55:continue
  # Debe aparecer el número de forma contextual, no como un año o precio cualquiera.
  pats=[rf'(?:núm(?:ero)?|num(?:ero)?|n[º°o]\.?|#)\s*0*{re.escape(num)}(?!\d)',rf'[-_/\s]0*{re.escape(num)}(?:[-_/\s\).,:]|$)']
  if not any(re.search(p,blob,re.I) for p in pats):continue
  if norm(pub) not in blob:continue
  st=stage_tokens(stage)
  if st and not any(x in blob for x in st):continue
  # El año solo se exige si el Maestro lo conoce y la página menciona un año de inicio/edición distinto de forma inequívoca.
  if year and re.search(r'\b(19|20)\d{2}\b',blob):
   years=set(re.findall(r'\b(?:19|20)\d{2}\b',blob))
   if len(years)==1 and year not in years:continue
  img=image_from_page(s,rr.url)
  if not img:continue
  title=(s.find('meta',attrs={'property':'og:title'}) or {}).get('content','') if s else ''
  if not title:title=s.title.get_text(' ',strip=True) if s.title else ''
  meta={'tebeosferaTitle':title,'authority':'Tebeosfera'}
  return img,'Tebeosfera',rr.url,meta
 return None

def openlibrary(isbn):
 key='ISBN:'+isbn;r=get('https://openlibrary.org/api/books?bibkeys='+quote_plus(key)+'&format=json&jscmd=data',10)
 if not r or r.status_code!=200:return None
 try:b=r.json().get(key) or {}
 except:return None
 c=b.get('cover') or {};u=c.get('large') or c.get('medium') or c.get('small')
 return (u.replace('http:','https:'), 'OpenLibrary',u,{}) if u else None

def googlebooks(isbn):
 r=get('https://www.googleapis.com/books/v1/volumes?q='+quote_plus('isbn:'+isbn)+'&maxResults=5',10)
 if not r or r.status_code!=200:return None
 try:items=r.json().get('items') or []
 except:return None
 for it in items:
  v=it.get('volumeInfo') or {};ids=v.get('industryIdentifiers') or []
  if not any(code(x.get('identifier'))==isbn for x in ids):continue
  im=v.get('imageLinks') or {};u=im.get('extraLarge') or im.get('large') or im.get('medium') or im.get('small') or im.get('thumbnail')
  if u:return u.replace('http:','https:'),'Google Books',u,{}
 return None

def milcomics(isbn):
 r=get('https://www.milcomics.com/busqueda?controller=search&s='+quote_plus(isbn),12)
 if not r or r.status_code!=200:return None
 s=BeautifulSoup(r.text,'html.parser');links=[]
 for sel in ['article.product-miniature a[href]','.product-miniature a[href]','.product-title a[href]','h2 a[href]','h3 a[href]']:
  for a in s.select(sel):
   u=urljoin(r.url,a.get('href') or '')
   if 'milcomics.com' in u and u not in links:links.append(u)
   if len(links)>=4:break
  if links:break
 for u in links[:4]:
  rr=get(u,12)
  if not rr or rr.status_code!=200:continue
  ss=BeautifulSoup(rr.text,'html.parser');txt=code(ss.get_text(' ',strip=True))
  if isbn not in txt:continue
  img=image_from_page(ss,u)
  if img:return img,'MilComics',u,{}
 return None

def cover_for(r):
 isbn=code(r.get('isbn') or r.get('barcode'))
 if len(isbn) in (10,13):
  hit=tebeosfera_isbn(isbn)
  if hit:return hit
  for fn in (openlibrary,googlebooks,milcomics):
   hit=fn(isbn)
   if hit:return hit
  return None
 return tebeosfera_identity(r)

def row_meta(r,url,source,source_url,extra=None):
 isbn=code(r.get('isbn') or r.get('barcode'))
 d={'isbn':isbn,'sourceId':str(r.get('sourceId') or ''),'title':r.get('title') or '', 'publisher':r.get('publisher') or '', 'series':r.get('catalogHeader') or r.get('series') or '', 'volume':r.get('volume') or '', 'stage':r.get('stage') or '', 'startYear':str(r.get('startYear') or ''), 'issueNr':str(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue') or ''), 'publicationDate':r.get('publicationDate') or '', 'pages':r.get('pages') or '', 'coverUrl':url, 'sourceUrl':source_url or url, 'source':'Backfill · '+source, '_score':30000 if source=='Tebeosfera' else 12000}
 if extra:d.update(extra)
 return d
def load_json(path,default):
 try:return json.loads(path.read_text(encoding='utf-8'))
 except:return default

def already_tebeosfera(r,overlay):
 keys=[];isbn=code(r.get('isbn') or r.get('barcode'))
 if len(isbn) in (10,13):keys.append(isbn)
 sid=str(r.get('sourceId') or '').strip()
 if sid:keys.append('gcd:'+sid)
 keys+=[composite_key(r),composite_key(r,True)]
 return any(k and overlay.get(k,{}).get('coverUrl') and 'tebeosfera' in norm(overlay.get(k,{}).get('source')) for k in keys)

def store_overlay(r,meta,overlay):
 keys=[];isbn=code(r.get('isbn') or r.get('barcode'))
 if len(isbn) in (10,13):keys.append(isbn)
 sid=str(r.get('sourceId') or '').strip()
 if sid:keys.append('gcd:'+sid)
 for k in (composite_key(r),composite_key(r,True)):
  if k and k not in keys:keys.append(k)
 for k in keys:
  old=overlay.get(k) or {}
  if old and 'tebeosfera' in norm(old.get('source')) and 'tebeosfera' not in norm(meta.get('source')):continue
  if old and 'tebeosfera' not in norm(meta.get('source')) and int(old.get('_score') or 0)>int(meta.get('_score') or 0):continue
  overlay[k]=dict(meta)

def priority_files(files):
 def rank(p):
  n=norm(p.name)
  for i,x in enumerate(PRIORITY):
   if n.startswith(x.replace(' ','-')) or x in n:return (0,i,n)
  return (1,999,n)
 return sorted(files,key=rank)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--batch',type=int,default=80);ap.add_argument('--workers',type=int,default=5);a=ap.parse_args()
 files=priority_files(list(Path(a.master).glob('*.json')));OVERLAY.parent.mkdir(parents=True,exist_ok=True)
 overlay=load_json(OVERLAY,{});state=load_json(STATE,{'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0})
 fi=int(state.get('fileIndex') or 0);ri=int(state.get('rowIndex') or 0);scanned_this=0;max_scan=max(a.batch*120,8000);targets=[];seen=set()
 while len(targets)<a.batch and files and scanned_this<max_scan:
  if fi>=len(files):fi=0;ri=0;state['passes']=int(state.get('passes') or 0)+1
  rows=load_json(files[fi],[])
  if not isinstance(rows,list):rows=[]
  if ri>=len(rows):fi+=1;ri=0;continue
  r=rows[ri];ri+=1;scanned_this+=1;state['scanned']=int(state.get('scanned') or 0)+1
  if not isinstance(r,dict):continue
  num=issue(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue'))
  if not num:continue
  dedupe=code(r.get('isbn') or r.get('barcode')) or composite_key(r)
  if not dedupe or dedupe in seen:continue
  seen.add(dedupe)
  if already_tebeosfera(r,overlay):continue
  # Fichas sin ISBN se buscan solo en Tebeosfera; las de ISBN usan Tebeosfera y luego respaldos.
  targets.append(r)
 linked=0;teb=0;workers=max(1,min(int(a.workers or 5),5,len(targets) or 1))
 with ThreadPoolExecutor(max_workers=workers) as ex:
  futures={ex.submit(cover_for,r):r for r in targets}
  for fut in as_completed(futures):
   r=futures[fut]
   try:hit=fut.result()
   except Exception as e:print('ERROR',r.get('id'),repr(e));continue
   if not hit:continue
   url,source,source_url,extra=hit;meta=row_meta(r,url,source,source_url,extra);store_overlay(r,meta,overlay);linked+=1;teb+=1 if source=='Tebeosfera' else 0;state['linked']=int(state.get('linked') or 0)+1
   print('LINKED',r.get('publisher'),r.get('catalogHeader') or r.get('series'),r.get('stage'),r.get('issueNr'),source)
 state.update({'fileIndex':fi,'rowIndex':ri,'lastBatchChecked':len(targets),'lastBatchLinked':linked,'lastBatchTebeosfera':teb,'lastBatchScanned':scanned_this,'lastWorkers':workers,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'rebuild':'v49-tebeosfera-first-all-identities'})
 OVERLAY.write_text(json.dumps(overlay,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8')
 STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
 print('BACKFILL',json.dumps(state,ensure_ascii=False),'overlay',len(overlay))
if __name__=='__main__':main()
