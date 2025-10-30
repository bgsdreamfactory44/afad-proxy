// ===== Sismograf Frontend (Revizyon 5) =====
// 👑 Majesteleri'nin talimatlarıyla: Türkçe tablo başlıkları, gereksiz alanlar gizlendi,
// en güncel kayıtlar tutuluyor, eventID ve teknik alanlar backend’de kaldı.

function qsel(id) { return document.getElementById(id); }

// 🧭 AFAD formatına tam uyum (Z harfi kaldırıldı)
function toAfadTime(d) {
  return new Date(d).toISOString().split(".")[0].replace("Z", "");
}

// Global değişkenler
let fullData = [];
let filteredData = [];
let currentPage = 1;
const perPage = 15;
const autoRefreshMS = 120000;
let autoTimer = null;

// ===================== SPINNER =====================
function showSpinner() {
  const status = qsel("status");
  if (!status.querySelector(".spinner")) {
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    status.appendChild(spinner);
  }
  status.querySelector(".spinner").style.display = "inline-block";
}
function hideSpinner() {
  const status = qsel("status");
  const spinner = status.querySelector(".spinner");
  if (spinner) spinner.style.display = "none";
}

// ===================== PARAM HAZIRLAMA =====================
function buildParams() {
  const p = new URLSearchParams();
  const limit = 250;

  const startInput = qsel("startDate")?.value;
  const endInput = qsel("endDate")?.value;

  const end = endInput ? new Date(endInput) : new Date();
  const start = startInput
    ? new Date(startInput)
    : new Date(Date.now() - 30 * 86400000);

  p.set("start", toAfadTime(start));
  p.set("end", toAfadTime(end));
  p.set("limit", limit.toString());
  p.set("orderby", "timedesc");
  p.set("format", "json");
  return p;
}

// ===================== HATA YÖNETİMİ =====================
function renderError(msg) { qsel("errorBox").textContent = `⚠️ ${msg}`; }
function clearError() { qsel("errorBox").textContent = ""; }

// ===================== VERİYİ NORMALİZE ET =====================
function normalizeToList(json) {
  const data = json?.data;
  let list = [];

  if (Array.isArray(data?.eventList)) list = data.eventList;
  else if (Array.isArray(data?.features))
    list = data.features.map(f => ({ ...(f.properties || {}), geometry: f.geometry || null }));
  else if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object") list = [data];

  // 👑 Majesteleri: Sadece en güncel kayıtlar tutulacak
  const latestById = {};
  list.forEach(item => {
    if (!item.eventID) return;
    const existing = latestById[item.eventID];
    if (!existing || new Date(item.lastUpdateDate) > new Date(existing.lastUpdateDate)) {
      latestById[item.eventID] = item;
    }
  });

  // 👑 Majesteleri: eventID, type, isEventUpdate, lastUpdateDate backend’de kalsın
  const cleanList = Object.values(latestById).map(ev => {
    const { eventID, type, isEventUpdate, lastUpdateDate, ...rest } = ev;
    return rest;
  });

  return cleanList;
}

// ===================== TABLOYU GÜNCELLE =====================
function renderTable() {
  const list = filteredData.slice((currentPage - 1) * perPage, currentPage * perPage);
  const tbody = qsel("tbody");
  const thead = qsel("thead");
  tbody.innerHTML = "";
  thead.innerHTML = "";

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = "<td colspan='7'>Veri bulunamadı.</td>";
    tbody.appendChild(tr);
    return;
  }

  // 👑 Majesteleri: Türkçe ve anlamlı başlıklar
  const headers = [
    { key: "eventDate", label: "Tarih ve Saat" },
    { key: "location", label: "Bölge" },
    { key: "lat", label: "Enlem" },
    { key: "lon", label: "Boylam" },
    { key: "depth", label: "Derinlik (km)" },
    { key: "magnitude", label: "Büyüklük (Mw)" },
    { key: "rms", label: "RMS (ölçüm hatası)" },
  ];

  // Tablo başlıklarını oluştur
  const trHead = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h.label;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  // Satırları oluştur
  list.forEach(obj => {
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      let val = obj[h.key] ?? "";
      if (h.key === "eventDate") val = new Date(val).toLocaleString("tr-TR");
      if (h.key === "depth" && val) val = `${val} km`;
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  renderPagination();
}

// ===================== SAYFALAMA =====================
function renderPagination() {
  const totalPages = Math.ceil(filteredData.length / perPage);
  const footer = document.querySelector("footer");
  footer.innerHTML = `<small>Sayfa ${currentPage}/${totalPages} • Toplam ${filteredData.length} kayıt</small>`;

  if (totalPages > 1) {
    const prevBtn = document.createElement("button");
    const nextBtn = document.createElement("button");
    prevBtn.textContent = "← Önceki";
    nextBtn.textContent = "Sonraki →";
    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;
    prevBtn.onclick = () => { currentPage--; renderTable(); };
    nextBtn.onclick = () => { currentPage++; renderTable(); };
    footer.appendChild(document.createElement("br"));
    footer.appendChild(prevBtn);
    footer.appendChild(nextBtn);
  }
}

// ===================== ŞİDDET FİLTRESİ =====================
function applyMagnitudeFilter() {
  const activeRanges = Array.from(document.querySelectorAll(".mag-btn.active")).map(btn => btn.dataset.range);
  if (activeRanges.length === 0) { filteredData = fullData; return; }

  filteredData = fullData.filter(ev => {
    const mag = parseFloat(ev.magnitude);
    return activeRanges.some(r => {
      if (r === "0-2") return mag >= 0 && mag < 2;
      if (r === "2-4") return mag >= 2 && mag < 4;
      if (r === "4-6") return mag >= 4 && mag < 6;
      if (r === "6-8") return mag >= 6 && mag < 8;
      if (r === "8+")  return mag >= 8;
      return false;
    });
  });
}

// ===================== VERİ ÇEKME =====================
async function fetchAndRender() {
  clearError();
  showSpinner();
  const params = buildParams();
  const url = `${API_BASE}?${params.toString()}`;

  try {
    const r = await fetch(url);
    const json = await r.json().catch(() => ({}));
    if (!r.ok || json.success === false) {
      const detail = json?.detail || `HTTP ${r.status}`;
      renderError(`${json?.code || "ERROR"}: ${detail}`);
      return;
    }
    fullData = normalizeToList(json);
    applyMagnitudeFilter();
    currentPage = 1;
    renderTable();
  } catch (e) {
    renderError(e.message || "Veri alınamadı");
  } finally {
    hideSpinner();
  }
}

// ===================== OLAYLAR =====================
function setupMagnitudeButtons() {
  const buttons = document.querySelectorAll(".mag-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      applyMagnitudeFilter();
      currentPage = 1;
      renderTable();
    });
  });
}
function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(fetchAndRender, autoRefreshMS);
}

// ===================== BAŞLAT =====================
window.addEventListener("DOMContentLoaded", () => {
  setupMagnitudeButtons();
  fetchAndRender();
  startAutoRefresh();
});
document.getElementById("fetchBtn").addEventListener("click", fetchAndRender);
