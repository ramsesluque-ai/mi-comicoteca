#!/usr/bin/env python3
import argparse,json,re,time,unicodedata
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from io import BytesIO
import requests
from PIL import Image

ROOT=Path(__file__).resolve().parent
OVERLAY=ROOT/'bridge'/'cache'/'master-cover-overrides.json'
STATE=ROOT/'bridge'/'cache'/'master-cover-gcd-state.json'
COVERS=ROOT/'bridge'/'covers'
OWNER='ramsesluque-ai';REPO='mi-comicoteca';BRANCH='bridge-data'
BASE='https://www.comics.org'
HEADERS={'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA-GCD-BACKFILL/1.0','Accept-Language':'es-ES,es;q=0.9','Referer':'https://www.comics.org/'}

def code(v):return re.sub(r'[^0-9Xx]','',str(v or '')).upper()
def norm(v):
 s=unicodedata.normalize('NFD',str(v or ''));return ''.join(c for c in s if unicodedata.category(c)!='Mn').lower().strip()
def issue(v):
 s=norm(v).replace('º','').replace('°','').replace(' ','')
 if re.fullmatch(r'0*\d+',s):return str(int(s))
 return s.lstrip('0') or s
def toks(v):return {x for x in re.findall(r'[a-z0-9ñáéíóúü]+',norm(v)) if len(x)>1 and x not in {'de','del','la','el','los','las','y','e','vol','volumen','serie','etapa'}}
def series_score(a,b):
 A,B=toks(a),toks(b)
 if not A or not B:return 0
 return max(len(A&B)/len(A),len(A&B)/len(B))
def load_json(path,default):
 try:return json.loads(path.read_text(encoding='utf-8'))
 except:return default
def get(url,timeout=18,accept=None):
 h=dict(HEADERS)
 if accept:h['Accept']=accept
 try:return requests.get(url,headers=h,timeout=timeout,allow_redirects=True)
 except:return None
def image_url(d):
 urls=[];cv=d.get('cover') if isinstance(d,dict) else None
 if isinstance(cv,str):urls.append(cv)
 elif isinstance(cv,dict):
  for k in ('image','image_url','file','url','large','medium','thumbnail'):
   v=cv.get(k)
   if isinstance(v,str):urls.append(v)
  api=cv.get('api_url')
  if isinstance(api,str):
   rr=get(api+('&' if '?' in api else '?')+'format=json',accept='application/json')
   if rr and rr.status_code==200:
    try:cj=rr.json()
    except:cj={}
    for k in ('image','image_url','file','url','large','medium','thumbnail'):
     v=cj.get(k) if isinstance(cj,dict) else None
     if isinstance(v,str):urls.insert(0,v)
 for k in ('cover_url','image','image_url'):
  v=d.get(k) if isinstance(d,dict) else None
  if isinstance(v,str):urls.append(v)
 for u in urls:
  if isinstance(u,str) and u.startswith('http') and '/api/' not in u:return u.replace('http:','https:')
 return ''
def save_image(url,sid):
 r=get(url,25,accept='image/avif,image/webp,image/apng,image/*,*/*;q=0.8')
 if not r or r.status_code!=200 or not r.content:return ''
 try:
  im=Image.open(BytesIO(r.content)).convert('RGB');im.thumbnail((900,1350),Image.LANCZOS)
  COVERS.mkdir(parents=True,exist_ok=True);name=f'gcd-master-{sid}.webp';im.save(COVERS/name,'WEBP',quality=86,method=6)
  return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
 except:return ''
def resolve(sid,row):
 r=get(f'{BASE}/api/issue/{sid}/?format=json',accept='application/json')
 if not r or r.status_code!=200:return None
 try:d=r.json()
 except:return None
 wanted=issue(row.get('issueNr') if row.get('issueNr') is not None else row.get('issue'))
 actual=issue(d.get('number') or d.get('issue_number') or '')
 if wanted and actual and wanted!=actual:return None
 rs=row.get('catalogHeader') or row.get('series') or ''
 ser=d.get('series_name') or ((d.get('series') or {}).get('name') if isinstance(d.get('series'),dict) else '') or rs
 if rs and ser and series_score(rs,ser)<0.72:return None
 cover=image_url(d)
 if not cover:return None
 stored=save_image(cover,sid)
 if not stored:return None
 return {'_score':20000,'coverUrl':stored,'isbn':code(row.get('isbn') or row.get('barcode') or d.get('isbn') or d.get('barcode') or ''),'issueNr':actual or wanted,'pages':d.get('page_count') or row.get('pages') or '','publicationDate':d.get('publication_date') or d.get('key_date') or row.get('publicationDate') or '','publisher':row.get('publisher') or '','series':rs or ser,'source':'Backfill · GCD sourceId exacto','sourceUrl':f'{BASE}/issue/{sid}/','title':d.get('title') or d.get('descriptor') or row.get('title') or ser,'sourceId':sid}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--batch',type=int,default=80);ap.add_argument('--workers',type=int,default=4);a=ap.parse_args()
 files=sorted(Path(a.master).glob('*.json'));OVERLAY.parent.mkdir(parents=True,exist_ok=True);COVERS.mkdir(parents=True,exist_ok=True)
 overlay=load_json(OVERLAY,{});state=load_json(STATE,{'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0})
 fi=int(state.get('fileIndex') or 0);ri=int(state.get('rowIndex') or 0);scanned_this=0;max_scan=max(a.batch*150,7500);targets=[];seen=set()
 while len(targets)<a.batch and files and scanned_this<max_scan:
  if fi>=len(files):fi=0;ri=0;state['passes']=int(state.get('passes') or 0)+1
  rows=load_json(files[fi],[])
  if not isinstance(rows,list):rows=[]
  if ri>=len(rows):fi+=1;ri=0;continue
  row=rows[ri];ri+=1;scanned_this+=1;state['scanned']=int(state.get('scanned') or 0)+1
  if not isinstance(row,dict):continue
  sid=str(row.get('sourceId') or '').strip()
  if not sid.isdigit() or sid in seen:continue
  seen.add(sid)
  isbn=code(row.get('isbn') or row.get('barcode') or '')
  if (isbn and (overlay.get(isbn) or {}).get('coverUrl')) or (overlay.get('gcd:'+sid) or {}).get('coverUrl'):continue
  targets.append((sid,row))
 linked=0;workers=max(1,min(int(a.workers or 4),6,len(targets) or 1))
 with ThreadPoolExecutor(max_workers=workers) as ex:
  fs={ex.submit(resolve,sid,row):(sid,row) for sid,row in targets}
  for fut in as_completed(fs):
   sid,row=fs[fut]
   try:hit=fut.result()
   except Exception as e:print('GCD_ERROR',sid,repr(e));continue
   if not hit:continue
   overlay['gcd:'+sid]=hit;linked+=1;state['linked']=int(state.get('linked') or 0)+1
   print('GCD_LINKED',sid,hit.get('series'),hit.get('issueNr'))
 state.update({'fileIndex':fi,'rowIndex':ri,'lastBatchChecked':len(targets),'lastBatchLinked':linked,'lastBatchScanned':scanned_this,'lastWorkers':workers,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
 OVERLAY.write_text(json.dumps(overlay,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8');STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
 print('GCD_BACKFILL',json.dumps(state,ensure_ascii=False),'overlay',len(overlay))
if __name__=='__main__':main()
