#!/usr/bin/env python3
"""Official-publisher bibliographic lookup for explicit COMICTECA requests.

Strict matching; robots-aware; metadata only. No cover downloading, hotlinking,
rehosting, bypassing login/CAPTCHA or crawling publisher catalogs.
"""
import json,re,time,unicodedata
from pathlib import Path
from urllib.parse import quote_plus,urlparse,parse_qs,unquote
from urllib.robotparser import RobotFileParser
import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parent
REQUESTS=ROOT/'bridge'/'requests'
RESULTS=ROOT/'bridge'/'results'
CACHE=ROOT/'bridge'/'cache'
for p in (RESULTS,CACHE):p.mkdir(parents=True,exist_ok=True)
UA='COMICTECA-BibliographicLookup/1.0 (single-page lookup; metadata only)'
S=requests.Session();S.headers.update({'User-Agent':UA,'Accept-Language':'es'})
# Strictly publisher-owned websites. Historical publishers without active
# catalogs are deliberately excluded.
PUBLISHERS={
 'panini':('Panini','www.panini.es'),
 'norma':('Norma Editorial','www.normaeditorial.com'),
 'planeta':('Planeta Cómic','www.planetadelibros.com'),
 'astiberri':('Astiberri','www.astiberri.com'),
 'dolmen':('Dolmen Editorial','dolmeneditorial.com'),
 'milky way':('Milky Way Ediciones','www.milkywayediciones.com'),
}
def norm(v):
 s=unicodedata.normalize('NFKD',str(v or ''))
 return re.sub(r'\s+',' ',''.join(c for c in s if not unicodedata.combining(c)).lower()).strip()
def isbn(v):return re.sub('[^0-9X]','',str(v or '').upper())
def normalized_title(v):return set(w for w in re.findall(r'[a-z0-9]+',norm(v)) if len(w)>2 and w not in ('del','los','las','con','vol','editorial','comics','comic','norma','panini'))
def publisher(q):
 p=norm(q.get('publisher'))
 for k,v in PUBLISHERS.items():
  if k in p:return v
 return None
def allowed(url):
 parsed=urlparse(url)
 if parsed.scheme!='https':return False
 try:
  robots=RobotFileParser('https://'+parsed.netloc+'/robots.txt')
  robots.read()
  return bool(robots.can_fetch(UA,url))
 except Exception as exc:
  print('ROBOTS_UNAVAILABLE',parsed.netloc,str(exc)[:80]);return False
def fetch(url):
 if not allowed(url):
  print('ROBOTS_DISALLOW',url);return None
 try:
  r=S.get(url,timeout=12)
  if r.status_code!=200 or 'text/html' not in r.headers.get('content-type','').lower():
   print('PUBLISHER_HTTP',r.status_code,url);return None
  if len(r.content)>2_000_000:return None
  return BeautifulSoup(r.content,'html.parser')
 except requests.RequestException as exc:
  print('PUBLISHER_ERROR',str(exc)[:120]);return None
def search(q,domain):
 terms=isbn(q.get('isbn')) or (' '.join(filter(None,[str(q.get('series') or ''),str(q.get('issue') or '')])))
 query='site:'+domain+' "'+terms+'"'
 try:
  r=S.get('https://www.bing.com/search',params={'q':query},timeout=12)
  if r.status_code!=200:return []
  soup=BeautifulSoup(r.text,'html.parser'); urls=[]
  for el in soup.select('li.b_algo h2 a, h2 a'):
   u=el.get('href') or ''
   host=urlparse(u).hostname or ''
   if u.startswith('https://') and (host==domain or host.endswith('.'+domain)) and u not in urls:urls.append(u)
  return urls[:4]
 except requests.RequestException:return []
