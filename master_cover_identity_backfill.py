#!/usr/bin/env python3
import argparse,json,re,time,unicodedata,html as htmlmod
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from urllib.parse import quote_plus,urljoin,urlparse,parse_qs,unquote
from io import BytesIO
import requests
from bs4 import BeautifulSoup
from PIL import Image

ROOT=Path(__file__).resolve().parent
OVERLAY=ROOT/'bridge'/'cache'/'master-cover-overrides.json'
STATE=ROOT/'bridge'/'cache'/'master-cover-identity-state.json'
COVERS=ROOT/'bridge'/'covers'
OWNER='ramsesluque-ai';REPO='mi-comicoteca';BRANCH='bridge-data'
S=requests.Session();S.headers.update({'User-Agent':'Mozilla/5.0 Chrome/153 MI-COMICOTECA-IDENTITY/2.0','Accept-Language':'es-ES,es;q=0.9'})
PUB_ALIASES={
 'ecc':['ecc ediciones','ecc'], 'zinco':['zinco'], 'forum':['forum','planeta deagostini','planeta-deagostini'],
 'panini':['panini'], 'planeta deagostini':['planeta deagostini','planeta comic','planeta cómic'],
 'vertice':['vertice','vértice'], 'bruguera':['bruguera'], 'novaro':['novaro'], 'norma':['norma editorial','norma'],
 'glenat':['glenat','glénat'], 'salvat':['salvat'], 'astiberri':['astiberri'], 'dibbuks':['dibbuks'],
 'dolmen':['dolmen'], 'aleta':['aleta'], 'ivrea':['ivrea'], 'milky way':['milky way']
}

def norm(v):
 s=unicodedata.normalize('NFD',str(v or ''));return ''.join(c for c in s if unicodedata.category(c)!='Mn').lower().strip()
def code(v):return re.sub(r'[^0-9Xx]','',str(v or '')).upper()
def issue_num(v):
 s=str(v or '').strip();return str(int(s)) if re.fullmatch(r'0*\d+',s) else ''
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
def toks(v):return {x for x in canonical_series(v).split() if len(x)>1 and x not in {'de','del','la','el','los','las','y','e','vol','volumen','serie','etapa','comic','comics'}}
def series_score(a,b):
 A,B=toks(a),toks(b)
 if not A or not B:return 0
 return max(len(A&B)/len(A),len(A&B)/len(B))
def variants(series,stage=''):
 vals=[]
 def add(x):
  x=' '.join(str(x or '').split())
  if x and norm(x) not in [norm(v) for v in vals]:vals.append(x)
 add(series);c=canonical_series(series)
 if c=='batman':add('Batman');add('Batman el Hombre Murciélago')
 elif c=='spiderman':add('Spider-Man');add('Spiderman');add('El Hombre Araña')
 elif c=='superman':add('Superman');add('Supermán')
 if stage:
  for v in list(vals):add(v+' '+stage)
 return vals[:8]
def load_json(path,default):
 try:return json.loads(path.read_text(encoding='utf-8'))
 except:return default
def get(url,timeout=13,headers=None):
 try:return S.get(url,timeout=timeout,allow_redirects=True,headers=headers or {})
 except:return None
def pub_ok(pub,text):
 p=norm(pub);t=norm(text)
 for key,aliases in PUB_ALIASES.items():
  if key in p:return any(norm(a) in t for a in aliases)
 words=[x for x in re.findall(r'[a-z0-9]+',p) if len(x)>=4]
 return bool(words) and any(x in t for x in words)
def stage_ok(stage,text):
 if not stage:return True
 s=norm(stage);t=norm(text)
 marks=[x for x in ('aguila','avestruz','colibri','librocomic') if x in s]
 return not marks or any(x in t for x in marks)
def year_of(row):
 y=str(row.get('startYear') or '').strip()
 if re.fullmatch(r'19\d\d|20\d\d',y):return y
 m=re.match(r'^(19\d\d|20\d\d)',str(row.get('publicationDate') or ''))
 return m.group(1) if m else ''
def clean(u,base=''):
 u=htmlmod.unescape(str(u or '')).strip()
 if u.startswith('//'):u='https:'+u
 if base:u=urljoin(base,u)
 return u if u.startswith(('http://','https://')) else ''
def search_links(q,domains=None,limit=10):
 out=[]
 for base,sel in [('https://www.bing.com/search?q=','li.b_algo h2 a, h2 a'),('https://html.duckduckgo.com/html/?q=','a.result__a, a.result-link')]:
  r=get(base+quote_plus(q),13,{'Accept':'text/html'})
  if not r or r.status_code not in (200,202):continue
  s=BeautifulSoup(r.text,'html.parser')
  for a in s.select(sel):
   u=a.get('href') or ''
   if 'uddg=' in u:
    try:u=unquote(parse_qs(urlparse(u).query).get('uddg',[''])[0])
    except:pass
   u=clean(u)
   if not u:continue
   host=urlparse(u).netloc.lower()
   if domains and not any(d in host for d in domains):continue
   if u not in out:out.append(u)
   if len(out)>=limit:return out
 return out

