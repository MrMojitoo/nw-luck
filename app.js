/* ---------------- Tabs ---------------- */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab").forEach(s => s.classList.add("hidden"));
    document.getElementById(`tab-${tab}`).classList.remove("hidden");
  });
});

/* ---------------- Data paths ---------------- */
const DATA = {
  itemsManifest: "data/items/manifest.json",
  itemsDir: "data/items/",
  lootTables: "data/loot_tables.json",
  lootLimits: "data/loot_limits.json",
  lootTablesFlatV2: "data/loot_tables_flat_v2.json",
  lootBucketsByItemManifest: "data/buckets_by_item/manifest.json",
  lootBucketsByItemDir: "data/buckets_by_item/",
  repairMap: "data/repair_map.json",
};

let manifest = null;         // items manifest (list of shard filenames)
let loadedShards = {};       // cache: shardKey -> array of items
let allItemsIndex = null;    // cache if we load all shards
let lootTables = null;
let lootBuckets = null;
let lootLimits = null;
let lootTablesFlatV2 = null;
let lootBucketsFlat  = null;
let bucketsManifest = null;
let loadedBucketShards = {}; // key -> array
let repairMap = null;




const itemsTable = document.getElementById("itemsTable");
const searchBox = document.getElementById("searchBox");
const itemsInfo = document.getElementById("itemsInfo");
const detailsDiv = document.getElementById("itemDetails");
const _itemNameCache = Object.create(null);

