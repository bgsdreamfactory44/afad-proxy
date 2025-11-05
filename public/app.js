// ===== Sismograf Frontend (Tam Çalışır) =====
// Deprem verilerini AFAD API'den çekip en yeni depremi en üstte gösterir.
// Tasarım: BG’s Dream Factory Revizyon 3.5

// Yardımcı seçici
function qsel(id) { return document.getElementById(id); }

// AFAD API kök adresi (proxy gerekmeden doğrudan kullanılır)
const API_URL = "https://deprem.afad.gov.tr/apiv2/event/filter";

// Veri dizileri ve sayfa kontrol değişkenleri
let fullData = [];
let filteredData = [];
let currentPage = 1;
const perPage = 15;
const autoRefreshMS = 120000;
let autoTimer;

// Tarihi AFAD formatına çevir (YYYY-MM-DD hh:mm:ss)
function toAfadTime(d) {
  const pad = n => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// AFAD parametrelerini hazırlama
function buildParams() {
  const params = new URLSearchParams();
  const startStr = qsel("startDate").value;
  const endStr = qsel("endDate").value;

  const end = endStr ? new Date(endStr) : new Date();
  const start = startStr ? new Date(startStr) : new Date(Date.now() - 30 * 86400000);

  params.set("start", toAfadTime(start));
  params.set("end", toAfadTime(end));
  params.set("limit", "250");      // Son 250 deprem
  params.set("orderby", "timedesc"); // En yeni üste【311†source】
  params.set("format", "json");
  return params;
}

// Hata ve durum mesajları
function renderError(msg) { qsel("errorBox").textContent = `⚠️ ${msg}`; }
function clearError() { qsel("errorBox").textContent = ""; }
function showStatus(text) { qsel("status").textContent = text; }
function clearStatus() { qsel("status").textContent = ""; }

// AFAD verisini normalize eden fonksiyon
function normalizeData(json) {
  // API dökümantasyonuna göre veri `data.eventList` veya `data` dizisi içinde gelir【312†source】.
  let list = [];
  if (Array.isArray(json?.data)) {
    list = json.data;
  } else if (Array.isArray(json?.data?.eventList)) {
    list = json.data.eventList;
  } else if (Array.isArray(json)) {
    list = json;
  }
  return list;
}

// Deprem zamanını almak (priority: eventDate)
function getTimeString(item) {
  return item.eventDate || item.date || item.origintime || item.time || "";
}

// AFAD verilerini çek ve tabloyu güncelle
async function fetchData() {
  clearError();
  showStatus("Yükleniyor...");
  const params = buildParams();

  try {
    const url = `${API_URL}?${params.toString()}`;
    const res = await fetch(url);
    const json = await res.json();
    // AFAD hata durumlarını kontrol et
    if (!res.ok) {
      throw new Error(json?.detail || `HTTP ${res.status}`);
    }
    fullData = normalizeData(json);

    // AFAD verisini eventDate alanına göre metin karşılaştırmasıyla sırala (en yeni üste)
    fullData.sort((a, b) => {
      const tb = getTimeString(b);
      const ta = getTimeString(a);
      return tb.localeCompare(ta);
    });

    applyFiltersAndRender();
    clearStatus();
  } catch (err) {
    renderError(err.message || "Veri alınamadı");
    clearStatus();
  }
}

// Şiddet butonlarından etkin olan filtreleri uygula
function applyMagnitudeFilter() {
  const activeRanges = Array.from(document.querySelectorAll(".mag-btn.active"))
    .map(btn => btn.dataset.range);
  if (activeRanges.length === 0) {
    filteredData = fullData;
    return;
  }
  filteredData = fullData.filter(item => {
    const mag = parseFloat(item.magnitude);
    return activeRanges.some(range => {
      if (range === "0-2") return mag < 2;
      if (range === "2-4") return mag >= 2 && mag < 4;
      if (range === "4-6") return mag >= 4 && mag < 6;
      if (range === "6-8") return mag >= 6 && mag < 8;
      if (range === "8+") return mag >= 8;
      return false;
    });
  });
}

// Tabloya verileri basan fonksiyon
function renderTable() {
  const list = filteredData.slice((currentPage - 1) * perPage, currentPage * perPage);
  const cols = new Set();
  list.forEach(item => {
    Object.keys(item || {}).forEach(k => cols.add(k));
  });
  const colArray = Array.from(cols);
  // Başlıklar
  const thead = qsel("thead");
  thead.innerHTML = "";
  const trHead = document.createElement("tr");
  colArray.forEach(col => {
    const th = document.createElement("th");
    th.textContent = translateColumnName(col);
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

    // Satırlar
    const tbody = qsel("tbody");
    tbody.innerHTML = "";
    list.forEach(item => {
      const tr = document.createElement("tr");
      colArray.forEach(col => {
        const td = document.createElement("td");
        let val = item[col];
        if (typeof val === "object" && val !== null) {
          val = JSON.stringify(val);
        }
        td.textContent = val ?? "";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    // Footer - sayfa bilgisi ve butonlar
    const footer = document.querySelector("footer");
    const totalPages = Math.ceil(filteredData.length / perPage) || 1;
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

// Tüm filtreleri uygulayıp tabloyu güncelle
function applyFiltersAndRender() {
  applyMagnitudeFilter();
  currentPage = 1;
  renderTable();
}

// Olayları kur
function setupEvents() {
  // Şiddet butonları
  document.querySelectorAll(".mag-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      applyFiltersAndRender();
    });
  });
  // Tabloyu güncelle butonu
  qsel("fetchBtn").addEventListener("click", fetchData);
}

// Otomatik yenileme kur
function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(fetchData, autoRefreshMS);
}

// Başlat
window.addEventListener("DOMContentLoaded", () => {
  setupEvents();
  fetchData();       // İlk yükleme
  startAutoRefresh(); // Periyodik güncelleme
});
