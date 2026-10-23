#!/usr/bin/env python3
"""Fast Tebeosfera cover crawler, collection by collection.

The Maestro is grouped by the user's exact collection identity:
Editorial + Cabecera + Volumen/Etapa + Año de inicio.

For unambiguous exact identities we fetch one Tebeosfera collection page and,
when necessary, its NKgal AJAX gallery with up to 300 issues per request. We
store only validated remote cover URLs, never bulk-copy the image library into
GitHub. Ambiguous identities are deliberately skipped for the slower exact
fallback, avoiding wrong covers.
"""
import argparse, hashlib, json, math, re, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
import master_cover_tebeosfera_fast as f
import master_cover_tebeosfera_first as m

ROOT = Path(__file__).resolve().parent
BASE = 'https://www.tebeosfera.com'
AJAX = BASE + '/neko/clases/NKGAL/NKgal_ajax.php'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 Chrome/153 MI-COMICOTECA-COLLECTIONS/1.0',
    'Accept-Language': 'es-ES,es;q=0.9',
}


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return default


def save_json(path, data):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def issue_num(row):
    return m.issue_num(row.get('issueNr') or row.get('issue'))


def first_year(row):
    ys = f.years(row)
    return ys[0] if ys else ''


def exact_key(row):
    return '|'.join([
        m.norm(row.get('publisher') or ''),
        m.norm(row.get('catalogHeader') or row.get('series') or ''),
        m.norm(row.get('volume') or ''),
        m.norm(row.get('stage') or ''),
        first_year(row),
    ])


def base_key(row):
    return '|'.join([
        m.norm(row.get('publisher') or ''),
        m.norm(row.get('catalogHeader') or row.get('series') or ''),
        first_year(row),
    ])


def read_master(master_dir):
    groups = {}
    base_to_exact = {}
    total_rows = 0
    for fp in sorted(Path(master_dir).glob('*.json')):
        rows = load_json(fp, [])
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            total_rows += 1
            sid = str(row.get('sourceId') or '').strip()
            n = issue_num(row)
            if not sid.isdigit() or not n or not first_year(row):
                continue
            ek = exact_key(row)
            bk = base_key(row)
            groups.setdefault(ek, []).append(row)
            base_to_exact.setdefault(bk, set()).add(ek)
    keys = sorted(groups)
    ambiguous = {ek for eks in base_to_exact.values() if len(eks) > 1 for ek in eks}
    return groups, keys, ambiguous, total_rows


def collection_candidates(row):
    ss = f.series_slugs(row)
    ys = f.years(row)
    ps = f.publisher_slugs(row.get('publisher') or '')
    if not ss or not ys or not ps:
        return []
    combos = []
    preferred = [
        (0,0,0),(1,0,0),(0,0,1),(2,0,0),(0,1,0),(1,0,1),
        (3,0,0),(0,0,2),(1,1,0),(2,0,1),
    ]
    for si,yi,pi in preferred:
        if si < len(ss) and yi < len(ys) and pi < len(ps):
            u = f'{BASE}/colecciones/{ss[si]}_{ys[yi]}_{ps[pi]}.html'
            if u not in combos:
                combos.append(u)
    return combos[:10]


def collection_page_ok(row, response, soup):
    if response.status_code != 200 or not soup:
        return False
    gal = choose_gallery(soup)
    if not gal:
        return False
    title = soup.title.get_text(' ', strip=True) if soup.title else ''
    meta = soup.find('meta', attrs={'property':'og:title'})
    if meta and meta.get('content'):
        title += ' ' + meta.get('content')
    text = soup.get_text(' ', strip=True)[:12000]
    series = row.get('catalogHeader') or row.get('series') or ''
    pub = row.get('publisher') or ''
    if series and m.series_score(series, title + ' ' + text) < 0.48:
        return False
    if pub and not m.pub_ok(pub, text):
        return False
    y = first_year(row)
    if y and y not in response.url and y not in text:
        return False
    return True


def choose_gallery(soup):
    galleries = soup.select('div.nkgal-galeria[data-tabla="T3_numeros"]')
    if not galleries:
        return None
    scored = []
    for g in galleries:
        gid = g.get('data-id') or ''
        panel = g.find_parent(attrs={'role':'tabpanel'})
        active = 1 if panel is not None and not panel.has_attr('hidden') else 0
        cat = 1 if (g.get('data-galeria') or '').upper() == 'CATEGORIA' else 0
        pag = 1 if (g.get('data-paginacion-tipo') or '') == 'paginas' else 0
        selector = soup.select_one(f'#NKgal_rpp{gid}') if gid else None
        total = int((selector.get('data-total') if selector else '') or 0)
        scored.append((active, cat, pag, total, g))
    scored.sort(key=lambda x: x[:4], reverse=True)
    return scored[0][4]


