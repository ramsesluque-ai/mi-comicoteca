#!/usr/bin/env python3
import argparse, json, re, time, unicodedata, html as htmlmod
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse, parse_qs, unquote

import requests
from bs4 import BeautifulSoup
from PIL import Image

ROOT = Path(__file__).resolve().parent
OVERLAY = ROOT / 'bridge' / 'cache' / 'master-cover-overrides.json'
STATE = ROOT / 'bridge' / 'cache' / 'master-cover-tebeosfera-state.json'
COVERS = ROOT / 'bridge' / 'covers'
OWNER = 'ramsesluque-ai'
REPO = 'mi-comicoteca'
BRANCH = 'bridge-data'

S = requests.Session()
S.headers.update({
    'User-Agent': 'Mozilla/5.0 Chrome/153 MI-COMICOTECA-TEBEOSFERA/3.0',
    'Accept-Language': 'es-ES,es;q=0.9',
})

PUB_ALIASES = {
    'ecc': ['ecc ediciones', 'ecc'],
    'zinco': ['zinco'],
    'forum': ['forum', 'planeta deagostini', 'planeta-deagostini'],
    'panini': ['panini'],
    'planeta': ['planeta deagostini', 'planeta comic', 'planeta cómic'],
    'vertice': ['vertice', 'vértice'],
    'bruguera': ['bruguera'],
    'novaro': ['novaro'],
    'norma': ['norma editorial', 'norma'],
    'glenat': ['glenat', 'glénat'],
    'salvat': ['salvat'],
    'astiberri': ['astiberri'],
    'dibbuks': ['dibbuks'],
    'dolmen': ['dolmen'],
    'aleta': ['aleta'],
    'ivrea': ['ivrea'],
    'milky way': ['milky way'],
}


