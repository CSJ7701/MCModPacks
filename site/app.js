document.addEventListener("DOMContentLoaded", initApp);

const FALLBACK_ICON = "flaticon-minecraft.png";

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
    // Graceful fallback if metadata.json fails
  }

  const iconSrc = meta.icon ? meta.icon : FALLBACK_ICON;

  const card = document.createElement("div");
  card.className = "pack-card";

  card.innerHTML = `
    <div>
      <div class="pack-header">
        <img class="pack-icon" src="${iconSrc}" alt="${meta.name} Icon" onerror="this.src='${FALLBACK_ICON}'" />
        <div class="pack-title">
          <h2>${escapeHtml(meta.name)}</h2>
          <span class="pack-version">v${escapeHtml(meta.version)}</span>
        </div>
      </div>
      <p class="pack-desc">${escapeHtml(meta.description)}</p>
    </div>
    <div class="actions">
      <a class="btn btn-sage" href="${pack.mrpack}" download>Modrinth Pack (.mrpack)</a>
      <a class="btn btn-green" href="${pack.curseforge}" download>CurseForge Pack (.zip)</a>
      <button class="btn btn-neutral" onclick="viewModList('${pack.modlist}', '${escapeHtml(meta.name)}')">View Mod List</button>
    </div>
  `;

  return card;
}

// Modal handling
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

function closeModal() {
  document.getElementById("modlist-modal").classList.add("hidden");
}

function copyModList() {
  const text = document.getElementById("modal-text").textContent;
  navigator.clipboard.writeText(text).then(() => {
    alert("Mod list copied to clipboard!");
  });
}

// Manual Light/Dark Theme Switcher
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  
  let newTheme;
  if (currentTheme) {
    newTheme = currentTheme === "dark" ? "light" : "dark";
  } else {
    newTheme = prefersDark ? "light" : "dark";
  }

  document.documentElement.setAttribute("data-theme", newTheme);
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