def image_src(img, base_url):
    if not img:
        return ''
    u = img.get('data-src') or img.get('data-original') or img.get('data-lazy') or img.get('src') or ''
    u = urljoin(base_url, u)
    # NKgal AJAX uses resized paths .../<stem>/w-200_<stem>.jpg. Tebeosfera's
    # original is the sibling .../<stem>.jpg; prefer it without extra requests.
    try:
        path = urlparse(u).path
        mm = re.search(r'/([^/]+)/w-\d+_([^/]+)$', path, re.I)
        if mm and mm.group(2).split('.')[0].lower() == mm.group(1).lower():
            original_path = path[:mm.start()] + '/' + mm.group(2)
            parts = urlparse(u)
            u = parts._replace(path=original_path).geturl()
    except Exception:
        pass
    return u


def extract_cards(container, base_url):
    out = {}
    if container is None:
        return out
    for a in container.select('a[href*="/numeros/"]'):
        href = urljoin(base_url, a.get('href') or '')
        mm = re.search(r'_([0-9]+)\.html(?:$|[?#])', href, re.I)
        if not mm:
            continue
        n = str(int(mm.group(1)))
        img = a.find('img')
        if not img:
            parent = a.parent
            for _ in range(4):
                if parent is None: break
                img = parent.find('img')
                if img: break
                parent = parent.parent
        cover = image_src(img, base_url)
        if cover and n not in out:
            out[n] = {'coverUrl': cover, 'sourceUrl': href}
    return out


def ajax_all(session, soup, gal, base_url, initial):
    gid = gal.get('data-id') or ''
    if not gid:
        return initial
    selector = soup.select_one(f'#NKgal_rpp{gid}')
    pag = soup.select_one(f'.nkgal-paginacion[data-id="{gid}"]')
    src = pag or gal
    total = int((selector.get('data-total') if selector else '') or 0)
    if total <= len(initial):
        return initial
    max_rpp = int((selector.get('data-max') if selector else '') or src.get('data-selector-rpp-max') or 300)
    rpp = max(1, min(300, max_rpp, total))
    pages = max(1, math.ceil(total / rpp))
    out = dict(initial)
    for page in range(1, pages + 1):
        data = {
            'action':'buscar_NKgal_categoria','id':gid,'tabla_tabla':gal.get('data-tabla') or 'T3_numeros',
            'q':'','pagina':str(page),'rpp':str(rpp),
            'paginacion_tipo':'paginas','paginacion_modo':src.get('data-modo') or gal.get('data-paginacion-modo') or 'ajax',
            'galeria_tipo':src.get('data-galeria') or gal.get('data-galeria') or 'CATEGORIA',
            'carrusel_token':src.get('data-carrusel-token') or gal.get('data-carrusel-token') or '',
            'modo_carrusel':gal.get('data-modo-carrusel') or 'mixto',
            'selector_rpp_max':str(max_rpp),
            'selector_rpp_opciones':src.get('data-selector-rpp-opciones') or gal.get('data-selector-rpp-opciones') or '[50,100,200,300]',
            'selector_rpp_posicion':src.get('data-selector-rpp-posicion') or gal.get('data-selector-rpp-posicion') or 'controles',
            'adaptar_orientacion':src.get('data-adaptar-orientacion') or gal.get('data-adaptar-orientacion') or '1',
            'orientacion_portadas':src.get('data-orientacion-portadas') or gal.get('data-orientacion-portadas') or 'vertical',
            'orden':src.get('data-order') or gal.get('data-order') or 'numero ASC',
        }
        legend = src.get('data-pie-leyenda') or gal.get('data-pie-leyenda') or ''
        if legend: data['pie_leyenda'] = legend
        rr = session.post(AJAX, data=data, timeout=30, headers={'Referer':base_url,'X-Requested-With':'XMLHttpRequest'})
        if rr.status_code != 200:
            break
        try:
            j = rr.json()
        except Exception:
            break
        if int(j.get('ok') or 0) != 1:
            break
        out.update(extract_cards(BeautifulSoup(j.get('html') or '', 'html.parser'), base_url))
        if int(j.get('has_more') or 0) == 0 and page >= pages:
            break
    return out


def fetch_collection(row):
    session = requests.Session(); session.headers.update(HEADERS)
    for url in collection_candidates(row):
        try:
            r = session.get(url, timeout=18, allow_redirects=True)
        except Exception:
            continue
        if r.status_code != 200:
            continue
        soup = BeautifulSoup(r.text, 'html.parser')
        if not collection_page_ok(row, r, soup):
            continue
        gal = choose_gallery(soup)
        gid = gal.get('data-id') or ''
        container = soup.select_one(f'#nkgal-galeria-{gid}') if gid else gal
        cards = extract_cards(container, r.url)
        cards = ajax_all(session, soup, gal, r.url, cards)
        if cards:
            return r.url, cards
    return '', {}


