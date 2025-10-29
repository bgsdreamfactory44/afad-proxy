const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();

// 2 dakikalık cache süresi
const cache = new NodeCache({ stdTTL: 120 });

// Render ve local için port ayarı
const PORT = process.env.PORT || 3000;

// AFAD API URL
const AFAD_URL = 'https://deprem.afad.gov.tr/EventData/GetEventsByFilter';

// Basit istek log sistemi
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Ana istek (veri alma)
app.get('/', async (req, res) => {
  try {
    // Önce cache kontrolü
    const cached = cache.get('data');
    if (cached) {
      console.log('✅ Cache kullanıldı');
      return res.json(cached);
    }

    // Tarih aralığı (son 24 saat)
    const now = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const payload = {
      EventSearchFilterList: [
        { FilterType: 8, Value: yesterday.toISOString() },
        { FilterType: 9, Value: now.toISOString() }
      ],
      Skip: 0,
      Take: 100
    };

    // AFAD’a istek at
    const response = await axios.post(AFAD_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BGsDreamFactory'
      },
      timeout: 10000 // 10 saniye sınır
    });

    // Veriyi kaydet ve döndür
    cache.set('data', response.data);
    console.log('🌍 AFAD verisi başarıyla alındı');
    res.json(response.data);

  } catch (error) {
    // Hata logu ve uygun HTTP kodu
    console.error('❌ AFAD veri çekme hatası:', error.message);
    res.status(502).json({
      error: 'AFAD verisi alınamadı',
      code: 'AFAD_UPSTREAM_ERROR'
    });
  }
});

// Sağlık kontrolü (Render bu sayede "Alive" kontrolü yapar)
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda çalışıyor...`);
});
