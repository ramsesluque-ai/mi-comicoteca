#!/usr/bin/env python3
import argparse,json,re,time,unicodedata
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from urllib.parse import quote_plus,urljoin
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parent
OVERLAY=ROOT/'bridge'/'cache'/'master-cover-overrides.json'
STATE=ROOT/'bridge'/'cache'/'master-cover-backfill-state.json'
HEADERS={'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA-MASTER/1.4','Accept-Language':'es-ES,es;q=0.9'}

def code(v):return re.sub(r'[^0-9Xx]','',str(v or '')).upper()
def norm(v):
 s=unicodedata.normalize('NFD',str(v or ''));return ''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
def get(url,timeout=14):
 try:return requests.get(url,headers=HEADERS,timeout=timeout,allow_redirects=True)
 except Exception:return None
def openlibrary(isbn):
 key='ISBN:'+isbn;r=get('https://openlibrary.org/api/books?bibkeys='+quote_plus(key)+'&format=json&jscmd=data')
 if not r or r.status_code!=200:return None
 try:b=r.json().get(key) or {}
 except:return None
 c=b.get('cover') or {};u=c.get('large') or c.get('medium') or c.get('small')
 return (u.replace('http:','https:'), 'OpenLibrary') if u else None
def googlebooks(isbn):
 r=get('https://www.googleapis.com/books/v1/volumes?q='+quote_plus('isbn:'+isbn)+'&maxResults=5')
 if not r or r.status_code!=200:return None
 try:items=r.json().get('items') or []
 except:return None
 for it in items:
  v=it.get('volumeInfo') or {};ids=v.get('industryIdentifiers') or []
  if not any(code(x.get('identifier'))==isbn for x in ids):continue
  im=v.get('imageLinks') or {};u=im.get('extraLarge') or im.get('large') or im.get('medium') or im.get('small') or im.get('thumbnail')
  if u:return u.replace('http:','https:'),'Google Books'
 return None
def milcomics(isbn):
 r=get('https://www.milcomics.com/busqueda?controller=search&s='+quote_plus(isbn),timeout=18)
 if not r or r.status_code!=200:return None
 s=BeautifulSoup(r.text,'html.parser');links=[]
 for a in s.find_all('a',href=True):
  u=urljoin(r.url,a.get('href'));hint=norm((a.get_text(' ',strip=True) or '')+' '+u)
  if 'milcomics.com' in u and u not in links and ('comic' in hint or 'renacimiento' in hint or 'descatalog' in hint):links.append(u)
 for u in links[:10]:
  rr=get(u,timeout=18)
  if not rr or rr.status_code!=200:continue
  ss=BeautifulSoup(rr.text,'html.parser');txt=code(ss.get_text(' ',strip=True))
  if isbn not in txt:continue
  m=ss.find('meta',attrs={'property':'og:image'});img=(m.get('content') or '').strip() if m else ''
  if img:return urljoin(u,img).replace('http:','https:'),'MilComics'
 return None
def cover_for(isbn):
 # Orden de coste: índices abiertos rápidos y, si fallan, fuente española exacta por ISBN.
 for fn in (openlibrary,googlebooks,milcomics):
  hit=fn(isbn)
  if hit:return hit
 return None
def row_meta(r,isbn,url,source):
 return {'isbn':isbn,'title':r.get('title') or '', 'publisher':r.get('publisher') or '', 'series':r.get('catalogHeader') or r.get('series') or '', 'issueNr':str(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue') or ''), 'publicationDate':r.get('publicationDate') or '', 'pages':r.get('pages') or '', 'coverUrl':url, 'sourceUrl':url, 'source':'Backfill · '+source, '_score':12000}
def load_json(path,default):
 try:return json.loads(path.read_text(encoding='utf-8'))
 except:return default
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--batch',type=int,default=80);ap.add_argument('--workers',type=int,default=8);a=ap.parse_args()
 files=sorted(Path(a.master).glob('*.json'));OVERLAY.parent.mkdir(parents=True,exist_ok=True)
 overlay=load_json(OVERLAY,{});state=load_json(STATE,{'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0})
 fi=int(state.get('fileIndex') or 0);ri=int(state.get('rowIndex') or 0);scanned_this=0;max_scan=max(a.batch*100,5000);targets=[];seen=set()
 while len(targets)<a.batch and files and scanned_this<max_scan:
  if fi>=len(files):fi=0;ri=0;state['passes']=int(state.get('passes') or 0)+1
  rows=load_json(files[fi],[])
  if not isinstance(rows,list):rows=[]
  if ri>=len(rows):fi+=1;ri=0;continue
  r=rows[ri];ri+=1;scanned_this+=1;state['scanned']=int(state.get('scanned') or 0)+1
  if not isinstance(r,dict):continue
  isbn=code(r.get('isbn') or r.get('barcode'))
  if len(isbn) not in (10,13) or isbn in seen:continue
  seen.add(isbn)
  if isbn in overlay and (overlay[isbn] or {}).get('coverUrl'):continue
  targets.append((isbn,r))
 linked=0
 workers=max(1,min(int(a.workers or 8),8,len(targets) or 1))
 with ThreadPoolExecutor(max_workers=workers) as ex:
  futures={ex.submit(cover_for,isbn):(isbn,r) for isbn,r in targets}
  for fut in as_completed(futures):
   isbn,r=futures[fut]
   try:hit=fut.result()
   except Exception as e:
    print('ERROR',isbn,repr(e));continue
   if not hit:continue
   url,source=hit;overlay[isbn]=row_meta(r,isbn,url,source);linked+=1;state['linked']=int(state.get('linked') or 0)+1
   print('LINKED',isbn,overlay[isbn]['series'],overlay[isbn]['issueNr'],source)
 state.update({'fileIndex':fi,'rowIndex':ri,'lastBatchChecked':len(targets),'lastBatchLinked':linked,'lastBatchScanned':scanned_this,'lastWorkers':workers,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
 OVERLAY.write_text(json.dumps(overlay,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8')
 STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
 print('BACKFILL',json.dumps(state,ensure_ascii=False),'overlay',len(overlay))
if __name__=='__main__':main()
