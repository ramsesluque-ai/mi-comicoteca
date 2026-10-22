#!/usr/bin/env python3
import os,re,json,time,hashlib,html as htmlmod,unicodedata
from pathlib import Path
from urllib.parse import quote_plus,urljoin,urlparse,parse_qs,unquote,quote
from io import BytesIO
import requests
from bs4 import BeautifulSoup
from PIL import Image

ROOT=Path(__file__).resolve().parent
REQ_DIR=ROOT/'bridge'/'requests'; RES_DIR=ROOT/'bridge'/'results'; CACHE_DIR=ROOT/'bridge'/'cache'; COVER_DIR=ROOT/'bridge'/'covers'
for p in (REQ_DIR,RES_DIR,CACHE_DIR,COVER_DIR): p.mkdir(parents=True,exist_ok=True)
OWNER='ramsesluque-ai'; REPO='mi-comicoteca'; BRANCH='bridge-data'
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 MI-COMICOTECA/2.0'
S=requests.Session(); S.headers.update({'User-Agent':UA,'Accept-Language':'es-ES,es;q=0.9,en;q=0.6'})

def norm(s):
    s=unicodedata.normalize('NFD',str(s or '')); s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'\s+',' ',s).strip()
def digits(s): return re.sub(r'[^0-9Xx]','',str(s or '')).upper()
def issue_norm(s):
    s=norm(s).replace('º','').replace('°','').replace(' ','')
    if re.fullmatch(r'0*\d+',s): return str(int(s))
    return s.lstrip('0') or s
def toks(s):
    stop={'de','del','la','el','los','las','y','e','vol','volumen','serie','etapa','ecc','ediciones','forum','zinco','panini','planeta','bruguera','novaro','renacimiento'}
    return {t for t in re.findall(r'[a-z0-9ñáéíóúü]+',norm(s)) if len(t)>1 and t not in stop}
def series_score(a,b):
    A,B=toks(a),toks(b)
    if not A or not B:return 0
    return max(len(A&B)/len(A),len(A&B)/len(B))

def get(url,timeout=25,headers=None,**kw):
    h={}; h.update(headers or {})
    try:
        r=S.get(url,timeout=timeout,allow_redirects=True,headers=h,**kw)
        print('HTTP',r.status_code,(r.headers.get('content-type') or '')[:50],url)
        return r
    except Exception as e:
        print('GET_ERROR',url,repr(e)); return None

def clean_url(u,base=''):
    u=htmlmod.unescape(str(u or '')).strip()
    if not u:return ''
    if u.startswith('//'):u='https:'+u
    if base:u=urljoin(base,u)
    return u if u.startswith(('http://','https://')) else ''
def soup_url(url):
    r=get(url)
    if not r or r.status_code!=200 or not r.text:return None,r
    return BeautifulSoup(r.text,'html.parser'),r
def meta(soup,key):
    if not soup:return ''
    el=soup.find('meta',attrs={'property':key}) or soup.find('meta',attrs={'name':key})
    return (el.get('content') or '').strip() if el else ''
def extract_isbn(text):
    for p in [r'(?:ISBN(?:-13)?|EAN)\s*[:\-]?\s*((?:97[89][\s\-]?)?\d[\d\s\-]{8,18}[\dXx])',r'\b(97[89][\d\s\-]{10,16}\d)\b']:
        m=re.search(p,text or '',re.I)
        if m:
            d=digits(m.group(1))
            if len(d) in (10,13):return d
    return ''
def extract_issue(text):
    text=str(text or '')
    pats=[r'(?:núm(?:ero)?|num(?:ero)?|n[º°o]\.?|#)\s*0*(\d{1,4})(?!\d)',r'\b0*(\d{1,3})\s*\(\s*renacimiento\s*\)',r'all[-\s]*star\s+batman\s+0*(\d{1,3})(?!\d)']
    for p in pats:
        m=re.search(p,text,re.I)
        if m:return str(int(m.group(1)))
    return ''
def extract_pages(text):
    m=re.search(r'\b(\d{1,4})\s*(?:p[aá]ginas|p[aá]gs?\.?|pp\.?|pages)\b',text or '',re.I); return m.group(1) if m else ''
def extract_date(text):
    m=re.search(r'\b((?:19|20)\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?\b',text or '')
    if m:return f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3) or 1):02d}'
    m=re.search(r'\b(\d{1,2})/((?:19|20)\d{2})\b',text or '')
    if m:return f'{m.group(2)}-{int(m.group(1)):02d}-01'
    return ''

