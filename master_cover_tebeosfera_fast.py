#!/usr/bin/env python3
"""Fast Tebeosfera-first wrapper.
Keeps the strict bibliographic validation from master_cover_tebeosfera_first,
but drastically reduces redundant search-engine requests per comic.
"""
from urllib.parse import quote_plus, urlparse, parse_qs, unquote
from bs4 import BeautifulSoup
import master_cover_tebeosfera_first as m


def fast_search_links(query, limit=8):
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
                break
        # A few good Bing candidates are enough; DDG is fallback only.
        if len(out) >= 3:
            break
    return out[:limit]


def fast_candidate_links(row):
    n = m.issue_num(row.get('issueNr') or row.get('issue'))
    series = row.get('catalogHeader') or row.get('series') or ''
    pub = row.get('publisher') or ''
    stage = row.get('stage') or row.get('volume') or ''
    isbn = m.code(row.get('isbn') or row.get('barcode'))
    year = m.year_of(row)

    names = m.variants(series, stage)
    primary = names[0] if names else series
    queries = []
    if len(isbn) in (10, 13):
        queries.append(f'site:tebeosfera.com "{isbn}"')
    queries.append(f'site:tebeosfera.com "{primary}" "{n}" "{pub}"')
    if stage:
        queries.append(f'site:tebeosfera.com "{primary}" "{stage}" "{n}"')
    elif year:
        queries.append(f'site:tebeosfera.com "{primary}" "{n}" "{year}"')

    # One canonical alias query only when the normalized title differs.
    if len(names) > 1 and m.norm(names[1]) != m.norm(primary):
        queries.append(f'site:tebeosfera.com "{names[1]}" "{n}" "{pub}"')

    out = []
    for q in queries[:4]:
        for u in fast_search_links(q, 8):
            if u not in out:
                out.append(u)
        if len(out) >= 12:
            break
    return out[:12]


m.search_links = fast_search_links
m.candidate_links = fast_candidate_links

if __name__ == '__main__':
    m.main()
