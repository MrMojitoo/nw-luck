import pandas as pd
from pathlib import Path
import json

CSV_MAP = {
    "items": "S9_extract_items_20250820.csv",
    "loot_tables": "S9_extract_loot-tables_20250820.csv",
    "loot_buckets": "S9_extract_loot-buckets_20250820.csv",
    "loot_limits": "S9_extract_loot-limits_20250820.csv",
}

def load_csv_safely(path: Path) -> pd.DataFrame:
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(path, encoding=enc)  # retire low_memory ici
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

def main(in_dir=".", out_dir="data"):
    in_dir = Path(in_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for key, filename in CSV_MAP.items():
        src = in_dir / filename
        df = load_csv_safely(src)
        df = normalize_cols(df)
        # Convert NaN -> null for JSON
        records = json.loads(df.to_json(orient="records"))
        out = out_dir / f"{key}.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        print(f"Wrote {out}")

if __name__ == "__main__":
    main()