def norm(v):
    s = unicodedata.normalize('NFD', str(v or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'\s+', ' ', s).strip()


def code(v):
    return re.sub(r'[^0-9Xx]', '', str(v or '')).upper()


def issue_num(v):
    s = str(v or '').strip()
    return str(int(s)) if re.fullmatch(r'0*\d+', s) else ''


def canonical_series(v):
    s = norm(v)
    s = re.sub(r'\b(el\s+)?hombre\s+murcielago\b', 'batman', s)
    s = re.sub(r'\b(el\s+)?hombre\s+arana\b', 'spiderman', s)
    s = re.sub(r'\bspider[-\s]?man\b', 'spiderman', s)
    s = re.sub(r'\bsuper[-\s]?man\b', 'superman', s)
    s = re.sub(r'\b(ediciones?|editorial|novaro)\b', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def toks(v):
    stop = {'de','del','la','el','los','las','y','e','vol','volumen','serie','etapa','comic','comics'}
    return {x for x in canonical_series(v).split() if len(x) > 1 and x not in stop}


def series_score(a, b):
    A, B = toks(a), toks(b)
    if not A or not B:
        return 0.0
    return max(len(A & B) / len(A), len(A & B) / len(B))


def variants(series, stage=''):
    vals = []
    def add(x):
        x = ' '.join(str(x or '').split())
        if x and norm(x) not in [norm(v) for v in vals]:
            vals.append(x)
    add(series)
    c = canonical_series(series)
    if c == 'batman':
        add('Batman'); add('Batman el Hombre Murciélago')
    elif c == 'spiderman':
        add('Spider-Man'); add('Spiderman'); add('El Hombre Araña')
    elif c == 'superman':
        add('Superman'); add('Supermán')
    if stage:
        for v in list(vals):
            add(v + ' ' + str(stage))
    return vals[:8]


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def get(url, timeout=15, headers=None):
    try:
        return S.get(url, timeout=timeout, allow_redirects=True, headers=headers or {})
    except Exception:
        return None


def clean_url(u, base=''):
    u = htmlmod.unescape(str(u or '')).strip()
    if u.startswith('//'):
        u = 'https:' + u
    if base:
        u = urljoin(base, u)
    return u if u.startswith(('http://', 'https://')) else ''


def year_of(row):
    y = str(row.get('startYear') or '').strip()
    if re.fullmatch(r'19\d\d|20\d\d', y):
        return y
    mm = re.match(r'^(19\d\d|20\d\d)', str(row.get('publicationDate') or ''))
    return mm.group(1) if mm else ''


def pub_ok(pub, text):
    p, t = norm(pub), norm(text)
    for key, aliases in PUB_ALIASES.items():
        if key in p:
            return any(norm(a) in t for a in aliases)
    words = [x for x in re.findall(r'[a-z0-9]+', p) if len(x) >= 4]
    return not words or any(x in t for x in words)


def stage_ok(stage, text):
    if not stage:
        return True
    s, t = norm(stage), norm(text)
    marks = [x for x in ('aguila','avestruz','colibri','librocomic') if x in s]
    return not marks or any(x in t for x in marks)


def search_links(query, limit=12):
    out = []
    engines = [
        ('https://www.bing.com/search?q=', 'li.b_algo h2 a, h2 a'),
        ('https://html.duckduckgo.com/html/?q=', 'a.result__a, a.result-link'),
    ]
    for base, sel in engines:
        r = get(base + quote_plus(query), 15, {'Accept': 'text/html'})
        if not r or r.status_code not in (200, 202):
            continue
        soup = BeautifulSoup(r.text, 'html.parser')
        for a in soup.select(sel):
            u = a.get('href') or ''
            if 'uddg=' in u:
                try:
                    u = unquote(parse_qs(urlparse(u).query).get('uddg', [''])[0])
                except Exception:
                    pass
            u = clean_url(u)
            if not u or 'tebeosfera.com' not in urlparse(u).netloc.lower():
                continue
            if u not in out:
                out.append(u)
            if len(out) >= limit:
                return out
    return out


def candidate_links(row):
    n = issue_num(row.get('issueNr') or row.get('issue'))
    series = row.get('catalogHeader') or row.get('series') or ''
    pub = row.get('publisher') or ''
    stage = row.get('stage') or row.get('volume') or ''
    isbn = code(row.get('isbn') or row.get('barcode'))
    year = year_of(row)
    queries = []
    if len(isbn) in (10, 13):
        queries.append(f'site:tebeosfera.com "{isbn}"')
    for v in variants(series, stage):
        queries.append(f'site:tebeosfera.com "{v}" "{n}" "{pub}"')
        if stage:
            queries.append(f'site:tebeosfera.com "{v}" "{stage}" "{n}"')
        if year:
            queries.append(f'site:tebeosfera.com "{v}" "{n}" "{year}"')
    out = []
    for q in queries[:14]:
        for u in search_links(q, 10):
            if u not in out:
                out.append(u)
        if len(out) >= 24:
            break
    return out[:24]


def inspect_tebeosfera(url, row):
    r = get(url, 18, {'Referer': 'https://www.tebeosfera.com/'})
    if not r or r.status_code != 200:
        return None
    soup = BeautifulSoup(r.text, 'html.parser')
    txt = soup.get_text(' ', strip=True)
    mt = soup.find('meta', attrs={'property':'og:title'})
    title = (mt.get('content') or '').strip() if mt else (soup.title.get_text(' ', strip=True) if soup.title else '')
    md = soup.find('meta', attrs={'property':'og:description'}) or soup.find('meta', attrs={'name':'description'})
    desc = (md.get('content') or '').strip() if md else ''
    blob = title + ' ' + desc + ' ' + txt[:18000]

    n = issue_num(row.get('issueNr') or row.get('issue'))
    series = row.get('catalogHeader') or row.get('series') or ''
    pub = row.get('publisher') or ''
    stage = row.get('stage') or row.get('volume') or ''
    isbn = code(row.get('isbn') or row.get('barcode'))

    strong_isbn = len(isbn) in (10,13) and isbn in code(txt)
    exact_issue = bool(n and re.search(r'(?<!\d)0*' + re.escape(n) + r'(?!\d)', norm(title + ' ' + desc)))
    if not exact_issue and not strong_isbn:
        return None
    if series and series_score(series, blob) < (0.40 if strong_isbn else 0.55):
        return None
    if pub and not pub_ok(pub, txt):
        return None
    if not stage_ok(stage, blob):
        return None

    mi = soup.find('meta', attrs={'property':'og:image'})
    images = []
    if mi:
        images.append((20, clean_url(mi.get('content') or '', r.url)))
    for im in soup.find_all('img'):
        src = clean_url(im.get('data-src') or im.get('data-original') or im.get('data-lazy') or im.get('src') or '', r.url)
        if not src:
            continue
        hint = norm(' '.join([im.get('alt') or '', im.get('title') or '', src]))
        score = 0
        if any(x in hint for x in ('portada','cover','cubierta')):
            score += 10
        if 'logo' in hint or 'icon' in hint or 'avatar' in hint:
            score -= 30
        images.append((score, src))
    images = [(s,u) for s,u in images if u]
    if not images:
        return None
    images.sort(key=lambda x: x[0], reverse=True)
    return {'url': r.url, 'image': images[0][1], 'title': title, 'source': 'Tebeosfera'}


def save_image(url, sid):
    r = get(url, 25, {'Referer':'https://www.tebeosfera.com/'})
    if not r or r.status_code != 200 or not r.content:
        return ''
    try:
        im = Image.open(BytesIO(r.content)).convert('RGB')
        w, h = im.size
        if w < 120 or h < 160 or h <= w:
            return ''
        ratio = w / h
        if ratio < 0.40 or ratio > 0.90:
            return ''
        im.thumbnail((900,1350), Image.LANCZOS)
        COVERS.mkdir(parents=True, exist_ok=True)
        name = f'tebeosfera-{sid}.webp'
        im.save(COVERS / name, 'WEBP', quality=86, method=6)
        return f'https://raw.githubusercontent.com/{OWNER}/{REPO}/{BRANCH}/bridge/covers/{name}'
    except Exception:
        return ''


def resolve(row):
    sid = str(row.get('sourceId') or '').strip()
    for u in candidate_links(row):
        c = inspect_tebeosfera(u, row)
        if not c:
            continue
        stored = save_image(c['image'], sid)
        if stored:
            return {
                '_score': 40000,
                'coverUrl': stored,
                'isbn': code(row.get('isbn') or row.get('barcode')),
                'issueNr': issue_num(row.get('issueNr') or row.get('issue')),
                'pages': row.get('pages') or '',
                'publicationDate': row.get('publicationDate') or '',
                'publisher': row.get('publisher') or '',
                'series': row.get('catalogHeader') or row.get('series') or '',
                'volume': row.get('volume') or '',
                'stage': row.get('stage') or '',
                'startYear': str(row.get('startYear') or ''),
                'source': 'Tebeosfera · identidad bibliográfica',
                'sourceUrl': c['url'],
                'title': row.get('title') or c['title'],
                'sourceId': sid,
            }
    return None


def master_files(master, publisher_filter=''):
    base = Path(master)
    idx = load_json(base.parent / 'index.json', {})
    pubs = idx.get('publishers') or []
    wanted = norm(publisher_filter)
    if wanted:
        pubs = [p for p in pubs if wanted in norm(p.get('name') or p.get('publisher') or p.get('id') or '')]
    else:
        pubs = sorted(pubs, key=lambda p: (not bool(p.get('priority')), norm(p.get('name') or p.get('publisher') or '')))
    files = []
    for p in pubs:
        for rel in p.get('chunks') or []:
            fp = base.parent / rel
            if fp.exists():
                files.append(fp)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--master', required=True)
    ap.add_argument('--batch', type=int, default=30)
    ap.add_argument('--workers', type=int, default=2)
    ap.add_argument('--publisher', default='')
    ap.add_argument('--reset', action='store_true')
    a = ap.parse_args()

    files = master_files(a.master, a.publisher)
    overlay = load_json(OVERLAY, {})
    state = load_json(STATE, {})
    scope = norm(a.publisher) or '__all__'
    if a.reset or state.get('scope') != scope:
        state = {'scope': scope, 'fileIndex':0, 'rowIndex':0, 'scanned':0, 'linked':0, 'passes':0}

    fi = int(state.get('fileIndex') or 0)
    ri = int(state.get('rowIndex') or 0)
    targets, seen = [], set()
    scanned_this = 0
    max_scan = max(a.batch * 500, 15000)

    while len(targets) < a.batch and files and scanned_this < max_scan:
        if fi >= len(files):
            fi, ri = 0, 0
            state['passes'] = int(state.get('passes') or 0) + 1
        rows = load_json(files[fi], [])
        if not isinstance(rows, list):
            rows = []
        if ri >= len(rows):
            fi += 1; ri = 0; continue
        row = rows[ri]; ri += 1; scanned_this += 1
        state['scanned'] = int(state.get('scanned') or 0) + 1
        if not isinstance(row, dict):
            continue
        n = issue_num(row.get('issueNr') or row.get('issue'))
        sid = str(row.get('sourceId') or '').strip()
        if not n or not sid.isdigit() or sid in seen:
            continue
        seen.add(sid)
        old = overlay.get('gcd:' + sid) or {}
        if old.get('coverUrl') and 'tebeosfera' in norm(old.get('source')):
            continue
        targets.append(row)

    linked = 0
    workers = max(1, min(int(a.workers or 2), 6, len(targets) or 1))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(resolve, row): row for row in targets}
        for fut in as_completed(futures):
            row = futures[fut]
            sid = str(row.get('sourceId') or '')
            try:
                hit = fut.result()
            except Exception as e:
                print('TEBEOSFERA_ERROR', sid, repr(e))
                hit = None
            if not hit:
                print('TEBEOSFERA_MISS', sid, row.get('publisher'), row.get('catalogHeader') or row.get('series'), row.get('issueNr') or row.get('issue'))
                continue
            overlay['gcd:' + sid] = hit
            linked += 1
            state['linked'] = int(state.get('linked') or 0) + 1
            print('TEBEOSFERA_LINKED', sid, hit['publisher'], hit['series'], hit['issueNr'], hit['sourceUrl'])

    state.update({
        'scope': scope,
        'fileIndex': fi,
        'rowIndex': ri,
        'lastBatchChecked': len(targets),
        'lastBatchLinked': linked,
        'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    })
    OVERLAY.parent.mkdir(parents=True, exist_ok=True)
    OVERLAY.write_text(json.dumps(overlay, ensure_ascii=False, indent=2), encoding='utf-8')
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    print('TEBEOSFERA_PROGRESS', json.dumps(state, ensure_ascii=False))


if __name__ == '__main__':
    main()
