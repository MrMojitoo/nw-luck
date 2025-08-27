import pandas as pd
from pathlib import Path
import json, re, argparse, sys
import math

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
    "loot_tables": "LootTables.csv",
    "loot_buckets": "LootBuckets.csv",
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

def _is_empty(x):
    return x is None or (isinstance(x, float) and math.isnan(x)) or (isinstance(x, str) and x.strip() in ("", "—"))

def norm_header(s: str) -> str: return re.sub(r'[^a-z0-9]+', '', s.lower())


def shard_key_from_id(item_id: str) -> str:
    if not item_id:
        return "misc"
    c = str(item_id)[0].lower()
    if "a" <= c <= "z" or "0" <= c <= "9":
        return c
    return "misc"

def _shard_key_from_itemid(item_id: str) -> str:
    if not item_id:
        return "misc"
    c = str(item_id)[0].lower()
    if "a" <= c <= "z" or "0" <= c <= "9":
        return c
    return "misc"

def _json_sanitize(x):
    """Convertit NaN/NaT en None, strings vides en None quand pertinent."""
    if x is None:
        return None
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Sanitize profonde (évite NaN dans le JSON final)
    def deep_clean(obj):
        if isinstance(obj, dict):
            return {k: deep_clean(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [deep_clean(v) for v in obj]
        return _json_sanitize(obj)
    clean = deep_clean(data)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

def convert_items():
    src = find_csv(CSV_MAP["items"])
    print(f"[items] Reading: {src}")
    df = load_csv_safely(src)
    df = normalize_cols(df)

    header_map = {norm_header(c): c for c in df.columns}
    # debug: montre les headers normalisés (utile si ça re-bloque un jour)
    # print("[items] headers(normalized) =", list(header_map.keys()))

    id_col    = next((header_map[k] for k in ("itemid","id") if k in header_map), None)
    name_col  = next((header_map[k] for k in ("name","displayname","itemname") if k in header_map), None)
    type_col  = next((header_map[k] for k in ("itemtypename","type","itemtype","category") if k in header_map), None)
    tier_col  = next((header_map[k] for k in ("tier","t") if k in header_map), None)
    rarity_col = next((header_map[k] for k in ("rarity","itemrarity") if k in header_map), None)
    # colonne "Item Class" (tags séparés par virgules ; on veut savoir si "Named" est présent)
    itemclass_col = next((header_map[k] for k in ("itemclass","item class") if k in header_map), None)

    # --- Icône : plusieurs stratégies de détection ---
    # 1) clés connues (normalisées)
    icon_col = next((header_map[k] for k in ("iconpath","icon path","icon","image","iconfile","iconurl","icon_url") if k in header_map), None)

    # 2) si rien : toute colonne dont le header normalisé contient "icon" ou "image"
    if icon_col is None:
        name_candidates = [c for c in df.columns if ("icon" in norm_header(c)) or ("image" in norm_header(c))]
        # 3) si toujours rien : heuristique sur le contenu (valeurs finissant par .webp/.png/.jpg)
        content_candidates = []
        rx_img = re.compile(r'\.(webp|png|jpg|jpeg)(\?.*)?$', re.I)
        sample_n = min(len(df), 500)
        for c in df.columns:
            hit = 0
            series = df[c].head(sample_n)
            for v in series:
                if isinstance(v, str) and rx_img.search(v.strip()):
                    hit += 1
            if hit >= max(3, sample_n // 50):  # au moins quelques hits
                content_candidates.append((hit, c))
        content_candidates.sort(reverse=True)  # le plus de hits d'abord
        # Choix final par priorité : name_candidates en premier, sinon content_candidates
        if name_candidates:
            # privilégie celles contenant "path" si possible
            name_candidates.sort(key=lambda c: ( "path" not in norm_header(c), len(norm_header(c)) ))
            icon_col = name_candidates[0]
        elif content_candidates:
            icon_col = content_candidates[0][1]
    # 4) dernier filet de sécurité : si une colonne EXACTE "Icon Path" existe (casse insensible)
    if icon_col is None:
        for c in df.columns:
            if str(c).strip().lower() == "icon path":
                icon_col = c
                break
 
    # Log de debug : quelle colonne a été trouvée pour les icônes
    print(f"[items] icon column detected: {icon_col!r}")

    if not id_col:
        raise RuntimeError(f"Missing required column(s) in items CSV: {{'id'}}. "
                           f"Normalized headers present: {list(header_map.keys())}")

    records = []
    icon_count = 0
    for _, row in df.iterrows():
        rec = {"id": "" if pd.isna(row[id_col]) else str(row[id_col])}
        if name_col and pd.notna(row[name_col]): rec["n"] = str(row[name_col])
        if type_col and pd.notna(row[type_col]): rec["t"] = str(row[type_col])
        if tier_col and pd.notna(row[tier_col]):
            try: rec["tr"] = int(row[tier_col])
            except Exception: rec["tr"] = str(row[tier_col])
        # rarity: keep a compact, normalized token (common/uncommon/rare/epic/legendary/artifact)
        if rarity_col and pd.notna(row[rarity_col]):
            rv = str(row[rarity_col]).strip().lower()
            # normalize some variants
            MAP = {
                "common":"common","uncommon":"uncommon","rare":"rare",
                "epic":"epic","legendary":"legendary","artifact":"artifact",
                "artifacts":"artifact","mythic":"artifact"
            }
            rec["ry"] = MAP.get(rv, rv)  # fallback to raw lowercased value
        if icon_col and (icon_col in df.columns):
            v = row[icon_col]
            if isinstance(v, str):
                val = v.strip()
                if val:
                    rec["ic"] = val
                    icon_count += 1
            elif pd.notna(v):
                rec["ic"] = str(v)
                icon_count += 1
        
        # Flag "named" (pour le style CSS .named)
        if itemclass_col and pd.notna(row[itemclass_col]):
            raw = str(row[itemclass_col])
            # on coupe sur virgule / point-virgule / pipe
            parts = re.split(r"[,\|;]", raw)
            if any(p.strip().lower() == "named" for p in parts):
                rec["nm"] = 1  # bool compact
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
    print(f"[items] {manifest['count']} records, {len(shards)} shards -> {items_dir}/  (with icons: {icon_count})")


def build_repair_map():
    """
    Parcourt S9_extract_items_20250820.csv, lit la colonne 'Repair Recipe',
    extrait toutes les références [LTID]TableId et écrit data/repair_map.json :
      { LootTableID: [ItemID, ...], ... }
    """
    src = find_csv(CSV_MAP["items"])
    df  = load_csv_safely(src)
    df  = normalize_cols(df)

    # local helpers
    def _norm(s): return re.sub(r'[^a-z0-9_]+', '', str(s).lower())
    header_map = { _norm(c): c for c in df.columns }

    id_col = header_map.get("itemid") or header_map.get("id")
    rr_col = header_map.get("repairrecipe") or header_map.get("repair_recipe") or header_map.get("repair")

    if not id_col or not rr_col:
        # pas bloquant : on écrit un map vide
        write_json(OUT_DIR / "repair_map.json", {})
        print("[repair_map] Missing columns (ItemID or Repair Recipe). Wrote empty map.")
        return

    # regex : [LTID]TableName
    rx = re.compile(r'\[LTID\]\s*([A-Za-z0-9_]+)', re.I)

    rep = {}
    for _, row in df.iterrows():
        item_id = str(row[id_col]) if pd.notna(row[id_col]) else ""
        if not item_id:
            continue
        cell = row[rr_col]
        if not isinstance(cell, str) or not cell.strip():
            continue

        hits = rx.findall(cell)
        for table_id in hits:
            rep.setdefault(table_id, []).append(item_id)

    # dédoublonnage + tri léger
    for k, arr in rep.items():
        rep[k] = sorted(set(arr))

    out = OUT_DIR / "repair_map.json"
    write_json(out, rep)
    print(f"[repair_map] {len(rep)} loot tables referenced -> {out}")



def convert_simple(key):
    src = find_csv(CSV_MAP[key])
    print(f"[{key}] Reading: {src}")
    df = load_csv_safely(src)
    df = normalize_cols(df)
    records = json.loads(df.to_json(orient="records"))
    out = OUT_DIR / f"{key}.json"
    write_json(out, records)
    print(f"[{key}] {len(records)} records -> {out}")

import re, math



def flatten_loot_tables_triple_rows():
    src = find_csv("LootTables.csv")
    df  = load_csv_safely(src)
    df  = normalize_cols(df)

    # map baseID -> { base: row, qty: row or None, probs: row or None }
    groups = {}
    for _, row in df.iterrows():
        raw = str(row.get("LootTableID") or "").strip()
        if not raw:
            continue
        m = re.match(r"^(.*)_(Qty|Probs)$", raw, flags=re.I)
        if m:
            base = m.group(1)
            kind = m.group(2).lower()  # qty | probs
            entry = groups.setdefault(base, {"base": None, "qty": None, "probs": None})
            entry[kind] = row
        else:
            entry = groups.setdefault(raw, {"base": None, "qty": None, "probs": None})
            entry["base"] = row

    out = []
    for base_id, triple in groups.items():
        base  = triple["base"]
        if base is None:
            continue  # table sans ligne principale: on skippe

        qty   = triple["qty"]
        probs = triple["probs"]

        # métadonnées depuis la ligne "base"
        andor = base.get("AND/OR") or base.get("ANDOR") or ""
        roll  = base.get("RollBonusSetting") or ""
        
        # MaxRoll: d'abord sur la ligne *_Probs (col K chez toi), sinon fallback sur "base"
        def pick_maxroll():
            candidates = []
            if probs is not None:
                candidates += [probs.get("MaxRoll"), probs.get("Max Roll")]
            candidates += [base.get("MaxRoll"), base.get("Max Roll")]
            for v in candidates:
                if v is None or (isinstance(v, float) and pd.isna(v)): 
                    continue
                s = str(v).strip()
                if not s:
                    continue
                try:
                    f = float(s)
                    return int(f) if abs(f - int(f)) < 1e-9 else int(f)  # JSON int
                except Exception:
                    # some dumps might store as text; try to strip non-digits
                    import re
                    nums = re.sub(r"[^\d\-]+","", s)
                    if nums:
                        try: return int(nums)
                        except: pass
            return None
        maxr = pick_maxroll()

        # toutes les colonnes ItemN présentes sur la ligne base
        for col in base.index:
            m = re.fullmatch(r"Item(\d+)", col)
            if not m: 
                continue
            idx = int(m.group(1))
            ref = base[col]
            if pd.isna(ref) or str(ref).strip() == "":
                continue
            ref = str(ref).strip()

            # lire Qty/Probs à la même position depuis les lignes *_Qty et *_Probs
            qty_val   = None
            probs_val = None
            if qty is not None:
                q = qty.get(col)
                if pd.notna(q): qty_val = str(q).strip()
            if probs is not None:
                p = probs.get(col)
                if pd.notna(p):
                    # nombre si possible
                    try:
                        pv = float(p)
                        # si on a un entier, garde int
                        probs_val = int(pv) if math.isclose(pv, int(pv)) else pv
                    except Exception:
                        probs_val = str(p).strip()

            # type de ref
            rt = "item"
            m2 = re.match(r"^\[(LTID|LBID)\](.+)$", ref, flags=re.I)
            if m2:
                tag = m2.group(1).upper()
                val = m2.group(2)
                rt  = "ltid" if tag == "LTID" else "lbid"
                ref = val

            out.append({
                "LootTableID": base_id,
                "AndOr": str(andor),
                "RollBonusSetting": str(roll),
                "MaxRoll": maxr,
                "Index": idx,
                "RefType": rt,       # item | ltid | lbid
                "Ref": ref,          # ItemID or TableID or BucketID
                "Qty": qty_val,      # ex "3-7"
                "Probs": probs_val,  # threshold or index weight from *_Probs
            })

    path = OUT_DIR / "loot_tables_flat_v2.json"
    write_json(path, out)
    print(f"loot_tables_flat_v2: {len(out)} rows -> {path}")



def flatten_loot_buckets_from_firstrow_sharded():
    """
    Format 'FIRSTROW':
      FIRSTROW porte les noms des buckets en colonnes LootBucketX (ou BucketX).
      Chaque groupe X a (optionnellement) LootBiasingDisabledX, TagsX, MatchOneX, ItemX, QuantityX, OddsX.
      Les lignes en-dessous contiennent les items (ItemX non vide) => 1 sortie par (BucketID, ItemID).
    """
    src = find_csv("LootBuckets.csv")
    print(f"[loot_buckets_firstrow] Reading: {src}")
    df = load_csv_safely(src)
    df = normalize_cols(df)

    import re

    # --- local helpers ---
    def col_for_any(prefixes, i):
        norm_map = {norm_header(c): c for c in df.columns}
        for p in prefixes:
            key = norm_header(f"{p}{i}")  # accepte casse/espaces
            if key in norm_map:
                return norm_map[key]
        return None

    def is_truthy(v):
        if v is None: return None
        if isinstance(v, bool): return v
        s = str(v).strip().lower()
        if s in ("true", "1", "yes"): return True
        if s in ("false", "0", "no"): return False
        return None

    def to_float_or_none(v):
        if _is_empty(v): return None
        try:
            f = float(v)
            if math.isnan(f) or math.isinf(f): return None
            return f
        except Exception:
            return None

    # --- 1) FIRSTROW index
    firstrow_idx = None
    if "RowPlaceholders" in df.columns:
        mask = df["RowPlaceholders"].astype(str).str.strip().str.upper() == "FIRSTROW"
        idxs = df.index[mask].tolist()
        if idxs:
            firstrow_idx = idxs[0]
    if firstrow_idx is None:
        firstrow_idx = df.index.min() + 1  # fallback heuristique

    print(f"[loot_buckets_firstrow] firstrow_idx = {firstrow_idx}")

    # --- 2) Group indices: ItemN colonnes
    groups = sorted(
        int(m.group(1)) for c in df.columns
        if (m := re.match(r"^Item\s*(\d+)$", str(c), flags=re.I))
    )
    print(f"[loot_buckets_firstrow] detected groups: {len(groups)}")

    all_rows = []

    for i in groups:
        # Colonnes de ce groupe i
        col_bucket = col_for_any(["LootBucket", "Bucket"], i)
        col_bias   = col_for_any(["LootBiasingDisabled"], i)
        col_tags   = col_for_any(["Tags"], i)
        col_m1     = col_for_any(["MatchOne", "Match One"], i)
        col_item   = col_for_any(["Item"], i)
        col_qty    = col_for_any(["Quantity", "Qty"], i)
        col_odds   = col_for_any(["Odds"], i)

        # Sans ItemX ni BucketX => on saute ce groupe
        if not col_item or not col_bucket:
            continue

        # bucket FIRSTROW (peut être vide)
        bucket_id_first = None
        if col_bucket in df.columns:
            v = df.at[firstrow_idx, col_bucket]
            if not _is_empty(v):
                bucket_id_first = str(v).strip()

        # bias FIRSTROW
        bias_val = False
        if col_bias and col_bias in df.columns:
            bv = df.at[firstrow_idx, col_bias]
            tv = is_truthy(bv)
            bias_val = bool(tv) if tv is not None else False

        # --- Lignes de données (toutes sauf la FIRSTROW elle-même)
        for ridx in df.index:

            # 1) item
            item_val = df.at[ridx, col_item] if col_item in df.columns else None
            item_id  = None if _is_empty(item_val) else str(item_val).strip()
            if not item_id:
                continue

            # DEBUG: trace l’item cible
            if item_id == "Artifact_Set1_HeavyChest":
                print(f"[dbg row={int(ridx)} grp={i}] hit item")

            # 2) bucket par ligne (fallback si FIRSTROW vide)
            bucket_id_row = None
            if col_bucket in df.columns:
                v = df.at[ridx, col_bucket]
                if not _is_empty(v):
                    bucket_id_row = str(v).strip()

            # IMPORTANT: recalculer proprement bucket_id à chaque ligne
            bucket_id = bucket_id_first if bucket_id_first else bucket_id_row
            if item_id == "Artifact_Set1_HeavyChest":
                print(f"[dbg row={int(ridx)} grp={i}] col_bucket={col_bucket} first='{bucket_id_first}' row='{bucket_id_row}' => bucket_id='{bucket_id}'")

            if not bucket_id:
                continue  # on n’émet pas sans bucket

            # 3) autres champs
            qty = None
            if col_qty and col_qty in df.columns:
                v = df.at[ridx, col_qty]
                if not _is_empty(v):
                    qty = str(v).strip()

            tags = None
            if col_tags and col_tags in df.columns:
                v = df.at[ridx, col_tags]
                if not _is_empty(v):
                    tags = str(v).strip()

            m1 = None
            if col_m1 and col_m1 in df.columns:
                v = df.at[ridx, col_m1]
                m1 = is_truthy(v)

            odds_val = None
            if col_odds and col_odds in df.columns:
                odds_val = to_float_or_none(df.at[ridx, col_odds])

            if item_id == "Artifact_Set1_HeavyChest":
                print(f"[dbg row={int(ridx)} grp={i}] APPEND qty={qty} odds={odds_val} tags={tags} m1={m1}")

            all_rows.append({
                "BucketID": bucket_id,
                "ItemID":   item_id,
                "Quantity": qty,
                "Tags":     tags,
                "MatchOne": m1,
                "LootBiasingDisabled": bias_val,
                "GroupIndex": i,
                "RowIndex": int(ridx),
                "Odds": odds_val,
            })

    # --- Selfcheck spécifique
    _test_item = "Artifact_Set1_HeavyChest"
    _test_hits = [r for r in all_rows if r.get("ItemID") == _test_item]
    if _test_hits:
        _buckets = sorted({r["BucketID"] for r in _test_hits})
        print(f"[selfcheck] {_test_item} -> buckets: {_buckets}  (rows={len(_test_hits)})")
    else:
        print(f"[selfcheck] {_test_item} -> NO ROWS in flat (unexpected)")

    # --- Sharding par ItemID
    shards = {}
    for r in all_rows:
        key = _shard_key_from_itemid(r["ItemID"])
        shards.setdefault(key, []).append(r)

    # Stats
    print(f"[loot_buckets_firstrow] built rows: {len(all_rows)} (groups: {len(groups)})")
    uniq_buckets = len({r["BucketID"] for r in all_rows})
    uniq_items   = len({r["ItemID"] for r in all_rows})
    print(f"  unique BucketID: {uniq_buckets}, unique ItemID: {uniq_items}")

    # Écriture
    out_dir = OUT_DIR / "buckets_by_item"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"files": {}, "count": len(all_rows)}
    for key, arr in shards.items():
        fn = f"buckets_{key}.json"
        write_json(out_dir / fn, arr)
        manifest["files"][key] = fn
    write_json(out_dir / "manifest.json", manifest)
    print(f"[loot_buckets_firstrow] {manifest['count']} rows -> {out_dir}/ (shards: {len(shards)})")



def debug_print_buckets_for(item_id: str):
    out_dir = OUT_DIR / "buckets_by_item"
    # trouve le shard
    key = item_id[0].lower() if item_id else "misc"
    p = out_dir / f"buckets_{key}.json"
    if not p.exists():
        print("shard not found:", p)
        return
    with open(p, "r", encoding="utf-8") as f:
        arr = json.load(f)
    hits = [r for r in arr if r.get("ItemID") == item_id]
    print("Buckets for", item_id, "=>", sorted(set(h["BucketID"] for h in hits)))
    for h in hits:
        print("  -", h["BucketID"], "Qty=", h.get("Quantity"), "Odds=", h.get("Odds"))

def debug_scan_lootbuckets_for(item_id: str):
    src = find_csv("../raw/LootBuckets.csv")
    df  = load_csv_safely(src)
    df  = normalize_cols(df)
    import re

    # repère FIRSTROW
    firstrow_idx = None
    if "RowPlaceholders" in df.columns:
        idxs = df.index[df["RowPlaceholders"].astype(str).str.strip().str.upper() == "FIRSTROW"].tolist()
        if idxs: firstrow_idx = idxs[0]
    if firstrow_idx is None:
        firstrow_idx = df.index.min() + 1

    # helper d’accès insensible à la casse/espaces
    def col_for_any(prefixes, i):
        norm_map = {norm_header(c): c for c in df.columns}
        for p in prefixes:
            key = norm_header(f"{p}{i}")
            if key in norm_map:
                return norm_map[key]
        return None

    # tous les ItemN existants
    groups = sorted(
        int(m.group(1)) for c in df.columns
        if (m := re.match(r"^Item\s*(\d+)$", str(c), flags=re.I))
    )

    print(f"[debug] Searching '{item_id}' across {len(groups)} groups…")
    for i in groups:
        c_item   = col_for_any(["Item"], i)
        if not c_item:
            continue
        # lignes où ItemN == item_id
        mask = df[c_item].astype(str).str.strip() == item_id
        if not mask.any():
            continue

        c_bucket = col_for_any(["LootBucket","Bucket"], i)
        c_qty    = col_for_any(["Quantity","Qty"], i)
        c_odds   = col_for_any(["Odds"], i)
        c_tags   = col_for_any(["Tags"], i)
        c_m1     = col_for_any(["MatchOne","Match One"], i)
        c_bias   = col_for_any(["LootBiasingDisabled"], i)

        bucket_first = None
        if c_bucket:
            v = df.at[firstrow_idx, c_bucket]
            if pd.notna(v) and str(v).strip() != "":
                bucket_first = str(v).strip()

        print(f"\n[Group {i}] FIRSTROW Bucket = {bucket_first!r} (col={c_bucket})")
        for ridx in df.index[mask]:
            # bucket fallback ligne
            bucket_row = None
            if c_bucket:
                v = df.at[ridx, c_bucket]
                if pd.notna(v) and str(v).strip() != "":
                    bucket_row = str(v).strip()
            bucket_id = bucket_first or bucket_row

            qty = None
            if c_qty:
                v = df.at[ridx, c_qty]
                if pd.notna(v) and str(v).strip() != "":
                    qty = str(v).strip()
            odds = None
            if c_odds:
                v = df.at[ridx, c_odds]
                if pd.notna(v) and str(v).strip() != "":
                    try: odds = float(v)
                    except: odds = str(v).strip()
            tags = None
            if c_tags:
                v = df.at[ridx, c_tags]
                if pd.notna(v) and str(v).strip() != "":
                    tags = str(v).strip()
            m1 = None
            if c_m1:
                v = df.at[ridx, c_m1]
                if isinstance(v, str):
                    s = v.strip().lower()
                    if s in ("true","1","yes"): m1 = True
                    elif s in ("false","0","no"): m1 = False
                elif isinstance(v, (int,float,bool)):
                    m1 = bool(v)
            bias = None
            if c_bias:
                v = df.at[firstrow_idx, c_bias]
                if isinstance(v, str):
                    bias = v.strip().lower() in ("true","1","yes")
                elif isinstance(v, (int,float,bool)):
                    bias = bool(v)

            print(f"  row={int(ridx)} bucket={bucket_id!r} qty={qty} odds={odds} tags={tags} m1={m1} bias={bias}")



def main():
    print(f"Input dir: {IN_DIR}")
    print(f"Output dir: {OUT_DIR}")
    convert_items()
    build_repair_map()
    convert_simple("loot_tables")
    convert_simple("loot_buckets")
    convert_simple("loot_limits")
    flatten_loot_tables_triple_rows()
    flatten_loot_buckets_from_firstrow_sharded()
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