/* ------------- Utilities ------------- */
// --- normaliser une clé: minuscules + retirer tout sauf [a-z0-9]
function normKey(k) {
  return String(k).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// normaliser un texte (pour comparer des noms)
function normText(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // accents
    .replace(/[^a-z0-9]+/g, " ")      // espaces propres
    .trim();
}

function normId(v) {
  return String(v || "").toLowerCase().trim();
}

function coerceBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

// ---------- Icons helpers ----------
function getIconUrlFromItem(it) {
  const raw = (it && (it.ic || it.Icon)) ? String(it.ic || it.Icon) : null;
  return raw && raw.trim() ? raw.trim() : null;
}

function rarityClass(it) {
  const r = (it?.ry || it?.rarity || "").toString().toLowerCase();
  let base;
  switch (r) {
    case "uncommon": base = "nw-item-rarity-uncommon"; break;
    case "rare":      base = "nw-item-rarity-rare";      break;
    case "epic":      base = "nw-item-rarity-epic";      break;
    case "legendary": base = "nw-item-rarity-legendary"; break;
    case "artifact":  base = "nw-item-rarity-artifact";  break;
    default:          base = "nw-item-rarity-common";
  }
  // le convert place nm=1 si "Named" est dans "Item Class"
  const isNamed = !!it?.nm || String(it?.nm).trim() === "1" || String(it?.nm).toLowerCase() === "true";
  return isNamed ? `${base} named` : base;
}


function iconWithFallback(url) {
  // Si .webp échoue, tente automatiquement .png
  const png = url.endsWith(".webp") ? url.replace(/\.webp(\?.*)?$/i, ".png$1") : url;
  return `
    <img class="item-icon"
         src="${url}"
         loading="lazy"
         onerror="this.onerror=null; this.src='${png}'; this.classList.add('icon-fallback')" />
  `;
}


function renderBucketsFlat(entries) {
  if (!entries || !entries.length) {
    return `<p class="opacity-70">No LootBucket found.</p>`;
  }

  const rows = entries.map(e => `
    <tr>
      <td class="td">${e.BucketID}</td>
      <td class="td">${e.ItemID}</td>
      <td class="td">${e.Quantity ?? "—"}</td>
      <td class="td">${e.Odds ?? "—"}</td>
      <td class="td">${e.MatchOne ?? "—"}</td>
      <td class="td">${e.Tags ?? ""}</td>
    </tr>
  `).join("");

  return `
    <div class="overflow-x-auto">
      <table class="table-auto w-full">
        <thead>
          <tr class="bg-gray-700">
            <th class="th">Bucket</th>
            <th class="th">Item</th>
            <th class="th">Qty</th>
            <th class="th">Odds</th>
            <th class="th">MatchOne</th>
            <th class="th">Tags</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}



// Retourne la 1ère valeur trouvée en testant plusieurs noms de champs, avec normalisation
function getField(rec, candidates) {
  const map = {};
  for (const [k, v] of Object.entries(rec)) map[normKey(k)] = v;
  for (const name of candidates) {
    const nk = normKey(name);
    if (nk in map) return map[nk];
  }
  return undefined;
}

function shardKeyFromQuery(q) {
  if (!q || q.length === 0) return null;
  const c = q.trim()[0].toLowerCase();
  if (c >= 'a' && c <= 'z') return c;
  if (c >= '0' && c <= '9') return c;
  return 'misc';
}

async function fetchJSON(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${path}${sep}v=${Date.now()}`;   // cache-buster à chaque requête
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}


async function ensureManifest() {
  if (!manifest) manifest = await fetchJSON(DATA.itemsManifest);
  return manifest;
}

async function ensureLootData() {
  if (!lootTables)       lootTables       = await fetchJSON(DATA.lootTables); 
  if (!lootLimits)       lootLimits       = await fetchJSON(DATA.lootLimits);
  if (!lootTablesFlatV2) lootTablesFlatV2 = await fetchJSON(DATA.lootTablesFlatV2);
  if (!bucketsManifest)  await ensureBucketsManifest(); 
  if (!repairMap)        repairMap        = await fetchJSON(DATA.repairMap);
}

async function getItemNameById(itemId) {
  if (_itemNameCache[itemId]) return _itemNameCache[itemId];
  const it = await fetchItemById(itemId);
  const name = it ? (it.n || itemId) : itemId;
  _itemNameCache[itemId] = name;
  return name;
}


async function fetchItemById(itemId) {
  if (!itemId) return null;
  await ensureManifest();
  const shardKey = shardKeyFromItemId(itemId);
  const pool = await loadShard(shardKey);
  return pickItemByIdFromPool(pool, itemId) || null;
}


async function loadShard(shardKey) {
  if (loadedShards[shardKey]) return loadedShards[shardKey];
  const file = (manifest.files || {})[shardKey];
  if (!file) return [];
  const data = await fetchJSON(DATA.itemsDir + file);
  loadedShards[shardKey] = data;
  return data;
}

async function loadAllShardsProgressive() {
  await ensureManifest();
  const keys = Object.keys(manifest.files || {});
  let all = [];
  for (const k of keys) {
    const arr = await loadShard(k);
    all = all.concat(arr);
  }
  allItemsIndex = all;
  return all;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr || []) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function shardKeyFromItemId(id) {
  if (!id || !id.length) return "misc";
  const c = id[0].toLowerCase();
  if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) return c;
  return "misc";
}

async function ensureBucketsManifest() {
  if (!bucketsManifest) bucketsManifest = await fetchJSON(DATA.lootBucketsByItemManifest);
  return bucketsManifest;
}

async function loadBucketsForItemId(itemId) {
  await ensureBucketsManifest();
  const key = shardKeyFromItemId(itemId || "");
  if (loadedBucketShards[key]) return loadedBucketShards[key];
  const fn = (bucketsManifest.files || {})[key];
  if (!fn) {
    loadedBucketShards[key] = [];
    return loadedBucketShards[key];
  }
  const arr = await fetchJSON(DATA.lootBucketsByItemDir + fn);
  loadedBucketShards[key] = arr;
  return arr;
}



/* ------------- Rendering ------------- */
function renderItems(items) {
  itemsTable.innerHTML = "";
  items.slice(0, 200).forEach(it => {
    const tr = document.createElement("tr");
    tr.className = "row";
    const iconUrl  = getIconUrlFromItem(it);
    const innerImg = iconUrl ? iconWithFallback(iconUrl)
                             : '<div class="item-icon placeholder"></div>';
    const frameCls = rarityClass(it);
    const iconHtml = `
      <div class="nw-icon nw-item-icon-frame nw-item-icon-bg ${frameCls}">
        <span class="nw-item-icon-border"></span>
        <span class="nw-item-icon-mask"></span>
        ${innerImg}
      </div>`;
    tr.innerHTML = `
      <td class="td text-center">${iconHtml}</td>    
      <td class="td">${it.id || ""}</td>
      <td class="td font-semibold">${it.n || ""}</td>
      <td class="td">${it.t || ""}</td>
      <td class="td">${it.tr ?? ""}</td>
    `;
    tr.addEventListener("click", () => showItemDetails(it));
    itemsTable.appendChild(tr);
  });
  itemsInfo.textContent = `${items.length} item(s) (showing up to 200)`;
}

