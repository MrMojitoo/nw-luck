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
  lootBuckets: "data/loot_buckets.json",
  lootLimits: "data/loot_limits.json",
};

let manifest = null;         // items manifest (list of shard filenames)
let loadedShards = {};       // cache: shardKey -> array of items
let allItemsIndex = null;    // cache if we load all shards
let lootTables = null;
let lootBuckets = null;
let lootLimits = null;


const itemsTable = document.getElementById("itemsTable");
const searchBox = document.getElementById("searchBox");
const itemsInfo = document.getElementById("itemsInfo");
const detailsDiv = document.getElementById("itemDetails");

/* ------------- Utilities ------------- */
// --- normaliser une clé: minuscules + retirer tout sauf [a-z0-9]
function normKey(k) {
  return String(k).toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function ensureManifest() {
  if (!manifest) manifest = await fetchJSON(DATA.itemsManifest);
  return manifest;
}

async function ensureLootData() {
  if (!lootTables) lootTables = await fetchJSON(DATA.lootTables);
  if (!lootBuckets) lootBuckets = await fetchJSON(DATA.lootBuckets);
  if (!lootLimits) lootLimits = await fetchJSON(DATA.lootLimits);
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

/* ------------- Rendering ------------- */
function renderItems(items) {
  itemsTable.innerHTML = "";
  items.slice(0, 200).forEach(it => {
    const tr = document.createElement("tr");
    tr.className = "row";
    tr.innerHTML = `
      <td class="td text-center">${it.ic ? `<img src="${it.ic}" class="h-8 mx-auto" />` : "—"}</td>
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
  window.location.hash = `#item=${encodeURIComponent(item.id)}`; // routing
  detailsDiv.classList.remove("hidden");
  detailsDiv.innerHTML = `
    <h2 class="text-xl font-bold mb-2">${item.n || item.id}</h2>
    <p class="opacity-80 mb-4"><b>ID:</b> ${item.id} | <b>Type:</b> ${item.t || "—"} | <b>Tier:</b> ${item.tr ?? "—"}</p>
    <p class="opacity-60">Loading loot data…</p>
  `;

  await ensureLootData();

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
  const bucketsWithItem = (lootBuckets || []).filter(rec => recordContainsItem(rec, item.id));


  // Rendu sections
  function renderRecords(recs, kind) {
    if (!recs.length) return `<p class="opacity-70">No ${kind} found.</p>`;
    return recs.map(rec => {
      // métadonnées les plus fréquentes
      const id = getField(rec, ["LootTableID","LTID","LootBucketID","LBID","ID","Id"]) || "—";
      const meta = recordMeta(rec);
      const conds = extractConditions(rec);

      const tris = extractTriplets(rec)
        .filter(t => (t.itemId || "").toLowerCase() === item.id.toLowerCase())
        .sort((a,b) => (Number(a.probs||0) - Number(b.probs||0)));

      return `
        <div class="mb-4 border border-gray-700 rounded">
          <div class="p-3 bg-gray-800">
            <div class="font-semibold">${kind}: <span class="text-yellow-300">${id}</span></div>
            <div class="text-sm opacity-80">
              Logic: <b>${meta.logic}</b> · RollBonus: <b>${meta.roll}</b> · MaxRoll: <b>${meta.maxr}</b>
              ${conds.length ? `<br/>Conditions/Tags: <span class="opacity-90">${conds.join(" · ")}</span>` : ""}
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="table-auto w-full">
              <thead><tr class="bg-gray-700">
                <th class="th">ItemID</th><th class="th">Qty</th><th class="th">Probs</th>
              </tr></thead>
              <tbody>${itemsHtml}</tbody>
            </table>
          </div>
        </div>
      `;

    }).join("");
  }

  detailsDiv.innerHTML = `
    <h2 class="text-xl font-bold mb-2">${item.n || item.id}</h2>
    <p class="opacity-80 mb-4"><b>ID:</b> ${item.id} | <b>Type:</b> ${item.t || "—"} | <b>Tier:</b> ${item.tr ?? "—"}</p>

    <h3 class="text-lg font-semibold mb-2">Loot Tables</h3>
    ${renderRecords(tablesWithItem, "LootTable")}

    <h3 class="text-lg font-semibold mt-6 mb-2">Loot Buckets</h3>
    ${renderRecords(bucketsWithItem, "LootBucket")}
  `;
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