def inspect_tebeosfera(url,row):
 r=get(url,15)
 if not r or r.status_code!=200:return None
 s=BeautifulSoup(r.text,'html.parser');txt=s.get_text(' ',strip=True)
 mt=s.find('meta',attrs={'property':'og:title'});title=(mt.get('content') or '').strip() if mt else (s.title.get_text(' ',strip=True) if s.title else '')
 n=issue_num(row.get('issueNr') or row.get('issue'));series=row.get('catalogHeader') or row.get('series') or '';year=year_of(row);stage=row.get('stage') or ''
 blob=title+' '+txt[:20000]
 if not n or not re.search(r'(?<!\d)0*'+re.escape(n)+r'(?!\d)',norm(blob)):return None
 if series_score(series,blob)<0.55:return None
 if not pub_ok(row.get('publisher') or '',txt):return None
 if not stage_ok(stage,blob):return None
 # Año: si está presente en la ficha debe coincidir. Si Tebeosfera no lo muestra, no invalida.
 if year and re.search(r'\b(?:19|20)\d{2}\b',txt) and year not in txt:return None
 mi=s.find('meta',attrs={'property':'og:image'});img=clean((mi.get('content') or '').strip(),r.url) if mi else ''
 if not img:
  best=[]
  for im in s.find_all('img'):
   src=clean(im.get('data-src') or im.get('data-original') or im.get('data-lazy') or im.get('src') or '',r.url)
   if not src:continue
   hint=norm(' '.join([im.get('alt') or '',im.get('title') or '',src]));score=(5 if any(x in hint for x in ('portada','cover','cubierta')) else 0)-(9 if 'logo' in hint else 0)
   best.append((score,src))
  if best:img=max(best,key=lambda z:z[0])[1]
 if not img:return None
 return {'url':r.url,'image':img,'title':title,'source':'Tebeosfera'}
def tebeosfera_links(row):
 n=issue_num(row.get('issueNr') or row.get('issue'));series=row.get('catalogHeader') or row.get('series') or '';pub=row.get('publisher') or '';stage=row.get('stage') or ''
 out=[]
 for v in variants(series,stage):
  queries=[f'site:tebeosfera.com "{v}" "{n}" "{pub}"']
  if stage:queries.append(f'site:tebeosfera.com "{v}" "{stage}" "{n}"')
  for q in queries:
   for u in search_links(q,['tebeosfera.com'],10):
    if u not in out:out.append(u)
 return out[:24]

def milcomics_links(row):
 q=' '.join(x for x in [row.get('catalogHeader') or row.get('series'),issue_num(row.get('issueNr') or row.get('issue')),row.get('publisher')] if x)
 r=get('https://www.milcomics.com/busqueda?controller=search&s='+quote_plus(q))
 if not r or r.status_code!=200:return []
 s=BeautifulSoup(r.text,'html.parser');out=[]
 for sel in ('article.product-miniature a[href]','.product-miniature a[href]','.product-title a[href]','h2 a[href]','h3 a[href]'):
  for a in s.select(sel):
   u=urljoin(r.url,a.get('href') or '')
   if 'milcomics.com' in u and u not in out:out.append(u)
   if len(out)>=6:break
  if out:break
 return out[:6]
def inspect_milcomics(url,row):
 r=get(url)
 if not r or r.status_code!=200:return None
 s=BeautifulSoup(r.text,'html.parser');txt=s.get_text(' ',strip=True)
 mt=s.find('meta',attrs={'property':'og:title'});title=(mt.get('content') or '').strip() if mt else (s.title.get_text(' ',strip=True) if s.title else '')
 n=issue_num(row.get('issueNr') or row.get('issue'));series=row.get('catalogHeader') or row.get('series') or '';year=year_of(row)
 if not n or not re.search(r'(?<!\d)0*'+re.escape(n)+r'(?!\d)',norm(title)):return None
 if series_score(series,title)<0.72:return None
 if not pub_ok(row.get('publisher') or '',txt):return None
 if year and year not in txt:return None
 mi=s.find('meta',attrs={'property':'og:image'});img=(mi.get('content') or '').strip() if mi else ''
 if not img:return None
 return {'url':r.url,'image':urljoin(r.url,img),'title':title,'source':'MilComics'}
