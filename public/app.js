function qsel(id) { return document.getElementById(id); }
function toAfadTime(d) { return new Date(d).toISOString().split(".")[0]; }

function buildParams() {
  const p = new URLSearchParams();
  const days = parseInt(qsel("days").value || "7", 10);
  const end = qsel("end").value ? new Date(qsel("end").value) : new Date();
  const start = qsel("start").value ? new Date(qsel("start").value) : new Date(Date.now() - days*86400000);

  p.set("start", toAfadTime(start));
  p.set("end", toAfadTime(end));

  // Basitler
  if (qsel("minmag").value) p.set("minmag", qsel("minmag").value);
  if (qsel("maxmag").value) p.set("maxmag", qsel("maxmag").value);
  if (qsel("limit").value)  p.set("limit", qsel("limit").value);
  if (qsel("orderby").value) p.set("orderby", qsel("orderby").value);
  if (qsel("format").value)  p.set("format", qsel("format").value);

  // Dikdörtgen
  const hasRect = qsel("minlat").value || qsel("maxlat").value || qsel("minlon").value || qsel("maxlon").value;
  if (qsel("minlat").value) p.set("minlat", qsel("minlat").value);
  if (qsel("maxlat").value) p.set("maxlat", qsel("maxlat").value);
  if (qsel("minlon").value) p.set("minlon", qsel("minlon").value);
  if (qsel("maxlon").value) p.set("maxlon", qsel("maxlon").value);

  // Radyal
  const hasRad = qsel("lat").value || qsel("lon").value || qsel("maxrad").value || qsel("minrad").value;
  if (qsel("lat").value)    p.set("lat", qsel("lat").value);
  if (qsel("lon").value)    p.set("lon", qsel("lon").value);
  if (qsel("maxrad").value) p.set("maxrad", qsel("maxrad").value);
  if (qsel("minrad").value) p.set("minrad", qsel("minrad").value);

  // Çakışma ipucu (ön tarafta da uyaralım)
  if (hasRect && hasRad) p.set("paramConflict", "1"); // Sadece UI uyarısı için

  // Derinlik / Tip
  if (qsel("mindepth").value) p.set("mindepth", qsel("mindepth").value);
  if (qsel("maxdepth").value) p.set("maxdepth", qsel("maxdepth").value);
  if (qsel("magtype").value)  p.set("magtype", qsel("magtype").value);

  // Gelişmiş
  if (qsel("offset").value)  p.set("offset", qsel("offset").value);
  if (qsel("eventid").value) p.set("eventid", qsel("eventid").value);

  return p;
}

function renderError(msg) {
  qsel("errorBox").textContent = `⚠️ ${msg}`;
}

function clearError() {
  qsel("errorBox").textContent = "";
}

function autoColumns(list) {
  const cols = new Set();
  list.forEach(obj => Object.keys(obj || {}).forEach(k => cols.add(k)));
  return Array.from(cols);
}

function setHeader(cols) {
  const thead = qsel("thead");
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  cols.forEach(c => {
    const th = document.createElement("th");
    th.textContent = c;
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

function normalizeToList(json) {
  // API yanıtı: { success, data, params, ... }
  const data = json?.data;

  // 1) JSON (eventList)
  if (Array.isArray(data?.eventList)) return data.eventList;

  // 2) GEOJSON (features[].properties)
  if (Array.isArray(data?.features)) {
    return data.features.map(f => ({ ...(f.properties || {}), geometry: f.geometry || null }));
  }

  // 3) CSV/XML/KML — metin formatları beklenmez; seçildiyse tablo yerine raw döndürmek mantıklı
  if (typeof data === "string") return [{ raw: data }];

  // 4) Direkt dizi
  if (Array.isArray(data)) return data;

  // 5) Bilinmeyen — object flatten
  if (data && typeof data === "object") return [data];

  return [];
}

async function fetchAndRender() {
  clearError();
  qsel("status").textContent = "Yükleniyor...";
  const params = buildParams();

  if (params.get("paramConflict") === "1") {
    renderError("Dikdörtgen ve radyal filtreler birlikte kullanılamaz.");
    qsel("status").textContent = "";
    return;
  }

  const url = `${API_BASE}?${params.toString()}`;

  try {
    const r = await fetch(url);
    const json = await r.json().catch(() => ({}));

    if (!r.ok || json.success === false) {
      const detail = json?.detail || `HTTP ${r.status}`;
      renderError(`${json?.code || "ERROR"}: ${detail}`);
      qsel("status").textContent = "";
      return;
    }

    const list = normalizeToList(json);
    if (!list.length) {
      qsel("thead").innerHTML = "";
      qsel("tbody").innerHTML = "";
      qsel("status").textContent = "Kayıt bulunamadı.";
      return;
    }

    const cols = autoColumns(list);
    setHeader(cols);
    setRows(cols, list);

    qsel("status").textContent = `Toplam ${list.length} kayıt • orderby=${params.get("orderby")} • format=${params.get("format")}`;
  } catch (e) {
    renderError(e.message || "Bilinmeyen hata");
    qsel("status").textContent = "";
  }
}

document.getElementById("fetchBtn").addEventListener("click", fetchAndRender);
window.addEventListener("DOMContentLoaded", fetchAndRender);

