#!/usr/bin/env python3
"""MI COMICOTECA · carga reanudable del Maestro a Supabase.

Diseñado para los lotes generados por export_master_supabase.py.
Solo escribe master_series y master_comics. Nunca toca user_comics ni cover_history.
Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.

Por seguridad, por defecto hace dry-run. Para escribir hay que pasar --apply.
El estado se guarda localmente en un checkpoint JSON para poder reanudar sin repetir
lotes ya confirmados. Los upserts hacen además la operación idempotente.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ALLOWED_TABLES = {"master_series", "master_comics"}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_checkpoint(path: Path, done: set[str]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps({"completed": sorted(done)}, indent=2), encoding="utf-8")
    tmp.replace(path)


def discover_batches(root: Path):
    """Descubre exactamente el formato plano producido por export_master_supabase.py."""
    files = []
    for table in ("master_series", "master_comics"):
        files.extend((table, p) for p in sorted(root.glob(f"{table}_*.json")))
    return files


def request_upsert(url: str, key: str, table: str, rows, timeout: int) -> None:
    if table not in ALLOWED_TABLES:
        raise RuntimeError(f"Refusing write to non-master table: {table}")
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?on_conflict=id"
    payload = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(endpoint, data=payload, method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if not (200 <= resp.status < 300):
            raise RuntimeError(f"Supabase returned HTTP {resp.status}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("export_dir", type=Path, help="Directorio del artefacto exportado")
    ap.add_argument("--apply", action="store_true", help="Realiza escrituras; sin esto solo valida")
    ap.add_argument("--checkpoint", type=Path, default=Path(".master-import-checkpoint.json"))
    ap.add_argument("--retries", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=60)
    args = ap.parse_args()

    batches = discover_batches(args.export_dir)
    if not batches:
        print("ERROR: no master_series_*.json/master_comics_*.json batches found", file=sys.stderr)
        return 2

    done: set[str] = set()
    if args.checkpoint.exists():
        done.update(load_json(args.checkpoint).get("completed", []))

    total_rows = 0
    table_counts = {"master_series": 0, "master_comics": 0}
    for table, path in batches:
        rows = load_json(path)
        if not isinstance(rows, list) or not rows:
            raise RuntimeError(f"Invalid/empty batch: {path}")
        if any(not isinstance(r, dict) or not r.get("id") for r in rows):
            raise RuntimeError(f"Batch contains row without id: {path}")
        total_rows += len(rows)
        table_counts[table] += len(rows)

    print(f"Validated {len(batches)} batches / {total_rows} rows; series={table_counts['master_series']} comics={table_counts['master_comics']}; completed checkpoint={len(done)}")
    if not args.apply:
        print("DRY RUN: no remote writes performed. Use --apply explicitly to import.")
        return 0

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply", file=sys.stderr)
        return 2

    for table, path in batches:
        token = path.name
        if token in done:
            continue
        rows = load_json(path)
        for attempt in range(1, args.retries + 1):
            try:
                request_upsert(url, key, table, rows, args.timeout)
                break
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
                if attempt == args.retries:
                    raise
                wait = min(2 ** (attempt - 1), 8)
                print(f"Retry {attempt}/{args.retries} for {token}: {exc}; waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
        done.add(token)
        save_checkpoint(args.checkpoint, done)
        print(f"OK {token}: {len(rows)} rows")

    print(f"Import complete: {len(done)} batches checkpointed. Run postflight_master_import.sql next.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
