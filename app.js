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

const itemsTable = document.getElementById("itemsTable");
const searchBox = document.getElementById("searchBox");
const itemsInfo = document.getElementById("itemsInfo");
const detailsDiv = document.getElementById("itemDetails");

/* ------------- Utilities ------------- */
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

async function showItemDetails(item) {
  detailsDiv.classList.remove("hidden");
  detailsDiv.innerHTML = `
    <h2 class="text-xl font-bold mb-2">${item.n || item.id}</h2>
    <p class="opacity-80 mb-2"><b>ID:</b> ${item.id} | <b>Type:</b> ${item.t || "—"} | <b>Tier:</b> ${item.tr ?? "—"}</p>
    <p class="opacity-60">Loot tables & buckets will appear here (next step).</p>
  `;
  // Prochaine étape: fetch(DATA.lootTables / lootBuckets) et croiser
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
})();