def jsonld(s):
 out=[]
 for el in s.select('script[type="application/ld+json"]'):
  try:
   d=json.loads(el.string or el.get_text() or '{}')
   todo=d if isinstance(d,list) else [d]
   for v in todo:
    if isinstance(v,dict):
     out.append(v)
     if isinstance(v.get('@graph'),list):out.extend(x for x in v['@graph'] if isinstance(x,dict))
  except Exception:pass
 return out
def first(v):
 if isinstance(v,list):return first(v[0]) if v else ''
 if isinstance(v,dict):return str(v.get('name') or '')
 return str(v or '')
def candidate(url,q,name):
 s=fetch(url)
 if s is None:return None
 meta=s.select_one('meta[property="og:title"]')
 title=(meta.get('content') if meta else '') or (s.title.get_text(' ',strip=True) if s.title else '')
 data={}
 for el in jsonld(s):
  types=el.get('@type',[])
  typ=' '.join(types) if isinstance(types,list) else str(types)
  if any(w in typ.lower() for w in ['product','book','creativework']):
   data=el;break
 title=first(data.get('name')) or title
 # Prefer structured metadata, then clearly labelled fields, never assign
 # the query ISBN as though it had been found on the publisher's page.
 body=s.get_text(' ',strip=True)[:30000]
 found_isbn=isbn(data.get('isbn'))
 if not found_isbn:
  m=re.search(r'\b(?:ISBN(?:-13)?|EAN)\s*[:：-]?\s*((?:97[89][ -]?)?[0-9Xx][0-9Xx -]{8,17})',body,re.I)
  if m:found_isbn=isbn(m.group(1))
 qi=isbn(q.get('isbn'))
 if qi and (not found_isbn or qi!=found_isbn):return None
 if found_isbn and len(found_isbn) not in (10,13):return None
 tokens=normalized_title(q.get('series'))
 title_tokens=normalized_title(title)
 if tokens and len(tokens & title_tokens)/len(tokens)<.50 and not qi:return None
 issue=norm(q.get('issue'))
 if issue and not qi:
  pat=r'(?<!\d)0*'+re.escape(issue)+r'(?!\d)'
  if not re.search(pat,norm(title)):return None
 pages=first(data.get('numberOfPages'))
 if not pages:
  m=re.search(r'\b(\d{2,4})\s*(?:p[aá]ginas|p[aá]gs?\.?|pages)\b',body,re.I)
  if m:pages=m.group(1)
 published=first(data.get('datePublished'))
 c={'source':'Editorial oficial · '+name,'score':18000 if qi else 9000,
    'data':{'title':title,'publisher':name,'series':q.get('series',''),
            'issueNr':q.get('issue','') if (qi or issue) else '',
            'isbn':found_isbn,'pages':pages,'publicationDate':published,
            'sourceUrl':url,'coverUrl':'','sourceType':'publisher','coverRights':'not-cleared'}}
 return c
def main():
 for path in sorted(REQUESTS.glob('*.json'),key=lambda x:x.stat().st_mtime)[-20:]:
  try:q=json.loads(path.read_text(encoding='utf-8'))
  except Exception:continue
  if q.get('sourceMode')!='publisher':continue
  rid=str(q.get('requestId') or path.stem)
  target=RESULTS/(rid+'.json')
  if target.exists():continue
  match=publisher(q)
  results=[]
  if match:
   name,domain=match
   for u in search(q,domain):
    c=candidate(u,q,name)
    if c and not any(x['data']['sourceUrl']==u for x in results):results.append(c)
    if len(results)>=3:break
  payload={'ok':bool(results),'requestId':rid,'cacheKey':str(q.get('cacheKey') or ''),
    'query':q,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
    'candidates':results,'sourceMode':'publisher','metadataOnly':True}
  target.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
  # Cache successes only, allowing a future manual retry for misses.
  if results and q.get('cacheKey'):
   (CACHE/(str(q['cacheKey'])+'.json')).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
  print('PUBLISHER_LOOKUP',name if match else 'unsupported',rid,len(results))
if __name__=='__main__':main()