def search_links_bing(query,domains=None,limit=15):
    r=get('https://www.bing.com/search?q='+quote_plus(query),headers={'Accept':'text/html'})
    if not r or r.status_code!=200:return []
    s=BeautifulSoup(r.text,'html.parser'); out=[]
    for a in s.select('li.b_algo h2 a, h2 a'):
        u=clean_url(a.get('href') or '')
        if not u:continue
        host=urlparse(u).netloc.lower()
        if domains and not any(d in host for d in domains):continue
        if u not in out:out.append(u)
        if len(out)>=limit:break
    print('BING',query,'=>',len(out)); return out

def search_links_ddg(query,domains=None,limit=15):
    r=get('https://html.duckduckgo.com/html/?q='+quote_plus(query),headers={'Accept':'text/html'})
    if not r or r.status_code!=200:return []
    s=BeautifulSoup(r.text,'html.parser'); out=[]
    for a in s.select('a.result__a, a.result-link'):
        u=a.get('href') or ''
        if 'uddg=' in u:
            try:u=unquote(parse_qs(urlparse(u).query).get('uddg',[''])[0])
            except:pass
        u=clean_url(u)
        if not u:continue
        host=urlparse(u).netloc.lower()
        if domains and not any(d in host for d in domains):continue
        if u not in out:out.append(u)
        if len(out)>=limit:break
    print('DDG',query,'=>',len(out)); return out

def search_links(query,domains=None,limit=15):
    out=[]
    for fn in (search_links_bing,search_links_ddg):
        for u in fn(query,domains,limit):
            if u not in out:out.append(u)
            if len(out)>=limit:return out
    return out

def candidate_html(url,source,q):
    s,r=soup_url(url)
    if not s:return None
    title=meta(s,'og:title') or (s.title.get_text(' ',strip=True) if s.title else '')
    desc=meta(s,'og:description') or meta(s,'description')
    text=s.get_text(' ',strip=True)
    isbn=extract_isbn(text) or (digits(q.get('isbn')) if digits(q.get('isbn')) and digits(q.get('isbn')) in digits(text) else '')
    issue=extract_issue(title+' '+desc+' '+text[:9000])
    cover=clean_url(meta(s,'og:image'),url)
    if not cover or 'logo' in norm(cover):
        best=[]
        for im in s.find_all('img'):
            src=clean_url(im.get('data-src') or im.get('data-lazy') or im.get('src') or '',url)
            if not src:continue
            hint=norm(' '.join([im.get('alt') or '',im.get('title') or '',src]))
            score=0
            if 'all-star' in hint:score+=5
            if issue_norm(q.get('issue')) and re.search(r'(?:^|[-_/])0*'+re.escape(issue_norm(q.get('issue')))+r'(?:[-_.?/]|$)',hint):score+=4
            if 'logo' in hint:score-=8
            if any(x in hint for x in ['medium_default','large_default','product','portada','cover']):score+=2
            best.append((score,src))
        if best:cover=max(best,key=lambda z:z[0])[1]
    publisher=q.get('publisher','')
    m=re.search(r'(?:Editorial|Editor)\s*[:\-]?\s*([^|·]{2,80})',text,re.I)
    if m:publisher=m.group(1).strip()
    return {'source':source,'score':0,'data':{'title':title,'publisher':publisher,'publicationDate':extract_date(text),'pages':extract_pages(text),'isbn':isbn,'series':q.get('series',''),'issueNr':issue,'coverUrl':cover,'sourceUrl':url}}

def score_candidate(q,c,base=0):
    d=c['data']; s=base
    if digits(q.get('isbn')) and digits(d.get('isbn'))==digits(q.get('isbn')):s+=5000
    if issue_norm(q.get('issue')) and issue_norm(d.get('issueNr'))==issue_norm(q.get('issue')):s+=3000
    s+=int(series_score(q.get('series'),(d.get('series') or '')+' '+(d.get('title') or ''))*1800)
    if norm(q.get('publisher')) and norm(q.get('publisher')) in norm((d.get('publisher') or '')+' '+(d.get('title') or '')):s+=500
    if d.get('coverUrl'):s+=800
    c['score']=s; return c

def valid(q,c):
    d=c.get('data',{}); wanted=issue_norm(q.get('issue')); qi=digits(q.get('isbn')); di=digits(d.get('isbn'))
    if qi and di and qi!=di:return False
    if wanted and issue_norm(d.get('issueNr'))!=wanted:return False
    if q.get('series') and series_score(q['series'],(d.get('series') or '')+' '+(d.get('title') or ''))<0.40:
        if not (qi and di==qi):return False
    return bool(d.get('coverUrl')) and bool(d.get('title') or d.get('isbn') or d.get('series'))

