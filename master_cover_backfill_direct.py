#!/usr/bin/env python3
import argparse,json,re,time,unicodedata
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from urllib.parse import urljoin,quote_plus
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parent
OVERLAY=ROOT/'bridge'/'cache'/'master-cover-overrides.json'
STATE=ROOT/'bridge'/'cache'/'master-cover-backfill-state.json'
PRIORITY=['ecc','panini','planeta','forum','zinco','norma','glenat','salvat','bruguera','vertice','novaro','toutain','toray','maga','ferma','hispano americana']
UA='Mozilla/5.0 Chrome/153 MI-COMICOTECA-TEBEOSFERA-DIRECT/1.0'
SAVE_URL='https://www.tebeosfera.com/neko/php/ajax/buscador_avanzado_graba_consulta.php?web=1'
SEARCH_URL='https://www.tebeosfera.com/buscador-avanzado/'


def norm(v):
 s=unicodedata.normalize('NFD',str(v or ''));return re.sub(r'\s+',' ',''.join(c for c in s if unicodedata.category(c)!='Mn').lower()).strip()
def code(v):return re.sub(r'[^0-9Xx]','',str(v or '')).upper()
def issue(v):
 s=norm(v).replace('º','').replace('°','').replace(' ','')
 if re.fullmatch(r'0*\d+',s):return str(int(s))
 return re.sub(r'^0+(?=\d)','',s)
