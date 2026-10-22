#!/usr/bin/env python3
import os, re, json, time, hashlib, html as htmlmod
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse, parse_qs, unquote

import requests
from bs4 import BeautifulSoup
from PIL import Image
from io import BytesIO

ROOT=Path(__file__).resolve().parent
REQ_DIR=ROOT/'bridge'/'requests'
RES_DIR=ROOT/'bridge'/'results'
CACHE_DIR=ROOT/'bridge'/'cache'
COVER_DIR=ROOT/'bridge'/'covers'
for p in (REQ_DIR,RES_DIR,CACHE_DIR,COVER_DIR): p.mkdir(parents=True,exist_ok=True)

OWNER='ramsesluque-ai'; REPO='mi-comicoteca'; BRANCH='bridge-data'
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 MI-COMICOTECA/1.0'
S=requests.Session(); S.headers.update({'User-Agent':UA,'Accept-Language':'es-ES,es;q=0.9,en;q=0.6'})


def norm(s):
    import unicodedata
    s=unicodedata.normalize('NFD',str(s or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'\s+',' ',s).strip()

def digits(s): return re.sub(r'[^0-9Xx]','',str(s or '')).upper()
def issue_norm(s):
    s=norm(s).replace('º','').replace('°','').replace(' ','')
    if re.fullmatch(r'0*\d+',s): return str(int(s))
    return s.lstrip('0') or s

def series_score(a,b):
    stop={'de','del','la','el','los','las','y','e','vol','volumen','serie','etapa','ecc','ediciones','forum','zinco','panini','planeta','bruguera','novaro','renacimiento'}
    def toks(x): return {t for t in re.findall(r'[a-z0-9ñáéíóúü]+',norm(x)) if len(t)>1 and t not in stop}
    A,B=toks(a),toks(b)
    if not A or not B:return 0
    return max(len(A&B)/len(A),len(A&B)/len(B))

def get(url, timeout=25, **kw):
    try:
        r=S.get(url,timeout=timeout,allow_redirects=True,**kw)
        return r
    except Exception as e:
        print('GET_ERROR',url,repr(e)); return None

def soup_from(url):
    r=get(url)
    if not r or r.status_code!=200:return None,r
    return BeautifulSoup(r.text,'html.parser'),r

def meta(soup,key,attr='property'):
    if not soup:return ''
    el=soup.find('meta',attrs={attr:key}) or soup.find('meta',attrs={'name':key})
    return (el.get('content') or '').strip() if el else ''

def clean_url(u,base=''):
    u=htmlmod.unescape(str(u or '')).strip()
    if not u:return ''
    if u.startswith('//'):u='https:'+u
    if base:u=urljoin(base,u)
    return u if u.startswith(('http://','https://')) else ''

def extract_isbn(text):
    if not text:return ''
    pats=[r'(?:ISBN(?:-13)?|EAN)\s*[:\-]?\s*((?:97[89][\s\-]?)?\d[\d\s\-]{8,18}[\dXx])',r'\b(97[89][\d\s\-]{10,16}\d)\b']
    for p in pats:
        m=re.search(p,text,re.I)
        if m:
            d=digits(m.group(1))
            if len(d) in (10,13):return d
    return ''

def extract_pages(text):
    if not text:return ''
    m=re.search(r'\b(\d{1,4})\s*(?:p[aá]ginas|p[aá]gs?\.?|pp\.?|pages)\b',text,re.I)
    return m.group(1) if m else ''

def extract_issue(text):
    if not text:return ''
    pats=[r'(?:núm(?:ero)?|num(?:ero)?|n[º°o]\.?|#)\s*0*(\d{1,4})(?!\d)',r'\b0*(\d{1,3})\s*\(\s*renacimiento\s*\)']
    for p in pats:
        m=re.search(p,text,re.I)
        if m:return str(int(m.group(1)))
    return ''

def extract_date(text):
    if not text:return ''
    m=re.search(r'\b((?:19|20)\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?\b',text)
    if m:return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3) or 1):02d}"
    months={'enero':1,'febrero':2,'marzo':3,'abril':4,'mayo':5,'junio':6,'julio':7,'agosto':8,'septiembre':9,'setiembre':9,'octubre':10,'noviembre':11,'diciembre':12}
    m=re.search(r'\b('+'|'.join(months)+r')\s+(?:de\s+)?((?:19|20)\d{2})\b',norm(text))
    if m:return f"{m.group(2)}-{months[m.group(1)]:02d}-01"
    return ''