def tebeosfera(q):
    urls=[]; isbn=digits(q.get('isbn')); series=q.get('series',''); issue=issue_norm(q.get('issue')); pub=q.get('publisher','')
    qs=[]
    if isbn:qs.append(f'site:tebeosfera.com "{isbn}"')
    qs += [f'site:tebeosfera.com "{series}" "{issue}"',f'site:tebeosfera.com "{series}" "{pub}"']
    for x in qs:
        for u in search_links(x,['tebeosfera.com'],15):
            if u not in urls:urls.append(u)
    out=[]
    for u in urls[:25]:
        c=candidate_html(u,'Tebeosfera',q)
        if c:
            score_candidate(q,c,9000)
            if valid(q,c):out.append(c)
    print('TEBEOSFERA',len(out)); return sorted(out,key=lambda x:x['score'],reverse=True)[:8]

def gcd(q):
    series=q.get('series',''); issue=issue_norm(q.get('issue')); out=[]
    if not series or not issue:return out
    variants=[series]
    stage=q.get('stage','')
    if stage and norm(stage) not in norm(series):variants += [series+': '+stage,series+' '+stage]
    if ':' in series:variants.append(series.split(':',1)[0])
    for name in dict.fromkeys(variants):
        u='https://www.comics.org/api/series/name/'+quote(name,safe='')+'/issue/'+quote(issue,safe='')+'/?format=json'
        r=get(u,headers={'Accept':'application/json'})
        if not r or r.status_code!=200:continue
        try:j=r.json()
        except Exception as e:
            print('GCD_JSON_ERROR',repr(e),r.text[:120]); continue
        arr=j if isinstance(j,list) else (j.get('results') or [])
        print('GCD_ROWS',name,len(arr))
        for it in arr[:25]:
            d=it
            au=it.get('api_url') if isinstance(it,dict) else ''
            if au:
                sep='&' if '?' in au else '?'; rr=get(au+sep+'format=json',headers={'Accept':'application/json'})
                if rr and rr.status_code==200:
                    try:d=rr.json()
                    except:pass
            actual=issue_norm(d.get('number') or d.get('issue_number') or '')
            if actual!=issue:continue
            ser=d.get('series_name') or (d.get('series') or {}).get('name') if isinstance(d.get('series'),dict) else d.get('series_name') or name
            if series_score(series,ser)<0.40:continue
            isbn=digits(d.get('isbn') or d.get('barcode') or '')
            cover=''
            cv=d.get('cover')
            if isinstance(cv,str):
                if cv.startswith('http') and not '/api/' in cv:cover=cv
                elif '/api/' in cv:
                    rr=get(cv+('&' if '?' in cv else '?')+'format=json',headers={'Accept':'application/json'})
                    if rr and rr.status_code==200:
                        try:
                            cj=rr.json()
                            for k in ('image','image_url','file','url','large','medium','thumbnail'):
                                v=cj.get(k) if isinstance(cj,dict) else ''
                                if isinstance(v,str) and v.startswith('http'):cover=v;break
                        except:pass
            c={'source':'Grand Comics Database','score':0,'data':{'title':d.get('title') or d.get('descriptor') or ser,'publisher':q.get('publisher',''),'publicationDate':d.get('publication_date') or d.get('key_date') or '','pages':d.get('page_count') or '','isbn':isbn,'series':ser,'issueNr':actual,'coverUrl':cover,'sourceUrl':au or u}}
            score_candidate(q,c,6000)
            # Keep GCD even without cover: another Spanish source can supply cover; merge later by ISBN/issue.
            out.append(c)
        if out:break
    print('GCD',len(out)); return sorted(out,key=lambda x:x['score'],reverse=True)[:8]

def milcomics_direct(q):
    terms=[]; isbn=digits(q.get('isbn')); series=q.get('series',''); issue=issue_norm(q.get('issue'))
    if isbn:terms.append(isbn)
    terms.append(f'{series} {issue}')
    urls=[]
    for term in terms:
        for base in [f'https://www.milcomics.com/busqueda?controller=search&s={quote_plus(term)}',f'https://www.milcomics.com/module/iqitsearch/searchiqit?s={quote_plus(term)}']:
            s,r=soup_url(base)
            if not s:continue
            for a in s.find_all('a',href=True):
                u=clean_url(a.get('href'),base)
                if 'milcomics.com' not in urlparse(u).netloc:continue
                hint=norm((a.get_text(' ',strip=True) or '')+' '+u)
                if series_score(series,hint)>=0.35 or (isbn and isbn in digits(hint)):
                    if u not in urls:urls.append(u)
    out=[]
    for u in urls[:20]:
        c=candidate_html(u,'MilComics',q)
        if c:
            score_candidate(q,c,5000)
            if valid(q,c):out.append(c)
    print('MILCOMICS_DIRECT',len(out)); return sorted(out,key=lambda x:x['score'],reverse=True)[:8]