def composite_key(r,blank_volume=False):
 return '@:'+'|'.join([norm(r.get('publisher')),norm(r.get('catalogHeader') or r.get('series')),'' if blank_volume else norm(r.get('volume')),norm(r.get('stage')),str(r.get('startYear') or '').strip(),issue(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue'))])
def load_json(p,default):
 try:return json.loads(p.read_text(encoding='utf-8'))
 except:return default

def session():
 s=requests.Session();s.headers.update({'User-Agent':UA,'Accept-Language':'es-ES,es;q=0.9','Referer':SEARCH_URL});return s

def advanced_links(s,table,query,kind,limit=40):
 try:
  s.get(SEARCH_URL,timeout=20)
  r=s.post(SAVE_URL,data={'tabla':table,'query':query,'puede_grabar_consulta':'no','asignacion_etiquetas':'no','tipo_consulta':'s','anno_dedicacion':''},timeout=25)
  if r.status_code!=200:return []
  token=r.text.strip()
  if not re.fullmatch(r'[A-Za-z0-9_-]{3,80}',token):return []
  rr=s.get(f'https://www.tebeosfera.com/resultados-avanzados/{token}.html',timeout=25,allow_redirects=True)
  if rr.status_code!=200:return []
  soup=BeautifulSoup(rr.text,'html.parser');needle='/'+kind+'/';out=[]
  for a in soup.select('a[href]'):
   href=urljoin(rr.url,a.get('href') or '')
   if needle in href and href.endswith('.html') and href not in out:out.append(href)
   if len(out)>=limit:break
  return out
 except Exception:return []

def page_cover(s,url):
 try:
  r=s.get(url,timeout=25)
  if r.status_code!=200:return None
  soup=BeautifulSoup(r.text,'html.parser');text=' '.join(soup.stripped_strings)
  title=(soup.find('meta',attrs={'property':'og:title'}) or {}).get('content','') or (soup.title.get_text(' ',strip=True) if soup.title else '')
  img=(soup.find('meta',attrs={'property':'og:image'}) or {}).get('content','')
  if img:img=urljoin(r.url,img).replace('http:','https:')
  return soup,text,title,img,r.url
 except Exception:return None

def tebeosfera_isbn(isbn):
 s=session()
 query=("id from T3_numeros WHERE ("+
        f"isbn LIKE '%{isbn}%' || deposito LIKE '%{isbn}%' || issn LIKE '%{isbn}%' || "+
        f"ean LIKE '%{isbn}%' || doi LIKE '%{isbn}%' || cdu LIKE '%{isbn}%' || otro_registro LIKE '%{isbn}%' ) ")
 for u in advanced_links(s,'T3_numeros',query,'numeros',40):
  p=page_cover(s,u)
  if not p:continue
  _,text,title,img,final=p
  if isbn not in code(text):continue
  if not img:continue
  return img,'Tebeosfera',final,{'tebeosferaTitle':title,'authority':'Tebeosfera','match':'ISBN exacto'}
 return None

def openlibrary(isbn):
 try:
  key='ISBN:'+isbn;r=requests.get('https://openlibrary.org/api/books?bibkeys='+quote_plus(key)+'&format=json&jscmd=data',headers={'User-Agent':UA},timeout=12)
  b=(r.json().get(key) or {}) if r.status_code==200 else {};c=b.get('cover') or {};u=c.get('large') or c.get('medium') or c.get('small')
  return (u.replace('http:','https:'),'OpenLibrary',u,{'match':'ISBN exacto'}) if u else None
 except:return None

def googlebooks(isbn):
 try:
  r=requests.get('https://www.googleapis.com/books/v1/volumes?q='+quote_plus('isbn:'+isbn)+'&maxResults=5',headers={'User-Agent':UA},timeout=12)
  for it in (r.json().get('items') or []) if r.status_code==200 else []:
   v=it.get('volumeInfo') or {};ids=v.get('industryIdentifiers') or []
   if not any(code(x.get('identifier'))==isbn for x in ids):continue
   im=v.get('imageLinks') or {};u=im.get('extraLarge') or im.get('large') or im.get('medium') or im.get('small') or im.get('thumbnail')
   if u:return u.replace('http:','https:'),'Google Books',u,{'match':'ISBN exacto'}
 except:pass
 return None

def cover_for(r):
 isbn=code(r.get('isbn') or r.get('barcode'))
 if len(isbn) not in (10,13):return None
 hit=tebeosfera_isbn(isbn)
 if hit:return hit
 for fn in (openlibrary,googlebooks):
  hit=fn(isbn)
  if hit:return hit
 return None

def row_meta(r,url,source,source_url,extra=None):
 isbn=code(r.get('isbn') or r.get('barcode'))
 d={'isbn':isbn,'sourceId':str(r.get('sourceId') or ''),'title':r.get('title') or '', 'publisher':r.get('publisher') or '', 'series':r.get('catalogHeader') or r.get('series') or '', 'volume':r.get('volume') or '', 'stage':r.get('stage') or '', 'startYear':str(r.get('startYear') or ''), 'issueNr':str(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue') or ''), 'publicationDate':r.get('publicationDate') or '', 'pages':r.get('pages') or '', 'coverUrl':url, 'sourceUrl':source_url or url, 'source':'Backfill · '+source, '_score':30000 if source=='Tebeosfera' else 12000}
 if extra:d.update(extra)
 return d

def keys_for(r):
 out=[];isbn=code(r.get('isbn') or r.get('barcode'))
 if len(isbn) in (10,13):out.append(isbn)
 sid=str(r.get('sourceId') or '').strip()
 if sid:out.append('gcd:'+sid)
 for k in (composite_key(r),composite_key(r,True)):
  if k and k not in out:out.append(k)
 return out

def already(r,overlay):
 return any(k and overlay.get(k,{}).get('coverUrl') for k in keys_for(r))
def store(r,meta,overlay):
 for k in keys_for(r):
  old=overlay.get(k) or {}
  new_teb='tebeosfera' in norm(meta.get('source'));old_teb='tebeosfera' in norm(old.get('source'))
  if old_teb and not new_teb:continue
  if old and not new_teb and int(old.get('_score') or 0)>int(meta.get('_score') or 0):continue
  overlay[k]=dict(meta)

def priority_files(files):
 def rank(p):
  n=norm(p.name)
  for i,x in enumerate(PRIORITY):
   if n.startswith(x.replace(' ','-')) or x in n:return (0,i,n)
  return (1,999,n)
 return sorted(files,key=rank)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--batch',type=int,default=40);ap.add_argument('--workers',type=int,default=3);a=ap.parse_args()
 files=priority_files(list(Path(a.master).glob('*.json')));overlay=load_json(OVERLAY,{})
 state=load_json(STATE,{'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0,'phase':'isbn-direct'})
 if state.get('rebuild')!='v54-tebeosfera-direct':state={'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0,'phase':'isbn-direct','rebuild':'v54-tebeosfera-direct'}
 fi=int(state.get('fileIndex') or 0);ri=int(state.get('rowIndex') or 0);targets=[];scanned_this=0;max_scan=max(a.batch*300,12000);seen=set()
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
  if already(r,overlay):continue
  targets.append(r)
 linked=teb=0;workers=max(1,min(int(a.workers or 3),3,len(targets) or 1))
 with ThreadPoolExecutor(max_workers=workers) as ex:
  futs={ex.submit(cover_for,r):r for r in targets}
  for fut in as_completed(futs):
   r=futs[fut]
   try:hit=fut.result()
   except Exception as e:print('ERROR',r.get('id'),repr(e));continue
   if not hit:continue
   url,source,source_url,extra=hit;meta=row_meta(r,url,source,source_url,extra);store(r,meta,overlay);linked+=1;state['linked']=int(state.get('linked') or 0)+1
   if source=='Tebeosfera':teb+=1
   print('LINKED',r.get('publisher'),r.get('catalogHeader') or r.get('series'),r.get('issueNr'),code(r.get('isbn') or r.get('barcode')),source,source_url)
 state.update({'fileIndex':fi,'rowIndex':ri,'lastBatchChecked':len(targets),'lastBatchLinked':linked,'lastBatchTebeosfera':teb,'lastBatchScanned':scanned_this,'lastWorkers':workers,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'rebuild':'v54-tebeosfera-direct','phase':'isbn-direct'})
 OVERLAY.parent.mkdir(parents=True,exist_ok=True);OVERLAY.write_text(json.dumps(overlay,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8');STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
 print('DIRECT_BACKFILL',json.dumps(state,ensure_ascii=False),'overlay',len(overlay))
if __name__=='__main__':main()
