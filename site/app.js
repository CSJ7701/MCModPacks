document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const gridEl = document.getElementById("pack-grid");

  try {
    const res = await fetch("manifest.json");
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const packs = await res.json();

    loadingEl.classList.add("hidden");

    if (packs.length === 0) {
      loadingEl.textContent = "No modpacks found.";
      loadingEl.classList.remove("hidden");
      return;
    }

    for (const pack of packs) {
      const card = await createPackCard(pack);
      gridEl.appendChild(card);
    }
  } catch (err) {
    console.error("Error fetching manifest:", err);
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
  }
}

async function createPackCard(pack) {
  // Fetch metadata if it exists, otherwise build fallback data
  let meta = {
    name: pack.id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    version: "1.0.0",
    description: "No metadata.json provided for this pack.",
    icon: null
  };

  try {
    const metaRes = await fetch(`packs/${pack.id}/metadata.json`);
    if (metaRes.ok) {
      const fetchedMeta = await metaRes.json();
      meta = { ...meta, ...fetchedMeta };
    }
  } catch (e) {
    // Graceful fallback if metadata.json is missing or invalid
  }

  const card = document.createElement("div");
  card.className = "pack-card";

  const defaultIconSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>`;

  card.innerHTML = `
    <div>
      <div class="pack-header">
        <img class="pack-icon" src="${meta.icon || defaultIconSvg}" alt="${meta.name} Icon" onerror="this.src='${defaultIconSvg}'" />
        <div class="pack-title">
          <h2>${escapeHtml(meta.name)}</h2>
          <span class="pack-version">v${escapeHtml(meta.version)}</span>
        </div>
      </div>
      <p class="pack-desc">${escapeHtml(meta.description)}</p>
    </div>
    <div class="actions">
      <a class="btn btn-mr" href="${pack.mrpack}" download>Download Modrinth Pack (.mrpack)</a>
      <a class="btn btn-cf" href="${pack.curseforge}" download>Download CurseForge Pack (.zip)</a>
      <button class="btn btn-neutral" onclick="viewModList('${pack.modlist}', '${escapeHtml(meta.name)}')">View Mod List</button>
    </div>
  `;

  return card;
}

// Mod List Modal Handling
async function viewModList(modlistUrl, packName) {
  const modal = document.getElementById("modlist-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalText = document.getElementById("modal-text");

  modalTitle.textContent = `Mod List - ${packName}`;
  modalText.textContent = "Loading mod list...";
  modal.classList.remove("hidden");

  try {
    const res = await fetch(modlistUrl);
    if (!res.ok) throw new Error("Failed to load list");
    const text = await res.text();
    modalText.textContent = text || "Mod list is empty.";
  } catch (err) {
    modalText.textContent = "Error loading mod list file.";
  }
}

function closeModal(event) {
  const modal = document.getElementById("modlist-modal");
  modal.classList.add("hidden");
}

function copyModList() {
  const text = document.getElementById("modal-text").textContent;
  navigator.clipboard.writeText(text).then(() => {
    alert("Mod list copied to clipboard!");
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}