// Renvoie [{itemId, qty, probs}] à partir d'un record de loot-table/bucket
function extractTriplets(rec) {
  const out = [];

  // Cas Items déjà structurés en tableau d'objets
  if (Array.isArray(rec.Items)) {
    rec.Items.forEach(it => {
      out.push({
        itemId: it.ItemID || it.id || it.itemId || it.Item || it.Name || "",
        qty: it.Qty ?? it.Quantity ?? it.qty ?? null,
        probs: it.Probs ?? it.Prob ?? it.probs ?? null
      });
    });
    return out;
  }

  const keys = Object.keys(rec);

  // Cas colonnes Item1 / Qty1 / Probs1
  const itemCols = keys.filter(k => /^Item\d+$/i.test(k) && rec[k]);
  if (itemCols.length) {
    for (const k of itemCols) {
      const idx = (k.match(/\d+$/) || [null])[0];
      const itemId = rec[k];
      const qtyKey = [`Quantity${idx}`, `Qty${idx}`, `quantity${idx}`, `qty${idx}`].find(c => c in rec);
      const prbKey = [`Probs${idx}`, `Prob${idx}`, `probs${idx}`, `prob${idx}`].find(c => c in rec);
      out.push({
        itemId,
        qty: qtyKey ? rec[qtyKey] : null,
        probs: prbKey ? rec[prbKey] : null
      });
    }
    return out;
  }

  // Fallback: une partie des extractions S9 place l'ID d'item dans une autre colonne
  // -> on scanne toutes les paires clé/valeur et si la valeur ressemble à un ItemID on la prend
  for (const [k, v] of Object.entries(rec)) {
    if (v == null) continue;
    if (typeof v === "string" && /[A-Za-z]/.test(v) && /item|artifact|weapon|armor|fish/i.test(v)) {
      out.push({ itemId: v, qty: null, probs: null });
    }
  }

  return out;
}


// util: formater une probabilité sous forme %
function fmtProb(p) {
  if (p == null || p === "") return "—";
  const num = Number(p);
  if (!isFinite(num)) return String(p);
  // beaucoup de dumps stockent 0..1 ; si >1 on suppose déjà en %
  const pct = num <= 1 ? num * 100 : num;
  return `${pct.toFixed(2)}%`;
}

function recordMeta(rec) {
  // On accepte plein de variantes d'entêtes
  const logic = getField(rec, ["AND/OR", "ANDOR", "AndOr", "Logic", "AND", "OR"]);
  const roll  = getField(rec, ["RollBonusSetting", "Roll Bonus Setting", "RollMode", "Roll", "AddToRoll", "ClampMax"]);
  const maxr  = getField(rec, ["MaxRoll", "Max Roll", "RollMax", "Max"]);
  return {
    logic: logic ?? "—",
    roll:  roll ?? "—",
    maxr:  maxr  ?? "—",
  };
}


// util: collecter conditions/tags si présentes
function extractConditions(rec) {
  const keys = Object.keys(rec);
  const conds = [];
  for (const k of keys) {
    if (/^conditions?\b/i.test(k) || /^tags?\b/i.test(k) || /Tag\d+/i.test(k)) {
      const v = rec[k];
      if (v != null && String(v).trim() !== "") conds.push(`${k}: ${v}`);
    }
  }
  return conds;
}


