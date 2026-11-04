#!/usr/bin/env python3
"""Import MI COMICOTECA master data into the existing Supabase schema.
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as GitHub Actions secrets.
Idempotent UUIDv5 keys; never touches profiles, user_comics, or user-covers.
"""
import json, os, pathlib, time, uuid, urllib.request, urllib.error, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]/"master-data"
URL=os.environ["SUPABASE_URL"].rstrip("/")
KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
NAMESPACE=uuid.UUID("0f6f9348-6ab1-4fb5-bc6d-4dbca3d2d407")
def stable(s): return str(uuid.uuid5(NAMESPACE,s))
def request(table,rows):
    if not rows:return
    payload=json.dumps(rows,ensure_ascii=False).encode()
    url=URL+"/rest/v1/"+table+"?on_conflict=id"
    headers={"apikey":KEY,"Authorization":"Bearer "+KEY,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"}
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,data=payload,headers=headers,method="POST"),timeout=90) as res:
                if res.status not in (200,201,204):raise RuntimeError("Unexpected HTTP status "+str(res.status))
            return
        except urllib.error.HTTPError as exc:
            detail=exc.read().decode()[:1000]
            if exc.code not in (429,500,502,503,504) or attempt==5:raise RuntimeError(f"{table}: HTTP {exc.code}: {detail}") from exc
            time.sleep(2**attempt)
        except (TimeoutError,urllib.error.URLError):
            if attempt==5:raise
            time.sleep(2**attempt)
def chunks(items,size=250):
    for i in range(0,len(items),size):yield items[i:i+size]
def date(v):
    if not v:return None
    try:
        parts=v.split("-")
        if len(parts)!=3 or "00" in parts:return None
        return datetime.date.fromisoformat(v).isoformat()
    except (ValueError,TypeError):return None
def year(v):
    try:
        y=int(v)
        return y if 1400<=y<=2100 else None
    except (TypeError,ValueError):return None
def series_key(r):
    return "|".join([str(r.get("publisher") or "").strip().casefold(),str(r.get("catalogHeader") or r.get("series") or "").strip().casefold(),str(r.get("volume") or "").strip().casefold(),str(r.get("stage") or "").strip().casefold(),str(year(r.get("startYear")) or "")])
def main():
    manifest=json.loads((ROOT/"index.json").read_text())
    files=sorted(set(c for p in manifest["publishers"] for c in p["chunks"]))
    series_seen=set(); comics_seen=set(); total=0; series_total=0
    for idx,rel in enumerate(files,1):
        rows=json.loads((ROOT/rel).read_text())
        series=[];comics=[]
        for r in rows:
            key=series_key(r)
            sid=stable("series|"+key)
            if sid not in series_seen:
                series_seen.add(sid);series_total+=1
                series.append({"id":sid,"publisher":r.get("publisher") or "Sin editorial","title":r.get("catalogHeader") or r.get("series") or "Sin cabecera","volume":str(r.get("volume") or ""),"stage":str(r.get("stage") or ""),"volume_stage":" · ".join(filter(None,[str(r.get("volume") or ""),str(r.get("stage") or "")])),"start_year":year(r.get("startYear"))})
            source_id=str(r.get("sourceId") or r.get("id") or "").strip()
            uid=stable("comic|"+str(r.get("source") or "")+"|"+source_id) if source_id else stable("comic|"+key+"|"+str(r.get("issueNr") or r.get("issue") or "")+"|"+str(r.get("isbn") or ""))
            if uid in comics_seen:continue
            comics_seen.add(uid);total+=1
            comics.append({"id":uid,"series_id":sid,"issue_number":str(r.get("issueNr") or r.get("issue") or ""),"title":r.get("title") or None,"publication_date":date(r.get("publicationDate")),"isbn":r.get("isbn") or None,"barcode":r.get("barcode") or None,"cover_url":r.get("coverUrl") or None,"metadata":{"source":r.get("source"),"sourceId":source_id,"masterSnapshot":r.get("masterSnapshot"),"pages":r.get("pages"),"format":r.get("format")}})
        for batch in chunks(series):request("master_series",batch)
        for batch in chunks(comics):request("master_comics",batch)
        if idx%20==0 or idx==len(files):print(f"{idx}/{len(files)} files; {series_total} series, {total} comics",flush=True)
    print(f"IMPORT FINISHED: {series_total} series and {total} comics. Expected snapshot: {manifest.get('totalSeries')} series / {manifest.get('totalIssues')} issues.")
if __name__=="__main__":main()