def candidate_from_html(url, source, q):
    soup,r=soup_from(url)
    if not soup:return None
    title=meta(soup,'og:title') or (soup.title.get_text(' ',strip=True) if soup.title else '')
    desc=meta(soup,'og:description') or meta(soup,'description',attr='name')
    text=soup.get_text(' ',strip=True)
    isbn=extract_isbn(text) or digits(q.get('isbn'))
    issue=extract_issue(title+' '+desc+' '+text[:6000]) or issue_norm(q.get('issue'))
    cover=clean_url(meta(soup,'og:image'),url)
    if not cover:
        for im in soup.find_all('img'):
            alt=norm(im.get('alt') or '')
            src=im.get('data-src') or im.get('src') or ''
            if src and ('portada' in alt or 'cover' in alt or 'all-star' in alt or 'comic' in alt):
                cover=clean_url(src,url); break
    publisher=q.get('publisher','')
    # generic label extraction
    for label in ('Editorial','Editor'):
        m=re.search(label+r'\s*[:\-]?\s*([^|·]{2,80})',text,re.I)
        if m: publisher=m.group(1).strip(); break
    pages=extract_pages(text)
    date=extract_date(text)
    series=q.get('series','')
    score=0
    if source.lower().startswith('tebeosfera'):score+=9000
    if isbn and digits(q.get('isbn')) and isbn==digits(q.get('isbn')):score+=4000
    if issue_norm(issue)==issue_norm(q.get('issue')):score+=2500
    score+=int(series_score(series,title+' '+desc)*1800)
    if norm(q.get('publisher')) in norm(text):score+=500
    return {'source':source,'score':score,'data':{'title':title,'publisher':publisher,'publicationDate':date,'pages':pages,'isbn':isbn,'series':series,'issueNr':issue,'coverUrl':cover,'sourceUrl':url}}

def ddg_links(query, domains=None, limit=10):
    url='https://html.duckduckgo.com/html/?q='+quote_plus(query)
    r=get(url)
    if not r or r.status_code!=200:return []
    soup=BeautifulSoup(r.text,'html.parser'); out=[]
    for a in soup.select('a.result__a, a.result-link'):
        href=a.get('href') or ''
        if 'uddg=' in href:
            try: href=unquote(parse_qs(urlparse(href).query).get('uddg',[''])[0])
            except: pass
        href=clean_url(href)
        if not href:continue
        if domains and not any(d in urlparse(href).netloc for d in domains):continue
        if href not in out:out.append(href)
        if len(out)>=limit:break
    return out

def tebeosfera_candidates(q):
    out=[]; series=q.get('series',''); issue=issue_norm(q.get('issue')); isbn=digits(q.get('isbn')); pub=q.get('publisher','')
    queries=[]
    if isbn:queries.append(f'site:tebeosfera.com "{isbn}"')
    queries += [f'site:tebeosfera.com "{series}" "{issue}" "{pub}"',f'site:tebeosfera.com "{series}" "{issue}"']
    urls=[]
    # direct site search first
    direct='https://www.tebeosfera.com/buscador/'+quote_plus(series)+'/'
    s,r=soup_from(direct)
    if s:
        for a in s.find_all('a',href=True):
            h=clean_url(a['href'],direct)
            if 'tebeosfera.com' in urlparse(h).netloc and h not in urls:urls.append(h)
    for query in queries:
        for u in ddg_links(query,['tebeosfera.com'],12):
            if u not in urls:urls.append(u)
    for u in urls[:24]:
        c=candidate_from_html(u,'Tebeosfera',q)
        if not c:continue
        d=c['data']
        if issue and d.get('issueNr') and issue_norm(d['issueNr'])!=issue:continue
        if series and series_score(series,d.get('title','')+' '+d.get('series',''))<0.45 and not (isbn and d.get('isbn')==isbn):continue
        out.append(c)
    return sorted(out,key=lambda x:x['score'],reverse=True)[:8]

