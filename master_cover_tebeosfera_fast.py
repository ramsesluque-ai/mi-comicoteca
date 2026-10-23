#!/usr/bin/env python3
"""Fast Tebeosfera-first cover resolver.

Resolution order:
1. Deterministic Tebeosfera /numeros URL from catalogue identity.
2. Tebeosfera /colecciones page links.
3. Legacy collection paths when needed.
4. Search-engine fallback restricted to tebeosfera.com/numeros.

Tebeosfera remains the source of truth. ISBN is optional.
"""
import re
from urllib.parse import quote_plus, urlparse, parse_qs, unquote, urljoin
from bs4 import BeautifulSoup
import master_cover_tebeosfera_first as m

BASE = 'https://www.tebeosfera.com'

PUB_SLUG_ALIASES = {
    'planeta / deagostini': ['planeta_deagostini', 'planeta_de_agostini', 'planeta'],
    'planeta deagostini': ['planeta_deagostini', 'planeta_de_agostini', 'planeta'],
    'ediciones b': ['ediciones_b', 'b'],
    'ecc': ['ecc'], 'forum': ['forum'], 'panini': ['panini'],
    'vertice': ['vertice'], 'vértice': ['vertice'], 'bruguera': ['bruguera'],
    'novaro': ['novaro'], 'zinco': ['zinco'], 'norma': ['norma'],
    'glenat': ['glenat'], 'glénat': ['glenat'], 'astiberri': ['astiberri'],
    'aleta': ['aleta'],
}


def _clean_generic_words(s):
    return re.sub(r'\b(ediciones?|editorial)\b', ' ', s, flags=re.I)


def plain_slug(v):
    s = _clean_generic_words(m.norm(v))
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')
    return re.sub(r'_+', '_', s)


def tebeosfera_slug_variants(v):
    """Return conservative URL-slug variants used by Tebeosfera.

    Tebeosfera sometimes preserves a full stop where the printed title has a
    colon (e.g. "2001: La Odisea del Espacio" ->
    "2001._la_odisea_del_espacio"). Keeping both variants avoids guessing a
    single canonical spelling.
    """
    raw = _clean_generic_words(m.norm(v))
    vals = []

    def add(s):
        s = re.sub(r'_+', '_', str(s or '')).strip('_')
        if s and s not in vals:
            vals.append(s)

    add(re.sub(r'[^a-z0-9]+', '_', raw))

    # Colon/semicolon punctuation is commonly represented by a dot before the
    # underscore-separated remainder of the title.
    punct = raw.replace(':', '.').replace(';', '.')
    punct = re.sub(r'[^a-z0-9.]+', '_', punct)
    punct = re.sub(r'\.+', '.', punct)
    add(punct)

    # Also retain literal dots already present in abbreviations/numeric titles.
    dotted = re.sub(r'[^a-z0-9.]+', '_', raw)
    dotted = re.sub(r'\.+', '.', dotted)
    add(dotted)
    return vals[:4]


def publisher_slugs(pub):
    p = m.norm(pub)
    vals = []

    def add(x):
        for s in tebeosfera_slug_variants(x):
            if s and s not in vals:
                vals.append(s)

    for key, aliases in PUB_SLUG_ALIASES.items():
        if m.norm(key) in p or p in m.norm(key):
            for a in aliases:
                add(a)
    add(pub)
    add(re.sub(r'\b(s\.?a\.?|s\.?l\.?)\b', ' ', str(pub or ''), flags=re.I))
    return vals[:6]


def series_slugs(row):
    series = row.get('catalogHeader') or row.get('series') or ''
    stage = row.get('stage') or ''
    vals = []

    def add(x):
        for s in tebeosfera_slug_variants(x):
            if s and s not in vals:
                vals.append(s)

    add(series)
    add(re.sub(r'\([^)]*\)', ' ', str(series)))
    add(re.sub(r'\b(vol\.?|volumen|serie|etapa)\s*\d+\b', ' ', str(series), flags=re.I))
    for v in m.variants(series, stage)[:4]:
        add(v)
    return vals[:10]


def years(row):
    vals = []

    def add(y):
        y = str(y or '').strip()
        if re.fullmatch(r'(?:19|20)\d{2}', y) and y not in vals:
            vals.append(y)

    add(row.get('startYear'))
    mm = re.search(r'((?:19|20)\d{2})', str(row.get('publicationDate') or ''))
    if mm:
        add(mm.group(1))
    add(m.year_of(row))
    return vals


def direct_issue_links(row):
    n = m.issue_num(row.get('issueNr') or row.get('issue'))
    if not n:
        return []
    out = []
    for s in series_slugs(row):
        for y in years(row):
            for p in publisher_slugs(row.get('publisher') or ''):
                u = f'{BASE}/numeros/{s}_{y}_{p}_{n}.html'
                if u not in out:
                    out.append(u)
    return out[:30]


def issue_href_matches(href, n):
    path = urlparse(href).path.lower()
    return bool(re.search(r'_' + re.escape(str(n)) + r'\.html$', path))


