// ===== Sismograf Frontend (Revizyon 5.1) =====
// 👑 Majesteleri'nin talimatlarıyla: Türkçe başlıklar güncellendi
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
function renderError(msg) {
  qsel("errorBox").textContent = `⚠️ ${msg}`;
}
function clearError() {
  qsel("errorBox").textContent = "";
}

// ===================== TABLO =====================
function translateColumnName(key) {
  const map = {
    latitude: "Enlem",
    longitude: "Boylam",
    depth: "Derinlik (km)",
    rms: "RMS (Ölçüm Doğruluğu)",
    location: "Konum",
    magnitude: "Şiddet",
    country: "Ülke",
    province: "Şehir",
    district: "İlçe",
    neighborhood: "Bölge",
    date: "Tarih"
  };
  return map[key] || key;
}

function shouldHideColumn(key) {
  return ["eventid", "eventID", "type", "isEventUpdate", "lastUpdateDate"].includes(key);
}

function autoColumns(list) {
  const cols = new Set();
  list.forEach(obj => Object.keys(obj || {}).forEach(k => {
    if (!shouldHideColumn(k)) cols.add(k);
  }));
  return Array.from(cols);
}

function setHeader(cols) {
  const thead = qsel("thead");
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  cols.forEach(c => {
    const th = document.createElement("th");
    th.textContent = translateColumnName(c);
    tr.appendChild(th);
  });
  thead.appendChild(tr);
}

function setRows(cols, list) {
  const tbody = qsel("tbody");
  tbody.innerHTML = "";
  list.forEach(obj => {
    const tr = document.createElement("tr");
    cols.forEach(c => {
      const td = document.createElement("td");
      let val = obj && Object.prototype.hasOwnProperty.call(obj, c) ? obj[c] : "";
      if (typeof val === "object" && val !== null) val = JSON.stringify(val);
      td.textContent = val ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// ===================== AFAD VERİSİNİ NORMALİZE ET =====================
function normalizeToList(json) {
  const data = json?.data;
  if (Array.isArray(data?.eventList)) return data.eventList;
  if (Array.isArray(data?.features))
    return data.features.map(f => ({ ...(f.properties || {}), geometry: f.geometry || null }));
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
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

// ===================== TABLOYU GÜNCELLE =====================
function renderTable() {
  const list = filteredData.slice((currentPage - 1) * perPage, currentPage * perPage);
  const cols = autoColumns(list);
  setHeader(cols);
  setRows(cols, list);
  renderPagination();
}

// ===================== ŞİDDET FİLTRESİ =====================
function applyMagnitudeFilter() {
  const activeRanges = Array.from(document.querySelectorAll(".mag-btn.active"))
    .map(btn => btn.dataset.range);

  if (activeRanges.length === 0) {
    filteredData = fullData;
    return;
  }

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