def walk_urls(v):
    out=[]
    def w(o):
        if isinstance(o,str):
            if o.startswith(('http://','https://')):out.append(o)
        elif isinstance(o,list):
            for x in o:w(x)
        elif isinstance(o,dict):
            for k,val in o.items():
                if k.lower() in {'cover','image','image_url','url','file','scan','thumbnail','large','medium'}:w(val)
    w(v); return out

def gcd_candidates(q):
    out=[]; issue=issue_norm(q.get('issue')); series=q.get('series','')
    if not issue or not series:return out
    variants=[series]
    stage=q.get('stage','')
    if stage and norm(stage) not in norm(series):variants += [f'{series}: {stage}',f'{series} {stage}']
    if ':' in series:variants.append(series.split(':',1)[0])
    seen=set()
    for name in variants:
        u='https://www.comics.org/api/series/name/'+requests.utils.quote(name,safe='')+'/issue/'+requests.utils.quote(issue,safe='')+'/'
        r=get(u)
        if not r or r.status_code!=200:continue
        try:j=r.json()
        except:continue
        arr=j if isinstance(j,list) else j.get('results',[])
        for it in arr[:20]:
            d=it
            au=it.get('api_url') if isinstance(it,dict) else None
            if au:
                rr=get(au)
                if rr and rr.status_code==200:
                    try:d=rr.json()
                    except:pass
            actual=issue_norm(d.get('number') or d.get('issue_number') or '')
            if actual!=issue:continue
            ser=d.get('series_name') or name
            if series_score(series,ser)<0.45:continue
            isbn=digits(d.get('isbn') or d.get('barcode') or '')
            covers=walk_urls(d.get('cover'))
            if isinstance(d.get('cover'),str) and '/api/' in d.get('cover'):
                rr=get(d['cover'])
                if rr and rr.status_code==200:
                    try:covers+=walk_urls(rr.json())
                    except:pass
            cover=next((x for x in covers if re.search(r'\.(?:jpe?g|png|webp)(?:\?|$)',x,re.I)),covers[0] if covers else '')
            key=(ser,actual,isbn,cover)
            if key in seen:continue
            seen.add(key)
            stories=d.get('story_set') or []
            writers=', '.join(str(s.get('script')) for s in stories if isinstance(s,dict) and s.get('script'))
            artists=', '.join(str(s.get('pencils')) for s in stories if isinstance(s,dict) and s.get('pencils'))
            score=6000 + int(series_score(series,ser)*1500)
            if isbn and digits(q.get('isbn'))==isbn:score+=4000
            out.append({'source':'Grand Comics Database','score':score,'data':{'title':d.get('title') or d.get('descriptor') or ser,'publisher':q.get('publisher',''),'publicationDate':d.get('publication_date') or '','pages':d.get('page_count') or '','isbn':isbn,'series':ser,'issueNr':actual,'coverUrl':cover,'writer':writers,'artist':artists,'sourceUrl':au or u}})
        if out:break
    return sorted(out,key=lambda x:x['score'],reverse=True)[:8]

def web_candidates(q):
    out=[]; isbn=digits(q.get('isbn')); series=q.get('series',''); issue=issue_norm(q.get('issue')); pub=q.get('publisher','')
    queries=[]
    if isbn:queries.append(f'"{isbn}" comic {pub}')
    queries.append(f'"{series}" "{issue}" "{pub}" comic')
    preferred=['milcomics.com','whakoom.com','normacomics.com','universal-comics.com','metropolitancomics.es','eccediciones.com']
    seen=set()
    for query in queries:
        for u in ddg_links(query,None,15):
            host=urlparse(u).netloc.lower()
            if not any(d in host for d in preferred):continue
            if u in seen:continue
            seen.add(u)
            c=candidate_from_html(u,'Fuente española',q)
            if not c:continue
            d=c['data']
            if isbn and d.get('isbn') and digits(d['isbn'])!=isbn:continue
            if issue and d.get('issueNr') and issue_norm(d['issueNr'])!=issue:continue
            if series_score(series,d.get('title',''))<0.40 and not (isbn and d.get('isbn')==isbn):continue
            c['score'] += 3000
            out.append(c)
        if out:break
    return sorted(out,key=lambda x:x['score'],reverse=True)[:8]

