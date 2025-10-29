const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();

// ====== Ayarlar ======
const PORT = process.env.PORT || 3000;
const CACHE_SECONDS = 120;                 // 2 dk cache
const DEFAULT_DAYS = 30;                   // Varsayılan 30 gün
const MAX_TAKE = 500;                      // AFAD'a tek seferde istenecek kayıt
const AFAD_URL = 'https://deprem.afad.gov.tr/EventData/GetEventsByFilter';

// Cache ve CORS
const cache = new NodeCache({ stdTTL: CACHE_SECONDS });
app.use((req, res, next) => {
  // Basit log
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  // Geniş CORS (frontend farklı domainde çalışabilsin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Yardımcı: AFAD isteği (verilen tarih aralığıyla)
async function fetchAfadRange(startISO, endISO, take = MAX_TAKE) {
  const payload = {
    EventSearchFilterList: [
      { FilterType: 8, Value: startISO }, // start
      { FilterType: 9, Value: endISO }    // end
    ],
    Skip: 0,
    Take: take,
    SortDescriptor: { field: 'eventDate', dir: 'desc' }
  };
  const response = await axios.post(AFAD_URL, payload, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'BGsDreamFactory' },
    timeout: 10000
  });
  return response.data;
}

// === 1) Eski rota (geriye uyum) — her zaman 30 gün getirir ===
app.get('/', async (req, res) => {
  try {
    const cacheKey = 'afad_30days';
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('✅ Cache (30 gün) kullanıldı');
      return res.json(cached);
    }
    const now = new Date();
    const start = new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);
    const data = await fetchAfadRange(start.toISOString(), now.toISOString(), MAX_TAKE);
    cache.set(cacheKey, data);
    console.log('🌍 AFAD verisi (30 gün) alındı');
    res.json(data);
  } catch (error) {
    console.error('❌ AFAD 30g hata:', error.message);
    res.status(502).json({ error: 'AFAD verisi alınamadı', code: 'AFAD_UPSTREAM_ERROR' });
  }
});

// === 2) Esnek rota — parametre destekli (isteğe bağlı filtreleme)
app.get('/api/events', async (req, res) => {
  try {
    // Query parametreleri (hepsi opsiyonel)
    // ?days=30&minMag=3.5&limit=200
    const days = Math.max(1, parseInt(req.query.days || DEFAULT_DAYS, 10));
    const minMag = req.query.minMag ? parseFloat(req.query.minMag) : null;
    const limit = Math.min(MAX_TAKE, Math.max(10, parseInt(req.query.limit || MAX_TAKE, 10)));

    const now = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cacheKey = `afad_${days}d_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`✅ Cache (${days} gün) kullanıldı`);
      // Cache'de varsa burada da minMag uygulayalım (hafif sunucu filtresi)
      let result = cached;
      if (minMag && Array.isArray(result.eventList)) {
        result = {
          ...result,
          eventList: result.eventList.filter(ev => parseFloat(ev?.magnitude) >= minMag)
        };
      }
      return res.json(result);
    }

    const data = await fetchAfadRange(start.toISOString(), now.toISOString(), limit);

    // İsteğe bağlı sunucu tarafı minMag filtresi
    let finalData = data;
    if (minMag && Array.isArray(data.eventList)) {
      finalData = {
        ...data,
        eventList: data.eventList.filter(ev => parseFloat(ev?.magnitude) >= minMag)
      };
    }

    cache.set(cacheKey, data); // ham veriyi cache'le
    console.log(`🌍 AFAD verisi (${days} gün) alındı`);
    res.json(finalData);
  } catch (error) {
    console.error('❌ /api/events hata:', error.message);
    res.status(502).json({ error: 'AFAD verisi alınamadı', code: 'AFAD_UPSTREAM_ERROR' });
  }
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Sunucu
app.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda çalışıyor (varsayılan 30 gün, cache ${CACHE_SECONDS}s).`);
});