def save_image(url,sid):
 r=get(url,20,{'Referer':'https://www.tebeosfera.com/'})
 if not r or r.status_code!=200 or not r.content:return ''
 try:
  im=Image.open(BytesIO(r.content)).convert('RGB');im.thumbnail((900,1350),Image.LANCZOS)
  COVERS.mkdir(parents=True,exist_ok=True);name=f'identity-{sid}.webp';im.save(COVERS/name,'WEBP',quality=86,method=6)
  return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
 except:return ''
def resolve(row):
 sid=str(row.get('sourceId') or '').strip()
 for u in tebeosfera_links(row):
  c=inspect_tebeosfera(u,row)
  if c:
   stored=save_image(c['image'],sid or re.sub(r'\W+','-',norm(c['title'])))
   if stored:return hit_meta(row,sid,c,stored,30000)
 for u in milcomics_links(row):
  c=inspect_milcomics(u,row)
  if c:
   stored=save_image(c['image'],sid or re.sub(r'\W+','-',norm(c['title'])))
   if stored:return hit_meta(row,sid,c,stored,18000)
 return None
def hit_meta(row,sid,c,stored,score):
 return {'_score':score,'coverUrl':stored,'isbn':'','issueNr':issue_num(row.get('issueNr') or row.get('issue')),'pages':row.get('pages') or '','publicationDate':row.get('publicationDate') or '','publisher':row.get('publisher') or '','series':row.get('catalogHeader') or row.get('series') or '','volume':row.get('volume') or '','stage':row.get('stage') or '','startYear':str(row.get('startYear') or ''),'source':'Backfill · '+c['source'],'sourceUrl':c['url'],'title':row.get('title') or c['title'],'sourceId':sid}
def priority_files(master):
 base=Path(master);idx=load_json(base.parent/'index.json',{});files=[]
 for p in idx.get('publishers') or []:
  if not p.get('priority'):continue
  for rel in p.get('chunks') or []:
   fp=base.parent/rel
   if fp.exists():files.append(fp)
 return files
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--master',required=True);ap.add_argument('--batch',type=int,default=40);ap.add_argument('--workers',type=int,default=3);a=ap.parse_args()
 files=priority_files(a.master);overlay=load_json(OVERLAY,{});state=load_json(STATE,{'fileIndex':0,'rowIndex':0,'scanned':0,'linked':0,'passes':0})
 fi=int(state.get('fileIndex') or 0);ri=int(state.get('rowIndex') or 0);targets=[];seen=set();scanned_this=0;max_scan=max(a.batch*300,10000)
 while len(targets)<a.batch and files and scanned_this<max_scan:
  if fi>=len(files):fi=0;ri=0;state['passes']=int(state.get('passes') or 0)+1
  rows=load_json(files[fi],[])
  if not isinstance(rows,list):rows=[]
  if ri>=len(rows):fi+=1;ri=0;continue
  row=rows[ri];ri+=1;scanned_this+=1;state['scanned']=int(state.get('scanned') or 0)+1
  if not isinstance(row,dict):continue
  if code(row.get('isbn') or row.get('barcode')):continue
  n=issue_num(row.get('issueNr') or row.get('issue'));sid=str(row.get('sourceId') or '').strip()
  if not n or not sid.isdigit() or sid in seen:continue
  seen.add(sid)
  old=overlay.get('gcd:'+sid) or {}
  if old.get('coverUrl') and 'tebeosfera' in norm(old.get('source')):continue
  if not year_of(row):continue
  targets.append(row)
 linked=0;workers=max(1,min(int(a.workers or 3),4,len(targets) or 1))
 with ThreadPoolExecutor(max_workers=workers) as ex:
  fs={ex.submit(resolve,row):row for row in targets}
  for fut in as_completed(fs):
   row=fs[fut];sid=str(row.get('sourceId'))
   try:hit=fut.result()
   except Exception as e:hit=None;print('IDENTITY_ERROR',sid,repr(e))
   if not hit:continue
   old=overlay.get('gcd:'+sid) or {}
   if old.get('coverUrl') and 'tebeosfera' in norm(old.get('source')) and 'tebeosfera' not in norm(hit.get('source')):continue
   overlay['gcd:'+sid]=hit;linked+=1;state['linked']=int(state.get('linked') or 0)+1
   print('IDENTITY_LINKED',sid,hit['publisher'],hit['series'],hit['issueNr'],hit['source'])
 state.update({'fileIndex':fi,'rowIndex':ri,'lastBatchChecked':len(targets),'lastBatchLinked':linked,'lastBatchScanned':scanned_this,'lastWorkers':workers,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
 OVERLAY.write_text(json.dumps(overlay,ensure_ascii=False,indent=2,sort_keys=True),encoding='utf-8');STATE.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
 print('IDENTITY_BACKFILL',json.dumps(state,ensure_ascii=False),'overlay',len(overlay))
if __name__=='__main__':main()