def spanish_web(q):
    out=[]; isbn=digits(q.get('isbn')); series=q.get('series',''); issue=issue_norm(q.get('issue')); pub=q.get('publisher','')
    preferred=['milcomics.com','whakoom.com','normacomics.com','universal-comics.com','metropolitancomics.es','eccediciones.com']
    qs=[]
    if isbn:qs.append(f'"{isbn}" comic')
    qs.append(f'"{series}" "{issue}" "{pub}" comic')
    urls=[]
    for x in qs:
        for u in search_links(x,preferred,20):
            if u not in urls:urls.append(u)
    for u in urls[:30]:
        c=candidate_html(u,'Fuente española',q)
        if c:
            score_candidate(q,c,4000)
            if valid(q,c):out.append(c)
    print('SPANISH_WEB',len(out)); return sorted(out,key=lambda x:x['score'],reverse=True)[:8]

def merge_candidates(q,groups):
    # Metadata from GCD can enrich a cover-bearing Spanish candidate for the same issue/ISBN.
    flat=[c for g in groups for c in g]
    enriched=[]
    for c in flat:
        if not c['data'].get('coverUrl'):continue
        d=dict(c['data'])
        for other in flat:
            od=other['data']
            same_isbn=digits(d.get('isbn')) and digits(d.get('isbn'))==digits(od.get('isbn'))
            same_issue=issue_norm(d.get('issueNr'))==issue_norm(od.get('issueNr')) and series_score(d.get('series'),od.get('series'))>=0.5
            if same_isbn or same_issue:
                for k in ('publisher','publicationDate','pages','isbn','series','title'):
                    if not d.get(k) and od.get(k):d[k]=od[k]
        x={'source':c['source'],'score':c['score'],'data':d}
        if valid(q,x):enriched.append(x)
    best={}
    for c in enriched:
        d=c['data']; k=(digits(d.get('isbn')),norm(d.get('series')),issue_norm(d.get('issueNr')),norm(d.get('title')))
        if k not in best or c['score']>best[k]['score']:best[k]=c
    return sorted(best.values(),key=lambda x:x['score'],reverse=True)

def download_cover(url,key,index):
    if not url:return ''
    try:
        r=get(url,timeout=30,headers={'Referer':url})
        if not r or r.status_code!=200 or not r.content:return ''
        im=Image.open(BytesIO(r.content)).convert('RGB'); im.thumbnail((900,1350),Image.LANCZOS)
        name=f'{key}-{index}.webp'; p=COVER_DIR/name; im.save(p,'WEBP',quality=86,method=6)
        return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
    except Exception as e:
        print('COVER_ERROR',url,repr(e)); return ''

def process(req_path):
    q=json.loads(req_path.read_text(encoding='utf-8')); rid=str(q.get('requestId') or req_path.stem); key=str(q.get('cacheKey') or hashlib.sha1(json.dumps(q,sort_keys=True).encode()).hexdigest()[:24])
    print('PROCESS_V2',rid,q)
    groups=[]
    for fn in (tebeosfera,gcd,milcomics_direct,spanish_web):
        try:groups.append(fn(q))
        except Exception as e:print('SOURCE_ERROR',fn.__name__,repr(e));groups.append([])
    cands=merge_candidates(q,groups); final=[]
    for i,c in enumerate(cands[:12]):
        saved=download_cover(c['data'].get('coverUrl'),key,i)
        if not saved:continue
        c['data']['originalCoverUrl']=c['data'].get('coverUrl',''); c['data']['coverUrl']=saved; c['data']['coverUrls']=[saved]
        final.append(c)
        if len(final)>=6:break
    payload={'ok':bool(final),'requestId':rid,'cacheKey':key,'query':q,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'candidates':final}
    (RES_DIR/f'{rid}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8'); (CACHE_DIR/f'{key}.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print('RESULT_V2',json.dumps(payload,ensure_ascii=False)[:5000])

if __name__=='__main__':
    files=sorted(REQ_DIR.glob('*.json'),key=lambda p:p.stat().st_mtime)
    for p in files[-12:]:
        try:
            q=json.loads(p.read_text(encoding='utf-8')); rid=str(q.get('requestId') or p.stem)
            # Reprocess when prior result is missing or failed, so extractor improvements can fix old requests.
            rp=RES_DIR/f'{rid}.json'
            if rp.exists():
                try:
                    old=json.loads(rp.read_text(encoding='utf-8'))
                    if old.get('ok'):continue
                except:pass
            process(p)
        except Exception as e:print('REQUEST_ERROR',p,repr(e))