def make_entry(row, card, collection_url):
    sid = str(row.get('sourceId') or '').strip()
    return {
        'coverUrl': card['coverUrl'],
        'source': 'Tebeosfera · colección',
        'sourceUrl': card.get('sourceUrl') or collection_url,
        'sourceId': sid,
        'issueNr': issue_num(row),
        'publisher': row.get('publisher') or '',
        'series': row.get('catalogHeader') or row.get('series') or '',
        'volume': row.get('volume') or '',
        'stage': row.get('stage') or '',
        'startYear': first_year(row),
        '_score': 50000,
    }


def process_group(key, rows, ambiguous):
    rep = rows[0]
    if key in ambiguous:
        return {'key':key,'status':'ambiguous','entries':{},'collectionUrl':'','issues':0}
    url, cards = fetch_collection(rep)
    if not cards:
        return {'key':key,'status':'miss','entries':{},'collectionUrl':url,'issues':0}
    entries = {}
    matched = 0
    for row in rows:
        n = issue_num(row)
        card = cards.get(n)
        sid = str(row.get('sourceId') or '').strip()
        if not card or not sid.isdigit():
            continue
        entries['gcd:' + sid] = make_entry(row, card, url)
        matched += 1
    return {'key':key,'status':'hit' if matched else 'miss','entries':entries,'collectionUrl':url,'issues':matched,'cards':len(cards)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--master', required=True)
    ap.add_argument('--shard-index', type=int, required=True)
    ap.add_argument('--shard-count', type=int, default=4)
    ap.add_argument('--batch', type=int, default=150)
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    if a.shard_index < 0 or a.shard_index >= a.shard_count:
        raise SystemExit('invalid shard')

    groups, all_keys, ambiguous, total_rows = read_master(a.master)
    shard_keys = [k for pos,k in enumerate(all_keys) if pos % a.shard_count == a.shard_index]
    state_path = ROOT / 'bridge' / 'cache' / f'master-cover-collection-shard-{a.shard_index}-state.json'
    overlay_path = ROOT / 'bridge' / 'cache' / f'master-cover-collection-shard-{a.shard_index}-overrides.json'
    state = load_json(state_path, {})
    overlay = load_json(overlay_path, {})
    cursor = int(state.get('cursor') or 0)
    if cursor >= len(shard_keys):
        state.update({'complete':True,'cursor':len(shard_keys),'groupsTotal':len(shard_keys),'masterRows':total_rows,'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
        save_json(state_path,state); save_json(overlay_path,overlay)
        print('COLLECTION_SWEEP_COMPLETE',json.dumps(state,ensure_ascii=False)); return

    batch_keys = shard_keys[cursor:cursor + max(1,a.batch)]
    workers = max(1,min(a.workers,8,len(batch_keys) or 1))
    stats = {'hit':0,'miss':0,'ambiguous':0,'linked':0}
    results = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(process_group,k,groups[k],ambiguous): k for k in batch_keys}
        for fut in as_completed(futs):
            k = futs[fut]
            try: res = fut.result()
            except Exception as e:
                print('COLLECTION_ERROR',k,repr(e)); res={'key':k,'status':'miss','entries':{},'issues':0}
            results[k] = res
            st = res.get('status') or 'miss'; stats[st] = stats.get(st,0)+1
            stats['linked'] += len(res.get('entries') or {})
            print('COLLECTION_RESULT',st,len(res.get('entries') or {}),res.get('collectionUrl') or '',k)

    # Apply in deterministic key order, irrespective of worker completion order.
    for k in batch_keys:
        res = results.get(k) or {}
        overlay.update(res.get('entries') or {})

    cursor += len(batch_keys)
    state.update({
        'shard':a.shard_index,'shardCount':a.shard_count,'cursor':cursor,'groupsTotal':len(shard_keys),
        'groupsProcessed':int(state.get('groupsProcessed') or 0)+len(batch_keys),
        'collectionsHit':int(state.get('collectionsHit') or 0)+stats['hit'],
        'collectionsMiss':int(state.get('collectionsMiss') or 0)+stats['miss'],
        'collectionsAmbiguous':int(state.get('collectionsAmbiguous') or 0)+stats['ambiguous'],
        'linked':int(state.get('linked') or 0)+stats['linked'],
        'lastBatch':len(batch_keys),'lastLinked':stats['linked'],'masterRows':total_rows,
        'complete':cursor >= len(shard_keys),
        'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
    })
    save_json(overlay_path,overlay); save_json(state_path,state)
    print('COLLECTION_PROGRESS',json.dumps(state,ensure_ascii=False))


if __name__ == '__main__':
    main()
