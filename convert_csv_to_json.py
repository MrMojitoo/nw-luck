import pandas as pd
from pathlib import Path
import json, re, argparse, sys

# -------- CLI --------
parser = argparse.ArgumentParser(description="Convert NW CSVs to sharded JSON for GitHub Pages.")
parser.add_argument("--in", dest="in_dir", default=".", help="Folder where CSV files live (default: current folder)")
parser.add_argument("--out", dest="out_dir", default="data", help="Output folder for JSON (default: data)")
args = parser.parse_args()

IN_DIR = Path(args.in_dir).resolve()
OUT_DIR = Path(args.out_dir).resolve()
OUT_DIR.mkdir(parents=True, exist_ok=True)

# CSV file names (unchanged)
CSV_MAP = {
    "items": "S9_extract_items_20250820.csv",
    "loot_tables": "S9_extract_loot-tables_20250820.csv",
    "loot_buckets": "S9_extract_loot-buckets_20250820.csv",
    "loot_limits": "S9_extract_loot-limits_20250820.csv",
}

def find_csv(name: str) -> Path:
    """Find CSV by exact name under IN_DIR (top-level or common subfolders)."""
    candidates = [
        IN_DIR / name,
        IN_DIR / "csv" / name,
        IN_DIR / "data" / name,
        IN_DIR / "raw" / name,
        IN_DIR / "inputs" / name,
    ]
    for p in candidates:
        if p.exists():
            return p
    # last resort: slow recursive search (one level deep)
    for p in IN_DIR.rglob(name):
        return p
    raise FileNotFoundError(f"Could not find '{name}' under {IN_DIR}. "
                            f"Place your CSVs there or pass --in PATH.")

def load_csv_safely(path: Path) -> pd.DataFrame:
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(path, encoding=enc, low_memory=False)
        except Exception:
            continue
    return pd.read_csv(path, encoding="utf-8", engine="python")

def normalize_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].map(lambda x: x.strip() if isinstance(x, str) else x)
    return df

def norm_header(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', s.lower())

def shard_key_from_id(item_id: str) -> str:
    if not item_id:
        return "misc"
    c = str(item_id)[0].lower()
    if "a" <= c <= "z" or "0" <= c <= "9":
        return c
    return "misc"

def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)  # compact

def convert_items():
    src = find_csv(CSV_MAP["items"])
    print(f"[items] Reading: {src}")
    df = load_csv_safely(src)
    df = normalize_cols(df)

    header_map = {norm_header(c): c for c in df.columns}

    id_col   = next((header_map[k] for k in ("itemid","id") if k in header_map), None)
    name_col = next((header_map[k] for k in ("name","displayname","itemname") if k in header_map), None)
    type_col = next((header_map[k] for k in ("itemtypename","type","itemtype","category") if k in header_map), None)
    tier_col = next((header_map[k] for k in ("tier","t") if k in header_map), None)
    icon_col = next((header_map[k] for k in ("icon","iconpath","image","iconfile") if k in header_map), None)

    if not id_col:
        raise RuntimeError(f"Missing required column(s) in items CSV: {{'id'}}. "
                           f"Normalized headers present: {list(header_map.keys())}")

    records = []
    for _, row in df.iterrows():
        rec = {"id": "" if pd.isna(row[id_col]) else str(row[id_col])}
        if name_col and pd.notna(row[name_col]): rec["n"] = str(row[name_col])
        if type_col and pd.notna(row[type_col]): rec["t"] = str(row[type_col])
        if tier_col and pd.notna(row[tier_col]):
            try: rec["tr"] = int(row[tier_col])
            except Exception: rec["tr"] = str(row[tier_col])
        if icon_col and pd.notna(row[icon_col]): rec["ic"] = str(row[icon_col])
        records.append(rec)

    # shard by first char
    shards = {}
    for rec in records:
        shards.setdefault(shard_key_from_id(rec["id"]), []).append(rec)

    items_dir = OUT_DIR / "items"
    manifest = {"files": {}, "count": len(records)}
    for key, arr in shards.items():
        filename = f"items_{key}.json"
        write_json(items_dir / filename, arr)
        manifest["files"][key] = filename
    write_json(items_dir / "manifest.json", manifest)
    print(f"[items] {manifest['count']} records, {len(shards)} shards -> {items_dir}/")

def convert_simple(key):
    src = find_csv(CSV_MAP[key])
    print(f"[{key}] Reading: {src}")
    df = load_csv_safely(src)
    df = normalize_cols(df)
    records = json.loads(df.to_json(orient="records"))
    out = OUT_DIR / f"{key}.json"
    write_json(out, records)
    print(f"[{key}] {len(records)} records -> {out}")

def main():
    print(f"Input dir: {IN_DIR}")
    print(f"Output dir: {OUT_DIR}")
    convert_items()
    convert_simple("loot_tables")
    convert_simple("loot_buckets")
    convert_simple("loot_limits")
    print("Done.")

if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as e:
        print("\nERROR:", e)
        print("\nTips:")
        print(" - Put your CSVs in the folder you pass with --in")
        print(" - Or place them next to the script, then run without --in")
        print(" - Current working dir:", Path.cwd())
        sys.exit(1)
