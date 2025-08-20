// Charger les items depuis items.json
async function loadItems() {
  const res = await fetch("items.json");
  const items = await res.json();

  const table = document.getElementById("itemsTable");
  const searchBox = document.getElementById("searchBox");

  function render(filter = "") {
    table.innerHTML = "";
    items
      .filter(it =>
        it.Name.toLowerCase().includes(filter.toLowerCase()) ||
        it.ItemID.toLowerCase().includes(filter.toLowerCase())
      )
      .slice(0, 100) // limiter à 100 pour perf
      .forEach(it => {
        const row = document.createElement("tr");
        row.className = "hover:bg-gray-800 cursor-pointer";

        row.innerHTML = `
            <td class="p-2 border border-gray-600 text-center">
                ${it.Icon ? `<img src="${it.Icon}" class="h-8 mx-auto"/>` : "—"}
            </td>
            <td class="p-2 border border-gray-600">${it.ItemID}</td>
            <td class="p-2 border border-gray-600 font-semibold">${it.Name}</td>
            <td class="p-2 border border-gray-600">${it.Type}</td>
            <td class="p-2 border border-gray-600">${it.Tier}</td>
            `;

            row.addEventListener("click", () => showItemDetails(it));

        table.appendChild(row);
      });
  }

  // initial
  render();

  // recherche dynamique
  searchBox.addEventListener("input", e => render(e.target.value));
}

loadItems();

async function showItemDetails(item) {
  // Charger loot-tables et loot-buckets si pas déjà faits
  if (!window.lootTables) {
    const ltRes = await fetch("loot-tables.json");
    window.lootTables = await ltRes.json();

    const lbRes = await fetch("loot-buckets.json");
    window.lootBuckets = await lbRes.json();
  }

  // Trouver loot tables / buckets où l’item apparaît
  const relatedTables = window.lootTables.filter(
    lt => lt.Items && lt.Items.includes(item.ItemID)
  );

  const relatedBuckets = window.lootBuckets.filter(
    lb => lb.Items && lb.Items.includes(item.ItemID)
  );

  // Construire contenu
  const detailsDiv = document.getElementById("itemDetails");
  detailsDiv.innerHTML = `
    <h2 class="text-xl font-bold mb-2">${item.Name}</h2>
    <p><b>ID:</b> ${item.ItemID}</p>
    <p><b>Type:</b> ${item.Type} | <b>Tier:</b> ${item.Tier}</p>

    <h3 class="mt-4 font-semibold">Loot Tables</h3>
    <ul class="list-disc ml-6">
      ${relatedTables.map(t => `<li>${t.LootTableID}</li>`).join("") || "<li>—</li>"}
    </ul>

    <h3 class="mt-4 font-semibold">Loot Buckets</h3>
    <ul class="list-disc ml-6">
      ${relatedBuckets.map(b => `<li>${b.LootBucketID}</li>`).join("") || "<li>—</li>"}
    </ul>
  `;
}
