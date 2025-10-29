// ====== BG's Dream Factory - AFAD Proxy (Vercel Edition - Advanced Error Logging) ======
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();

// ====== Sabitler ======
const CACHE_SECONDS = 120; // 2 dakika cache süresi
const DEFAULT_DAYS = 30;   // Varsayılan 30 gün
const MAX_TAKE = 500;      // Maksimum kayıt sayısı
const AFAD_URL = 'https://deprem.afad.gov.tr/event-service'; // AFAD ana endpoint

// ====== Cache ve CORS ======
const cache = new NodeCache({ stdTTL: CACHE_SECONDS });
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ====== Yardımcı Fonksiyon: AFAD API'den veri çekme ======
async function fetchAfadRange(startISO, endISO, take = MAX_TAKE) {
  const payload = {
    EventSearchFilterList: [
      { FilterType: 8, Value: startISO },
      { FilterType: 9, Value: endISO }
    ],
    Skip: 0,
    Take: take,
    SortDescriptor: { field: 'eventDate', dir: 'desc' }
  };

  try {
    const response = await axios.post(`${AFAD_URL}/event/filter`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BGsDreamFactory-Proxy'
      },
      timeout: 10000 // 10 saniye sınırı
    });

    // Beklenmedik boş yanıt kontrolü
    if (!response.data || typeof response.data !== 'object') {
      throw new Error('AFAD API’den beklenmeyen yanıt biçimi alındı.');
    }

    return response.data;

  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.error('⏰ Zaman aşımı: AFAD API yanıt vermedi.');
      throw new Error('AFAD API isteği zaman aşımına uğradı.');
    } else if (error.response) {
      console.error(`⚠️ AFAD API HTTP Hatası: ${error.response.status} ${error.response.statusText}`);
      throw new Error(`AFAD API HTTP ${error.response.status}: ${error.response.statusText}`);
    } else if (error.request) {
      console.error('🌐 AFAD API’ye istek gönderildi ancak yanıt alınamadı.');
      throw new Error('AFAD API’ye ulaşılamıyor. Ağ bağlantısı veya API geçici olarak kapalı olabilir.');
    } else {
      console.error('❌ fetchAfadRange genel hata:', error.message);
      throw new Error(`İşlem başarısız: ${error.message}`);
    }
  }
}

// ====== Ana Rota (Varsayılan - 30 Günlük Veri) ======
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
    console.error('❌ [Ana rota] Hata:', error.message);
    res.status(502).json({
      success: false,
      route: '/',
      error: 'AFAD verisi alınamadı',
      detail: error.message,
      code: 'AFAD_UPSTREAM_ERROR'
    });
  }
});

// ====== Esnek Rota (Parametre destekli) ======
app.get('/api/events', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days || DEFAULT_DAYS, 10));
    const minMag = req.query.minMag ? parseFloat(req.query.minMag) : null;
    const limit = Math.min(MAX_TAKE, Math.max(10, parseInt(req.query.limit || MAX_TAKE, 10)));

    if (isNaN(days) || days < 1 || days > 365) {
      return res.status(400).json({
        success: false,
        error: 'Geçersiz "days" parametresi. 1 ile 365 arasında bir değer olmalıdır.'
      });
    }

    const now = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const cacheKey = `afad_${days}d_${limit}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log(`✅ Cache (${days} gün) kullanıldı`);
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

    let finalData = data;
    if (minMag && Array.isArray(data.eventList)) {
      finalData = {
        ...data,
        eventList: data.eventList.filter(ev => parseFloat(ev?.magnitude) >= minMag)
      };
    }

    cache.set(cacheKey, data);
    console.log(`🌍 AFAD verisi (${days} gün) alındı`);
    res.json(finalData);

  } catch (error) {
    console.error('❌ [/api/events] Hata:', error.message);
    res.status(502).json({
      success: false,
      route: '/api/events',
      error: 'AFAD verisi alınamadı',
      detail: error.message,
      code: 'AFAD_UPSTREAM_ERROR'
    });
  }
});

// ====== Sağlık Kontrolü ======
app.get('/api/health', (req, res) => {
  try {
    res.json({ ok: true, timestamp: new Date().toISOString(), service: 'AFAD Proxy' });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Sağlık kontrolü başarısız.',
      detail: error.message
    });
  }
});

// ====== Global Hata Yakalama (Express Fallback) ======
app.use((err, req, res, next) => {
  console.error('🔥 Global hata yakalandı:', err.stack);
  res.status(500).json({
    success: false,
    route: req.originalUrl,
    error: 'Sunucu iç hatası oluştu.',
    detail: err.message
  });
});

// ====== Vercel uyumlu export ======
module.exports = app;
