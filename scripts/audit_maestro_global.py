#!/usr/bin/env python3
"""Read-only full Maestro audit. No downloads, scraping or database writes."""
import collections, csv, json, pathlib, re
root=pathlib.Path("master-data")
index=json.loads((root/"index.json").read_text())
overrides=json.loads((root/"cover-overrides.json").read_text()) if (root/"cover-overrides.json").exists() else {}
out=pathlib.Path("audit-output");out.mkdir(exist_ok=True)
issues=[]; by_isbn=collections.defaultdict(list); by_group=collections.defaultdict(list)
tot=collections.Counter(); per=collections.defaultdict(collections.Counter)
def norm(x): return re.sub(r"\\s+"," ",str(x or "").strip()).casefold()
for publisher in index["publishers"]:
 for chunk in publisher["chunks"]:
  for r in json.loads((root/chunk).read_text()):
   pub=r.get("publisher") or publisher["publisher"]; p=per[pub];tot["records"]+=1;p["records"]+=1
   isbn=re.sub(r"[^0-9X]","",str(r.get("isbn") or "").upper())
   if isbn and isbn!="-1":by_isbn[isbn].append(r)
   else:tot["missing_isbn"]+=1;p["missing_isbn"]+=1
   group=(norm(pub),norm(r.get("catalogHeader") or r.get("series")),norm(r.get("volume")),norm(r.get("stage")),norm(r.get("startYear")))
   by_group[group].append(r)
   if not (r.get("coverUrl") or r.get("coverData")):tot["without_direct_cover"]+=1;p["without_direct_cover"]+=1
   else:tot["with_direct_cover"]+=1;p["with_direct_cover"]+=1
   if not (r.get("catalogHeader") or r.get("series")):tot["missing_series"]+=1;p["missing_series"]+=1
   if not r.get("publicationDate"):tot["missing_date"]+=1;p["missing_date"]+=1
   if not r.get("issueNr") or str(r.get("issueNr"))=="-1":tot["missing_issue"]+=1;p["missing_issue"]+=1
for isbn,rr in by_isbn.items():
 if len(rr)>1:
  groups={ (norm(r.get("publisher")),norm(r.get("catalogHeader") or r.get("series")),norm(r.get("volume")),norm(r.get("startYear"))) for r in rr}
  if len(groups)>1:issues.append({"kind":"same_isbn_different_group","isbn":isbn,"count":len(rr),"ids":";".join(str(r.get("id","")) for r in rr[:30]),"groups":str(sorted(groups)[:6])})
for group,rr in by_group.items():
 if len(rr)>1:
  num=collections.defaultdict(list)
  for r in rr:
   n=norm(r.get("issueNr"))
   if n and n not in ("[nn]","-1"):num[n].append(r)
  for n,records in num.items():
   if len(records)>1:
    isbns={re.sub(r"[^0-9X]","",str(r.get("isbn") or "").upper()) for r in records}
    if len(isbns)>1:issues.append({"kind":"same_issue_multiple_editions_review","isbn":";".join(sorted(isbns)),"count":len(records),"ids":";".join(str(r.get("id","")) for r in records[:30]),"groups":str(group)+" issue "+n})
# Overrides are candidates only; never imply permission or an available binary image.
approved=0;pending=0
for v in overrides.values():
 if not isinstance(v,dict):continue
 if str(v.get("coverReuseStatus","")).lower() in ("authorized","approved","licensed","public_domain"):approved+=1
 else:pending+=1
summary={"scope":"Static Maestro publisher chunks only; excludes live user contributions and private CoverVault","records":tot["records"],"publishers":len(per),"groups":len(by_group),"direct_cover_present":tot["with_direct_cover"],"direct_cover_missing":tot["without_direct_cover"],"potential_cover_gap_pct":round(100*tot["without_direct_cover"]/max(1,tot["records"]),2),"override_entries":len(overrides),"override_marked_approved":approved,"override_unverified_or_pending":pending,"cross_group_isbn_anomalies":sum(i["kind"]=="same_isbn_different_group" for i in issues),"edition_review_cases":sum(i["kind"]=="same_issue_multiple_editions_review" for i in issues),"other_counts":dict(tot),"note":"No online image recovery performed; number of recoverable covers is unknown. No files or records modified."}
(out/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2))
with (out/"review.csv").open("w",newline="",encoding="utf-8") as f:
 w=csv.DictWriter(f,fieldnames=["kind","isbn","count","ids","groups"]);w.writeheader();w.writerows(issues)
with (out/"publishers.csv").open("w",newline="",encoding="utf-8") as f:
 w=csv.writer(f);w.writerow(["publisher","records","direct_cover_present","direct_cover_missing","missing_isbn"])
 for name,c in sorted(per.items()):w.writerow([name,c["records"],c["with_direct_cover"],c["without_direct_cover"],c["missing_isbn"]])
print(json.dumps(summary,ensure_ascii=False,indent=2))
