#!/usr/bin/env python3
"""Update a 2-month editorial feed using only short bibliographic facts.
Only publishers with an approved, robots-permitted public release page are parsed.
No image, blurb, page bulk export, nor complete publisher catalog is stored.
"""
from __future__ import annotations
from datetime import date
from pathlib import Path
from urllib.robotparser import RobotFileParser
from urllib.parse import urlparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / "master-data" / "editorial-monthly.json"
UA = "MI-COMICOTECA-EditorialReleases/1.0 (monthly single-page facts; no image download)"
MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]
HTTP = requests.Session()
HTTP.headers.update({"User-Agent": UA, "Accept":"text/html", "Accept-Language":"es-ES,es;q=0.9"})

def key(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}"

def shift(y: int, m: int, n: int) -> tuple[int,int]:
    i = y * 12 + m - 1 + n
    return i // 12, i % 12 + 1

def norm(v: str) -> str:
    v = unicodedata.normalize("NFKD", str(v or ""))
    return "".join(c for c in v if not unicodedata.combining(c)).lower().strip()

def allowed(url: str) -> bool:
    host=urlparse(url).hostname
    if host!="www.astiberri.com" or not url.startswith("https://"):
        return False
    try:
        r=RobotFileParser("https://www.astiberri.com/robots.txt")
        r.read()
        return bool(r.can_fetch(UA,url))
    except Exception as ex:
        print("ROBOTS_UNAVAILABLE",repr(ex),file=sys.stderr)
        return False

def astiberri(y: int, m: int) -> list[dict]:
    # One editorial release page per month only, not crawling or following its links.
    url=f"https://www.astiberri.com/posts/novedades-astiberri-{MONTHS[m-1]}{y%100:02d}"
    if not allowed(url):
        print("SKIP_ROBOTS",url)
        return []
    try:
        r=HTTP.get(url,timeout=15)
        if r.status_code!=200 or "text/html" not in r.headers.get("content-type",""):
            print("SOURCE_NOT_READY",r.status_code,url); return []
        if len(r.content)>1_500_000:
            print("SOURCE_TOO_LARGE",url);return []
    except requests.RequestException as ex:
        print("SOURCE_UNAVAILABLE",repr(ex));return []
    soup=BeautifulSoup(r.text,"html.parser")
    for tag in soup(["script","style","noscript","header","footer","nav"]):
        tag.decompose()
    lines=[re.sub(r"\s+"," ",t).strip() for t in soup.stripped_strings]
    out=[]
    pattern=re.compile(r"^a la venta el\s+(\d{1,2})\s+de\s+([a-záéíóúñ]+)",re.I)
    for i,line in enumerate(lines):
        match=pattern.match(line)
        if not match or i<2: continue
        day=int(match.group(1));date_month=norm(match.group(2))
        if day<1 or day>31 or date_month!=MONTHS[m-1]:continue
        # In the editorial's public bulletin, each sale line follows author then title.
        title=lines[i-2].strip()
        if not (4<=len(title)<=130) or norm(title).startswith(("a la venta","novedades","octubre","noviembre")): continue
        try:
            released=date(y,m,day)
        except ValueError:continue
        slug=hashlib.sha256(f"{y}-{m}-{title}".encode()).hexdigest()[:12]
        out.append({
            "id":f"ast-{y:04d}{m:02d}-{slug}",
            "publisher":"Astiberri",
            "month":key(y,m),
            "date":released.isoformat(),
            "title":title,
            "series":title,
            "sourceUrl":url,
            "rights":"bibliographic-facts-only",
            "coverUrl":""
        })
    unique={}
    for item in out:unique.setdefault(norm(item["title"]),item)
    print("ASTIBERRI",key(y,m),len(unique),"records")
    return list(unique.values())[:30]

def main() -> int:
    today=date.today()
    previous=shift(today.year,today.month,-1)
    next_month=shift(today.year,today.month,1)
    acceptable={key(*previous), key(today.year,today.month), key(*next_month)}
    data=json.loads(FEED.read_text(encoding="utf-8"))
    prior=data.get("releases",[])
    kept=[x for x in prior if isinstance(x,dict) and x.get("month") in acceptable and
          x.get("publisher") and x.get("sourceUrl") and not x.get("coverUrl")]
    seen={norm(x.get("publisher",""))+"|"+x.get("month","")+"|"+norm(x.get("title","")) for x in kept}
    additions=[]
    for y,m in (previous,(today.year,today.month),next_month):
        try:
            for item in astiberri(y,m):
                ident=norm(item["publisher"])+"|"+item["month"]+"|"+norm(item["title"])
                if ident not in seen:
                    seen.add(ident)
                    additions.append(item)
        except Exception as ex:
            print("SOURCE_ERROR",y,m,repr(ex),file=sys.stderr)
        time.sleep(1)
    data["releases"]=sorted(kept+additions,key=lambda x:(x.get("month",""),x.get("publisher",""),x.get("date",""),x.get("title","")))
    data["sourcePolicy"]="official-monthly-metadata-only-no-covers"
    data["lastChecked"]=today.isoformat()
    if data["releases"]!=prior or data.get("lastChecked")!=today.isoformat():
        FEED.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("MONTHLY_WINDOW",sorted(acceptable),"kept",len(kept),"added",len(additions),"published",len(data["releases"]))
    return 0

if __name__=="__main__":raise SystemExit(main())