async function showItemDetails(item) {
  window.location.hash  = `#item=${encodeURIComponent(item.id)}`;
  window.currentItemId   = item.id;
  window.currentItemName = item.n || "";
  detailsDiv.classList.remove("hidden");
  const iconUrl   = getIconUrlFromItem(item);
  const innerImg  = iconUrl ? iconWithFallback(iconUrl) : "";
  const frameCls  = rarityClass(item);
  const iconHtml  = innerImg
    ? `<div class="nw-icon nw-item-icon-frame nw-item-icon-bg ${frameCls}">
         <span class="nw-item-icon-border"></span>
         <span class="nw-item-icon-mask"></span>
         ${innerImg}
       </div>`
    : "";
  detailsDiv.innerHTML = `
    <div class="item-header mb-2">
      ${iconHtml}
      <div class="item-header-meta">
        <h2 class="text-xl font-bold">${item.n || item.id}</h2>
        <p class="opacity-80"><b>ID:</b> ${item.id} | <b>Type:</b> ${item.t || "—"} | <b>Tier:</b> ${item.tr ?? "—"}</p>
      </div>
    </div>
    <p class="opacity-60">Loading loot data…</p>`;

  let finalHtml = "";
  try {
    await ensureLootData();


  const bucketShard = await loadBucketsForItemId(item.id);
  const bucketsById = groupBy(bucketShard, r => r.BucketID || "");

  // tables regroupées
  const hitsByTable = groupBy(
    (lootTablesFlatV2 || []).filter(e => {
      // direct
      if (e.RefType === "item" && normId(e.Ref) === normId(item.id)) return true;
      // via bucket: vérifie si le shard courant contient l'item pour ce bucket
      if (e.RefType === "lbid") {
        const rows = bucketsById.get(e.Ref) || [];
        return rows.some(r => normId(r.ItemID) === normId(item.id));
      }
      return false;
    }),
    e => e.LootTableID || ""
  );

  const tablesById  = groupBy(lootTablesFlatV2, r => r.LootTableID || "");

  const normItemId = normId(item.id);
  const normItemName = normText(item.n);

  // 1) Hits directs: RefType=item & Ref == ItemID
  const directEntries = (lootTablesFlatV2 || []).filter(e =>
    e.RefType === "item" && normId(e.Ref) === normItemId
  );

  // 2) Hits via bucket: RefType=lbid & le bucket contient l'item
  const viaBucketEntries = (lootTablesFlatV2 || []).flatMap(e => {
    if (e.RefType !== "lbid") return [];
    const bucketRows = bucketsById.get(e.Ref) || [];
    const bucketHasItem = bucketRows.some(r =>
      normId(r.ItemID) === normItemId || normText(r.ItemID) === normItemName
    );
    return bucketHasItem ? [e] : [];
  });

  // Toutes les tables concernées
  const allTableHits = [...directEntries, ...viaBucketEntries];



  // util: vrai si l'item apparaît dans cet enregistrement (triplets OU partout dans les valeurs)
  function recordContainsItem(rec, targetId) {
    const id = (targetId || "").toLowerCase();
    // via triplets
    const tris = extractTriplets(rec);
    if (tris.some(t => (t.itemId || "").toLowerCase() === id)) return true;

    // via scan de toutes les valeurs (ex: colonnes non standard)
    for (const v of Object.values(rec)) {
      if (v && typeof v === "string" && v.toLowerCase() === id) return true;
    }
    return false;
  }

  // …
  const tablesWithItem = (lootTables || []).filter(rec => recordContainsItem(rec, item.id));
  // LootBuckets: la colonne "Item" == Name de l'item (pas l'ID)
  const bucketsWithItem = (lootBuckets || []).filter(rec =>
    normText(rec.Item) === normText(item.n) ||
    normText(rec.Item) === normText(item.id)   // fallback au cas où
  );


  function renderTableWithEntries(tableId, entries) {
    if (!entries || !entries.length) return "";

    // métadonnées (prends la 1ère entrée comme source)
    const meta = entries[0];
    const logic = meta.AndOr || "—";
    const roll  = meta.RollBonusSetting || "—";
    const maxr  = (meta.MaxRoll ?? "—");

    // Items qui ouvrent cette LootTable via "Repair Recipe"
    let repairLine = "";
    if (repairMap && repairMap[tableId] && repairMap[tableId].length) {
      // On construit dynamiquement les liens avec les noms
      const repairItems = repairMap[tableId];
      const linksPromises = repairItems.map(async (id) => {
        const name = await getItemNameById(id);
        return `<a class="link" href="#item=${encodeURIComponent(id)}">${name}</a>`;
      });
      // on attend toutes les promesses et on insère après
      Promise.all(linksPromises).then(resolvedLinks => {
        const html = `<div class="text-sm mt-1">Opened/Salvaged by: ${resolvedLinks.join(", ")}</div>`;
        // insérer dans le container déjà rendu
        const container = document.getElementById(`loot-${tableId}`);
        if (container) container.innerHTML = html;
      });
      // placeholder vide au rendu initial
      repairLine = `<div id="loot-${tableId}" class="repair-line text-sm mt-1 opacity-70">Loading salvage info…</div>`;
    }



    // Lignes: si RefType=item → lignes directes
    // Si RefType=lbid → enrichir avec in-bucket odds & matchOne
    const rows = entries.map(e => {
      let refInfo = e.Ref;
      let qty     = e.Qty ?? "—";
      let probs   = e.Probs ?? "—";
      let extra   = "";

      if (e.RefType === "lbid") {
        const br = (bucketsById.get(e.Ref) || []).filter(r =>
          normId(r.ItemID) === normId(window.currentItemId) || normText(r.ItemID) === normText(window.currentItemName)
        );
        // cumuler info bucket pour cet item
        if (br.length) {
          // Plusieurs lignes possibles dans le bucket pour le même item; on affiche la première + résumé
          const b0 = br[0];
          const odds = (b0.Odds != null) ? fmtProb(b0.Odds) : "—";
          const m1   = (b0.MatchOne != null) ? String(b0.MatchOne) : "—";
          const bq   = (b0.Quantity != null) ? b0.Quantity : "—";
          extra = ` (Bucket: ${e.Ref} · InBucketOdds: ${odds} · MatchOne: ${m1} · BucketQty: ${bq})`;
        } else {
          extra = ` (Bucket: ${e.Ref})`;
        }
        refInfo = `[LBID] ${e.Ref}`;
      } else if (e.RefType === "ltid") {
        refInfo = `[LTID] ${e.Ref}`;
      }

      return `
        <tr>
          <td class="td">${e.Index}</td>
          <td class="td">${refInfo}</td>
          <td class="td">${qty}</td>
          <td class="td">${probs}</td>
          <td class="td text-sm opacity-80">${extra}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="mb-4 border border-gray-700 rounded">
        <div class="p-3 bg-gray-800">
          <div class="font-semibold">LootTable: <span class="text-yellow-300">${tableId}</span></div>
          <div class="text-sm opacity-80">
            Logic: <b>${logic}</b> · RollBonus: <b>${roll}</b> · MaxRoll: <b>${maxr}</b>
          </div>
          ${repairLine} 
        </div>
        <div class="overflow-x-auto">
          <table class="table-auto w-full">
            <thead><tr class="bg-gray-700">
              <th class="th">Idx</th><th class="th">Ref</th><th class="th">Qty</th><th class="th">Probs (threshold)</th><th class="th">Notes</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  const tablesHtml = Array.from(hitsByTable.entries())
    .map(([tid, entries]) => renderTableWithEntries(tid, entries))
    .join("") || `<p class="opacity-70">No LootTable found.</p>`;

  // Buckets that list the item directly (optional section)
  const directBuckets = bucketShard.filter(r => normId(r.ItemID) === normId(item.id));
  const bucketsHtml = renderBucketsFlat(directBuckets);

  // ---- Tables that reference these buckets
  const bucketIds = new Set(directBuckets.map(b => b.BucketID));
  const tablesViaTheseBuckets = (lootTablesFlatV2 || []).filter(e =>
    e.RefType === "lbid" && bucketIds.has(e.Ref)
  );

  // group and render with the same renderer (it will enrich notes using bucketsById)
  const viaBucketsByTable = groupBy(tablesViaTheseBuckets, e => e.LootTableID || "");
  const tablesFromBucketsHtml = Array.from(viaBucketsByTable.entries())
    .map(([tid, entries]) => renderTableWithEntries(tid, entries))
    .join("") || `<p class="opacity-70">No LootTable uses these buckets.</p>`;


  
  finalHtml = `
    <div class="item-header mb-2">
      ${iconHtml}
      <div class="item-header-meta">
        <h2 class="text-xl font-bold">${item.n || item.id}</h2>
        <p class="opacity-80"><b>ID:</b> ${item.id} | <b>Type:</b> ${item.t || "—"} | <b>Tier:</b> ${item.tr ?? "—"}</p>
      </div>
    </div>

    <h3 class="text-lg font-semibold mb-2">Loot Tables</h3>
    ${tablesHtml}

    <h3 class="text-lg font-semibold mt-6 mb-2">Loot Buckets (direct)</h3>
    ${bucketsHtml}

    <h3 class="text-lg font-semibold mt-6 mb-2">Loot Tables using these Buckets</h3>
    ${tablesFromBucketsHtml}
  `;

  } catch (err) {
    console.error(err);
    finalHtml = `
      <div class="item-header mb-2">
        ${iconHtml}
        <div class="item-header-meta">
          <h2 class="text-xl font-bold">${item.n || item.id}</h2>
          <p class="opacity-80"><b>ID:</b> ${item.id} | <b>Type:</b> ${item.t || "—"} | <b>Tier:</b> ${item.tr ?? "—"}</p>
        </div>
      </div>
      <div class="text-red-400">Error while loading loot data: ${err.message}</div>`;
  }

  // Always write something, even if there was an error above
  detailsDiv.innerHTML = finalHtml;
}


/* ------------- Search logic ------------- */
async function handleSearch() {
  const q = searchBox.value.trim();
  if (!q) {
    const all = allItemsIndex || await loadAllShardsProgressive();
    renderItems(all);
    return;
  }
  await ensureManifest();

  const key = shardKeyFromQuery(q);
  let pool = [];
  if (key && manifest.files[key]) {
    pool = await loadShard(key);
  } else {
    const fallbackKeys = ['a','b','c','d','e','f','g','h','i','j'];
    for (const k of fallbackKeys) {
      if (manifest.files[k]) {
        const arr = await loadShard(k);
        pool = pool.concat(arr);
      }
    }
  }

  const lower = q.toLowerCase();
  const filtered = pool.filter(it =>
    (it.n && it.n.toLowerCase().includes(lower)) ||
    (it.id && it.id.toLowerCase().includes(lower))
  );
  renderItems(filtered);
}

searchBox.addEventListener("input", () => {
  clearTimeout(window._searchTimer);
  window._searchTimer = setTimeout(handleSearch, 150);
});

function pickItemByIdFromPool(pool, itemId) {
  const id = (itemId || "").toLowerCase();
  return pool.find(it => (it.id || "").toLowerCase() === id);
}

window.addEventListener("hashchange", async () => {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const itemId = hash.get("item");
  if (!itemId) return;
  // charger le shard du 1er caractère de itemId
  await ensureManifest();
  const shardKey = shardKeyFromQuery(itemId);
  let it = null;
  if (shardKey && manifest.files[shardKey]) {
    const pool = await loadShard(shardKey);
    it = pickItemByIdFromPool(pool, itemId);
  }
  if (!it) {
    // fallback: cherche dans l'index si chargé
    const all = allItemsIndex || await loadAllShardsProgressive();
    it = pickItemByIdFromPool(all, itemId);
  }
  if (it) showItemDetails(it);
});


/* ------------- Boot ------------- */
(async function init() {
  // tabs already wired above
  await ensureManifest();
  const warmKeys = ['a','b','c'];
  let warm = [];
  for (const k of warmKeys) {
    if (manifest.files[k]) {
      const arr = await loadShard(k);
      warm = warm.concat(arr);
    }
  }
  if (warm.length === 0) {
    warm = await loadAllShardsProgressive();
  }
  renderItems(warm);
    // Ouvrir direct si hash présent
    const initHash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const initItem = initHash.get("item");
    if (initItem) {
      const pool = allItemsIndex || warm;
      const hit = pickItemByIdFromPool(pool, initItem);
      if (hit) showItemDetails(hit);
    }

})();
