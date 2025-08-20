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
        table.appendChild(row);
      });
  }

  // initial
  render();

  // recherche dynamique
  searchBox.addEventListener("input", e => render(e.target.value));
}

loadItems();
