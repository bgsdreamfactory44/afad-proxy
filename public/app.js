// ===== Sismograf Frontend (Revizyon 6.0 – AFAD Tam Uyumlu) =====
// 👑 Majesteleri'nin talimatlarıyla: Gerçek tarih nesnesiyle sıralama + kararlı sistem
function qsel(id) { return document.getElementById(id); }

// 🧭 AFAD tarih formatı: YYYY-MM-DD hh:mm:ss
function toAfadTime(d) {
  const pad = n => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// === Global değişkenler ===
let fullData = [], filteredData = [];
let currentPage = 1;
const perPage = 15, autoRefreshMS = 120000;
let autoTimer = null;

// === Spinner ===
function showSpinner() {
  const s = qsel("status");
  if (!s.querySelector(".spinner")) {
    const sp = document.createElement("div");
    sp.className = "spinner";
    s.appendChild(sp);
  }
  s.querySelector(".spinner").style.display = "inline-block";
}
function hideSpinner() {
  const sp = qsel("status").querySelector(".spinner");
  if (sp) sp.style.display = "none";
}

// === Parametre Hazırlama ===
function buildParams() {
  const p = new URLSearchParams();
  const limit = 2500;
  const startInput = qsel("startDate")?.value;
  const endInput = qsel("endDate")?.value;
  const end = endInput ? new Date(endInput) : new Date();
  const start = startInput ? new Date(startInput) : new Date(Date.now() - 30 * 86400000);

  p.set("start", toAfadTime(start));
  p.set("end", toAfadTime(end));
  p.set("limit", limit.toString());
  p.set("orderby", "timedesc");
  p.set("format", "json");
  return p;
}

// === Hata Yönetimi ===
function renderError(msg){ qsel("errorBox").textContent = `⚠️ ${msg}`; }
function clearError(){ qsel("errorBox").textContent = ""; }

// === Tablo Görünümü ===
function translateColumnName(k){
  const map = {
    latitude:"Enlem",longitude:"Boylam",depth:"Derinlik (km)",rms:"RMS",
    location:"Konum",magnitude:"Şiddet",province:"Şehir",district:"İlçe",
    date:"Tarih",eventDate:"Tarih",origintime:"Tarih"
  };
  return map[k] || k;
}
function shouldHideColumn(k){ return ["eventid","eventID","type","isEventUpdate","lastUpdateDate","__ts"].includes(k); }
function autoColumns(list){
  const cols = new Set();
  list.forEach(o=>Object.keys(o||{}).forEach(k=>{if(!shouldHideColumn(k))cols.add(k);}));
  return Array.from(cols);
}
function setHeader(cols){
  const thead=qsel("thead");
  thead.innerHTML="";
  const tr=document.createElement("tr");
  cols.forEach(c=>{
    const th=document.createElement("th");
    th.textContent=translateColumnName(c);
    tr.appendChild(th);
  });
  thead.appendChild(tr);
}
function setRows(cols,list){
  const tbody=qsel("tbody");
  tbody.innerHTML="";
  list.forEach(obj=>{
    const tr=document.createElement("tr");
    cols.forEach(c=>{
      const td=document.createElement("td");
      let val=obj?.[c]??"";
      if(typeof val==="object"&&val!==null)val=JSON.stringify(val);
      td.textContent=val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// === Veri Normalizasyonu ===
function normalizeToList(json){
  const d=json?.data;
  if(Array.isArray(d))return d;
  if(Array.isArray(d?.eventList))return d.eventList;
  if(Array.isArray(d?.features))return d.features.map(f=>({...f.properties}));
  if(d&&typeof d==="object")return [d];
  return [];
}

// === Tarih Alanı ===
function getEventTime(ev){
  return ev.eventDate || ev.origintime || ev.date || ev.time || null;
}

// === Gerçek Tarih Nesnesiyle Sıralama ===
function sortByDateDesc(list){
  return list.sort((a,b)=>{
    const ta=new Date(getEventTime(a));
    const tb=new Date(getEventTime(b));
    return tb - ta; // 🔹 en yeni üstte
  });
}

// === Sayfalama ===
function renderPagination(){
  const totalPages=Math.ceil(filteredData.length/perPage);
  const footer=document.querySelector("footer");
  footer.innerHTML=`<small>Sayfa ${currentPage}/${totalPages} • Toplam ${filteredData.length} kayıt</small>`;
  if(totalPages>1){
    const prev=document.createElement("button"),next=document.createElement("button");
    prev.textContent="← Önceki";next.textContent="Sonraki →";
    prev.disabled=currentPage===1;next.disabled=currentPage===totalPages;
    prev.onclick=()=>{currentPage--;renderTable();};
    next.onclick=()=>{currentPage++;renderTable();};
    footer.appendChild(document.createElement("br"));
    footer.appendChild(prev);footer.appendChild(next);
  }
}

// === Tablo Güncelle ===
function renderTable(){
  const list=filteredData.slice((currentPage-1)*perPage,currentPage*perPage);
  const cols=autoColumns(list);
  setHeader(cols);setRows(cols,list);renderPagination();
}

// === Şiddet Filtresi ===
function applyMagnitudeFilter(){
  const active=Array.from(document.querySelectorAll(".mag-btn.active")).map(b=>b.dataset.range);
  if(!active.length){filteredData=fullData;return;}
  filteredData=fullData.filter(ev=>{
    const m=parseFloat(ev.magnitude);
    return active.some(r=>
      (r==="0-2"&&m<2)||(r==="2-4"&&m>=2&&m<4)||(r==="4-6"&&m>=4&&m<6)||
      (r==="6-8"&&m>=6&&m<8)||(r==="8+"&&m>=8)
    );
  });
}

// === Veri Çek ===
async function fetchAndRender(){
  clearError();showSpinner();
  const params=buildParams();
  const url=`${API_BASE}?${params.toString()}&nocache=true&_t=${Date.now()}`;
  try{
    const r=await fetch(url);
    const json=await r.json().catch(()=>({}));
    if(!r.ok||json.success===false){
      renderError(json?.detail||`HTTP ${r.status}`);return;
    }
    fullData=normalizeToList(json);
    fullData=sortByDateDesc(fullData.filter(e=>getEventTime(e)));
    applyMagnitudeFilter();currentPage=1;renderTable();
  }catch(e){renderError(e.message||"Veri alınamadı");}
  finally{hideSpinner();}
}

// === Olaylar ===
function setupMagnitudeButtons(){
  document.querySelectorAll(".mag-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      btn.classList.toggle("active");
      applyMagnitudeFilter();
      currentPage=1;
      renderTable();
    });
  });
}
function startAutoRefresh(){
  if(autoTimer)clearInterval(autoTimer);
  autoTimer=setInterval(fetchAndRender,autoRefreshMS);
}

// === Başlat ===
window.addEventListener("DOMContentLoaded",()=>{
  setupMagnitudeButtons();
  fetchAndRender();
  startAutoRefresh();
});
document.getElementById("fetchBtn").addEventListener("click",fetchAndRender);
