#!/usr/bin/env python3
import argparse,json,re,time,unicodedata
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parent
OVERLAY=ROOT/'bridge'/'cache'/'master-cover-overrides.json'
STATE=ROOT/'bridge'/'cache'/'master-cover-gcd-state.json'
PRIORITY=['bruguera','novaro','zinco','vertice','forum','planeta','ecc','panini','norma','glenat','salvat','toutain']
UA='Mozilla/5.0 Chrome/153 MI-COMICOTECA-GCD-COVER/1.0'


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
def keys_for(r):
 out=[];isbn=code(r.get('isbn') or r.get('barcode'))
 if len(isbn) in (10,13):out.append(isbn)
 sid=str(r.get('sourceId') or '').strip().replace('gcd_','')
 if sid:out.append('gcd:'+sid)
 for k in (composite_key(r),composite_key(r,True)):
  if k and k not in out:out.append(k)
 return out
def already(r,overlay):return any(overlay.get(k,{}).get('coverUrl') for k in keys_for(r))
def priority_files(files):
 def rank(p):
  n=norm(p.name)
  for i,x in enumerate(PRIORITY):
   if n.startswith(x) or x in n:return (0,i,n)
  return (1,999,n)
 return sorted(files,key=rank)
def good_image(u):
 u=str(u or '').strip()
 if not u:return False
 l=u.lower()
 if any(x in l for x in ['logo','favicon','avatar','flag','icon','button']):return False
 return any(x in l for x in ['/covers/','/cover/','cover']) and not l.endswith('.svg')
def extract_cover(html,base,sid):
 soup=BeautifulSoup(html,'html.parser');cands=[]
 for m in soup.select('meta[property="og:image"],meta[name="twitter:image"]'):
  u=urljoin(base,m.get('content') or '')
  if good_image(u):cands.append(u)
 for img in soup.select('img[src]'):
  u=urljoin(base,img.get('src') or '')
  if good_image(u):cands.append(u)
 for a in soup.select('a[href]'):
  h=a.get('href') or ''
  if re.search(rf'/issue/{re.escape(str(sid))}/cover/\d+/?$',h):
   cands.append(urljoin(base,h))
 seen=[]
 for u in cands:
  if u not in seen:seen.append(u)
 return seen

def gcd_cover(r):
 sid=str(r.get('sourceId') or '').strip().replace('gcd_','')
 if not sid.isdigit():return None
 s=requests.Session();s.headers.update({'User-Agent':UA,'Accept-Language':'es-ES,es;q=0.9,en;q=0.7'})
 issue_url=f'https://www.comics.org/issue/{sid}/'
 try:
  rr=s.get(issue_url,timeout=20,allow_redirects=True)
  if rr.status_code!=200:return None
  cands=extract_cover(rr.text,rr.url,sid)
  # Si primero obtuvimos una página de cover, abrirla para localizar la imagen real.
  expanded=[]
  for u in cands[:8]:
   if re.search(r'/issue/\d+/cover/\d+/?$',u):
    try:
     cr=s.get(u,timeout=20,allow_redirects=True)
     if cr.status_code==200:expanded.extend(extract_cover(cr.text,cr.url,sid))
    except Exception:pass
   else:expanded.append(u)
  for u in expanded+cands:
   if re.search(r'/issue/\d+/cover/\d+/?$',u):continue
   if not good_image(u):continue
   try:
    ir=s.get(u,timeout=20,stream=True,allow_redirects=True)
    ct=(ir.headers.get('content-type') or '').lower()
    if ir.status_code==200 and ct.startswith('image/'):
     return ir.url
   except Exception:continue
 except Exception:return None
 return None

def meta_for(r,url):
 return {
  'isbn':code(r.get('isbn') or r.get('barcode')),
  'sourceId':str(r.get('sourceId') or '').strip().replace('gcd_',''),
  'title':r.get('title') or '',
  'publisher':r.get('publisher') or '',
  'series':r.get('catalogHeader') or r.get('series') or '',
  'volume':r.get('volume') or '',
  'stage':r.get('stage') or '',
  'startYear':str(r.get('startYear') or ''),
  'issueNr':str(r.get('issueNr') if r.get('issueNr') is not None else r.get('issue') or ''),
  'publicationDate':r.get('publicationDate') or '',
  'pages':r.get('pages') or '',
  'coverUrl':url,
  'sourceUrl':f"https://www.comics.org/issue/{str(r.get('sourceId') or '').strip().replace('gcd_','')}/",
  'source':'Backfill · GCD exact sourceId',
  'authority':'Grand Comics Database',
  'match':'sourceId exacto',
  '_score':40000
 }
def store(r,meta,overlay):
 for k in keys_for(r):
  old=overlay.get(k) or {}
  if old and int(old.get('_score') or 0)>int(meta.get('_score') or 0):continue
  overlay[k]=dict(meta)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--batch',type=int,default=120);ap.add_argument('--workers',type=int,default=6);a=ap.parse_args()
 files=priority_files(list(Path(a.master).glob('*.json')));overlay=load_json(OVERLAY,{})
 state=load_json(STATE,{'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0})
 fi=int(state.get('fileIndex') or 0);ri=int(state.get('rowIndex') or 0);targets=[];scanned_this=0;max_scan=max(a.batch*80,8000)
 while len(targets)<a.batch and files and scanned_this<max_scan:
  if fi>=len(files):fi=0;ri=0;state['passes']=int(state.get('passes') or 0)+1
  rows=load_json(files[fi],[])
  if not isinstance(rows,list):rows=[]
  if ri>=len(rows):fi+=1;ri=0;continue
  r=rows[ri];ri+=1;scanned_this+=1;state['scanned']=int(state.get('scanned') or 0)+1
  if not isinstance(r,dict) or already(r,overlay):continue
  sid=str(r.get('sourceId') or '').strip().replace('gcd_','')
  if not sid.isdigit():continue
  targets.append(r)
 linked=0;workers=max(1,min(int(a.workers or 6),8,len(targets) or 1))
 with ThreadPoolExecutor(max_workers=workers) as ex:
  futs={ex.submit(gcd_cover,r):r for r in targets}
  for fut in as_completed(futs):
   r=futs[fut]
   try:url=fut.result()
   except Exception as e:print('ERROR',r.get('id'),repr(e));continue
   if not url:continue
   store(r,meta_for(r,url),overlay);linked+=1;state['linked']=int(state.get('linked') or 0)+1
   print('GCD_LINKED',r.get('publisher'),r.get('catalogHeader') or r.get('series'),r.get('issueNr'),r.get('sourceId'),url)
 state.update({'fileIndex':fi,'rowIndex':ri,'lastBatchChecked':len(targets),'lastBatchLinked':linked,'lastBatchScanned':scanned_this,'lastWorkers':workers,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'phase':'gcd-sourceid-exact'})
 OVERLAY.parent.mkdir(parents=True,exist_ok=True);OVERLAY.write_text(json.dumps(overlay,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8');STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
 print('GCD_BACKFILL',json.dumps(state,ensure_ascii=False),'overlay',len(overlay))
if __name__=='__main__':main()