def download_cover(url,key,index):
    if not url:return ''
    try:
        r=get(url,timeout=30,headers={'Referer':url})
        if not r or r.status_code!=200 or not r.content:return ''
        ct=(r.headers.get('content-type') or '').lower()
        if 'image' not in ct and len(r.content)<15000:return ''
        im=Image.open(BytesIO(r.content)).convert('RGB')
        im.thumbnail((900,1350),Image.LANCZOS)
        name=f'{key}-{index}.webp'; path=COVER_DIR/name
        im.save(path,'WEBP',quality=86,method=6)
        return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
    except Exception as e:
        print('COVER_ERROR',url,repr(e)); return ''

def valid(q,c):
    d=c.get('data',{}); wanted=issue_norm(q.get('issue'))
    if wanted and issue_norm(d.get('issueNr'))!=wanted:return False
    if q.get('series') and series_score(q['series'],d.get('series') or d.get('title'))<0.40:
        if not (digits(q.get('isbn')) and digits(d.get('isbn'))==digits(q.get('isbn'))):return False
    return bool(d.get('title') or d.get('isbn') or d.get('series'))

def process(req_path):
    q=json.loads(req_path.read_text(encoding='utf-8'))
    req_id=str(q.get('requestId') or req_path.stem)
    cache_key=str(q.get('cacheKey') or hashlib.sha1(json.dumps(q,sort_keys=True).encode()).hexdigest()[:24])
    print('PROCESS',req_id,q)
    # Priority: Tebeosfera -> GCD -> Spanish web fallbacks.
    cands=[]
    for producer in (tebeosfera_candidates,gcd_candidates,web_candidates):
        try:
            rows=producer(q)
            print('SOURCE',producer.__name__,'COUNT',len(rows))
            cands.extend(rows)
            # keep going: a later source may provide a downloadable cover while Tebeosfera supplies metadata
        except Exception as e: print('SOURCE_ERROR',producer.__name__,repr(e))
    # dedupe & rank
    best={}
    for c in cands:
        if not valid(q,c):continue
        d=c['data']; k=(digits(d.get('isbn')),norm(d.get('series')),issue_norm(d.get('issueNr')),norm(d.get('title')))
        if k not in best or c['score']>best[k]['score']:best[k]=c
    cands=sorted(best.values(),key=lambda x:x['score'],reverse=True)
    final=[]
    for i,c in enumerate(cands[:12]):
        d=c['data']; saved=download_cover(d.get('coverUrl'),cache_key,i)
        if not saved:continue
        d['originalCoverUrl']=d.get('coverUrl','');d['coverUrl']=saved;d['coverUrls']=[saved]
        final.append(c)
        if len(final)>=6:break
    payload={'ok':bool(final),'requestId':req_id,'cacheKey':cache_key,'query':q,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'candidates':final}
    (RES_DIR/f'{req_id}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    (CACHE_DIR/f'{cache_key}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print('RESULT',json.dumps(payload,ensure_ascii=False)[:3000])

if __name__=='__main__':
    files=sorted(REQ_DIR.glob('*.json'),key=lambda p:p.stat().st_mtime)
    if not files:
        print('No requests'); raise SystemExit(0)
    # process latest requests not already answered
    for p in files[-8:]:
        try:
            q=json.loads(p.read_text(encoding='utf-8')); rid=str(q.get('requestId') or p.stem)
            if (RES_DIR/f'{rid}.json').exists():continue
            process(p)
        except Exception as e:
            print('REQUEST_ERROR',p,repr(e))
