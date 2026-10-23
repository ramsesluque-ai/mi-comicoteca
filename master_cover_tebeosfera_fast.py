#!/usr/bin/env python3
"""Tebeosfera-first cover resolver.

Primary discovery no longer depends on Bing/DDG. Tebeosfera issue URLs are
constructed directly from the catalogue identity (series + start year +
publisher + issue number). Collection pages are also inspected for issue links.
Search engines remain only as a last-resort fallback.
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
    'ecc': ['ecc'],
    'forum': ['forum'],
    'panini': ['panini'],
    'vertice': ['vertice'],
    'vértice': ['vertice'],
    'bruguera': ['bruguera'],
    'novaro': ['novaro'],
    'zinco': ['zinco'],
    'norma': ['norma'],
    'glenat': ['glenat'],
    'glénat': ['glenat'],
    'astiberri': ['astiberri'],
    'aleta': ['aleta'],
}


def slug(v):
    s = m.norm(v)
    s = re.sub(r'\b(ediciones?|editorial)\b', ' ', s)
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')
    return re.sub(r'_+', '_', s)


def publisher_slugs(pub):
    p = m.norm(pub)
    vals = []
    def add(x):
        x = slug(x)
        if x and x not in vals:
            vals.append(x)
    for key, aliases in PUB_SLUG_ALIASES.items():
        if m.norm(key) in p or p in m.norm(key):
            for a in aliases:
                add(a)
    add(pub)
    # Tebeosfera usually omits generic company suffixes.
    add(re.sub(r'\b(s\.?a\.?|s\.?l\.?)\b', ' ', str(pub or ''), flags=re.I))
    return vals[:5]


def series_slugs(row):
    series = row.get('catalogHeader') or row.get('series') or ''
    stage = row.get('stage') or ''
    vals = []
    def add(x):
        x = slug(x)
        if x and x not in vals:
            vals.append(x)
    add(series)
    # Parenthetical qualifiers and volume labels are frequently absent from
    # Tebeosfera's canonical collection slug.
    add(re.sub(r'\([^)]*\)', ' ', str(series)))
    add(re.sub(r'\b(vol\.?|volumen|serie|etapa)\s*\d+\b', ' ', str(series), flags=re.I))
    for v in m.variants(series, stage)[:4]:
        add(v)
    return vals[:6]


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
    y = m.year_of(row)
    add(y)
    return vals


def fast_search_links(query, limit=6):
    """Fallback only. Direct Tebeosfera catalogue URLs are preferred."""
    out = []
    engines = [
        ('https://www.bing.com/search?q=', 'li.b_algo h2 a, h2 a'),
        ('https://html.duckduckgo.com/html/?q=', 'a.result__a, a.result-link'),
    ]
    for base, selector in engines:
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
            if not u or 'tebeosfera.com' not in urlparse(u).netloc.lower():
                continue
            if u not in out:
                out.append(u)
            if len(out) >= limit:
                return out
        if out:
            break
    return out[:limit]


def issue_href_matches(href, n):
    path = urlparse(href).path.lower()
    return bool(re.search(r'_' + re.escape(str(n)) + r'\.html$', path))


def direct_catalog_links(row):
    n = m.issue_num(row.get('issueNr') or row.get('issue'))
    if not n:
        return []
    ss = series_slugs(row)
    ps = publisher_slugs(row.get('publisher') or '')
    ys = years(row)
    out = []
    def add(u):
        if u and u not in out:
            out.append(u)

    # Canonical number URLs observed in Tebeosfera:
    # /numeros/alegres_historietas_1970_bruguera_13.html
    for s in ss:
        for y in ys:
            for p in ps:
                add(f'{BASE}/numeros/{s}_{y}_{p}_{n}.html')

    # If the exact issue slug differs slightly, inspect the canonical
    # collection page and reuse its /numeros/ links.
    for s in ss[:3]:
        for p in ps[:3]:
            for y in ys[:2]:
                collection = f'{BASE}/obras/publicaciones/{s}_{p}_{y}.html'
                r = m.get(collection, 10, {'Referer': BASE + '/'})
                if not r or r.status_code != 200:
                    continue
                soup = BeautifulSoup(r.text, 'html.parser')
                for a in soup.select('a[href*="/numeros/"]'):
                    u = urljoin(r.url, a.get('href') or '')
                    if issue_href_matches(u, n):
                        add(u)
                if len(out) >= 20:
                    break
            if len(out) >= 20:
                break
        if len(out) >= 20:
            break
    return out[:24]


def fast_candidate_links(row):
    # 1) Direct deterministic Tebeosfera URLs.
    out = direct_catalog_links(row)

    # 2) Only if needed, fall back to indexed discovery.
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
    for q in queries[:3]:
        for u in fast_search_links(q, 6):
            if u not in out:
                out.append(u)
    return out[:30]


# Patch the base resolver while retaining its strict Tebeosfera page/image
# validation and storage pipeline.
m.search_links = fast_search_links
m.candidate_links = fast_candidate_links

if __name__ == '__main__':
    m.main()
