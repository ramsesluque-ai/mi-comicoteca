#!/usr/bin/env python3
"""Audit the existing Spain Maestro snapshot without changing bibliographic records."""
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
base = ROOT / "master-data"
index = json.loads((base / "index.json").read_text(encoding="utf-8"))
rows = []
for publisher in index.get("publishers", []):
    for chunk in publisher.get("chunks", []):
        path = base / chunk
        if not path.is_file():
            raise SystemExit(f"Missing chunk: {path}")
        rows.extend(json.loads(path.read_text(encoding="utf-8")))
missing_cover = lambda x: not str(x.get("coverUrl") or "").strip()
missing_source = lambda x: not str(x.get("source") or x.get("sourceUrl") or "").strip()
counts = {}
for row in rows:
    name = str(row.get("publisher") or "Sin editorial")
    item = counts.setdefault(name, {"issues": 0, "missingCover": 0, "missingSource": 0, "missingIsbn": 0})
    item["issues"] += 1
    item["missingCover"] += int(missing_cover(row))
    item["missingSource"] += int(missing_source(row))
    item["missingIsbn"] += int(not str(row.get("isbn") or "").strip())
report = {
    "snapshot": index.get("snapshot"),
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "scope": "Existing master-data snapshot only; not a completeness claim for all comics published in Spain",
    "issues": len(rows),
    "publishers": len(counts),
    "missingCover": sum(x["missingCover"] for x in counts.values()),
    "missingSource": sum(x["missingSource"] for x in counts.values()),
    "missingIsbn": sum(x["missingIsbn"] for x in counts.values()),
    "byPublisher": [{"publisher": name, **values} for name, values in sorted(counts.items(), key=lambda x: -x[1]["missingCover"])]
}
# Prioritize missing covers without inventing matches or importing unlicensed images.
priority = ["Forum", "Zinco", "Novaro", "Panini", "Norma", "Bruguera", "Vértice", "ECC", "Planeta / DeAgostini"]
report["priorityEditorials"] = [
    {"publisher": name, **counts[name], "coverCompletionPct": round(100 * (counts[name]["issues"] - counts[name]["missingCover"]) / counts[name]["issues"], 2)}
    for name in priority if name in counts
]
report["priorityMissingCovers"] = sum(x["missingCover"] for x in report["priorityEditorials"])
import csv
with (base / "coverage-priority.csv").open("w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["publisher", "issues", "missingCover", "missingSource", "missingIsbn", "coverCompletionPct"])
    writer.writeheader()
    writer.writerows(report["priorityEditorials"])
dest = base / "coverage-audit.json"
dest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{len(rows)} issues, {len(counts)} publishers, {report['missingCover']} missing covers")