def _links_from_collection(url, n):
    r = m.get(url, 10, {'Referer': BASE + '/'})
    if not r or r.status_code != 200:
        return []
    soup = BeautifulSoup(r.text, 'html.parser')
    out = []
    for a in soup.select('a[href*="/numeros/"]'):
        u = urljoin(r.url, a.get('href') or '')
        label = m.norm(a.get_text(' ', strip=True))
        if issue_href_matches(u, n) or re.search(r'(?<!\d)0*' + re.escape(str(n)) + r'(?!\d)', label):
            if u not in out:
                out.append(u)
    return out


def collection_issue_links(row):
    n = m.issue_num(row.get('issueNr') or row.get('issue'))
    if not n:
        return []
    ss = series_slugs(row)
    ps = publisher_slugs(row.get('publisher') or '')
    ys = years(row)

    # Current canonical Tebeosfera collection format:
    # /colecciones/2001._la_odisea_del_espacio_1978_bruguera.html
    for s in ss[:6]:
        for y in ys[:3]:
            for p in ps[:4]:
                u = f'{BASE}/colecciones/{s}_{y}_{p}.html'
                found = _links_from_collection(u, n)
                if found:
                    return found[:12]

    # Older pages still exist for some catalogue families.
    for s in ss[:4]:
        for p in ps[:3]:
            for y in ys[:2]:
                u = f'{BASE}/obras/publicaciones/{s}_{p}_{y}.html'
                found = _links_from_collection(u, n)
                if found:
                    return found[:12]
    return []


def fast_search_links(query, limit=6):
    out = []
    for base, selector in [
        ('https://www.bing.com/search?q=', 'li.b_algo h2 a, h2 a'),
        ('https://html.duckduckgo.com/html/?q=', 'a.result__a, a.result-link'),
    ]:
        r = m.get(base + quote_plus(query), 8, {'Accept': 'text/html'})
        if not r or r.status_code not in (200, 202):
            continue
        soup = BeautifulSoup(r.text, 'html.parser')
        for a in soup.select(selector):
            u = a.get('href') or ''
            if 'uddg=' in u:
                try:
                    u = unquote(parse_qs(urlparse(u).query).get('uddg', [''])[0])
                except Exception:
                    pass
            u = m.clean_url(u)
            if not u or 'tebeosfera.com' not in urlparse(u).netloc.lower() or '/numeros/' not in u:
                continue
            if u not in out:
                out.append(u)
            if len(out) >= limit:
                return out
        if out:
            break
    return out[:limit]


def fallback_links(row):
    n = m.issue_num(row.get('issueNr') or row.get('issue'))
    series = row.get('catalogHeader') or row.get('series') or ''
    pub = row.get('publisher') or ''
    isbn = m.code(row.get('isbn') or row.get('barcode'))
    year = m.year_of(row)
    queries = []
    if len(isbn) in (10, 13):
        queries.append(f'site:tebeosfera.com/numeros "{isbn}"')
    queries.append(f'site:tebeosfera.com/numeros "{series}" "{n}" "{pub}"')
    if year:
        queries.append(f'site:tebeosfera.com/numeros "{series}" "{n}" "{year}"')
    out = []
    for q in queries[:3]:
        for u in fast_search_links(q, 6):
            if u not in out:
                out.append(u)
    return out[:12]


def make_hit(row, sid, candidate, stored):
    return {
        '_score': 50000,
        'coverUrl': stored,
        'isbn': m.code(row.get('isbn') or row.get('barcode')),
        'issueNr': m.issue_num(row.get('issueNr') or row.get('issue')),
        'pages': row.get('pages') or '',
        'publicationDate': row.get('publicationDate') or '',
        'publisher': row.get('publisher') or '',
        'series': row.get('catalogHeader') or row.get('series') or '',
        'volume': row.get('volume') or '',
        'stage': row.get('stage') or '',
        'startYear': str(row.get('startYear') or ''),
        'source': 'Tebeosfera · URL directa validada',
        'sourceUrl': candidate['url'],
        'title': row.get('title') or candidate.get('title') or '',
        'sourceId': sid,
    }


def try_links(row, sid, links, label):
    for u in links:
        c = m.inspect_tebeosfera(u, row)
        if not c:
            continue
        stored = m.save_image(c['image'], sid)
        if stored:
            print('TEBEOSFERA_DIRECT_HIT', label, sid, u)
            return make_hit(row, sid, c, stored)
    return None


def fast_resolve(row):
    sid = str(row.get('sourceId') or '').strip()
    hit = try_links(row, sid, direct_issue_links(row), 'direct')
    if hit:
        return hit
    hit = try_links(row, sid, collection_issue_links(row), 'collection')
    if hit:
        return hit
    return try_links(row, sid, fallback_links(row), 'search')


m.search_links = fast_search_links
m.candidate_links = lambda row: direct_issue_links(row) + collection_issue_links(row) + fallback_links(row)
m.resolve = fast_resolve

if __name__ == '__main__':
    m.main()
