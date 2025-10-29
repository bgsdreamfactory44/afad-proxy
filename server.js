const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();

const CACHE_SECONDS = 120;
const DEFAULT_DAYS = 30;
const MAX_TAKE = 500;
const AFAD_URL = 'https://deprem.afad.gov.tr/EventData/GetEventsByFilter';
const cache = new NodeCache({ stdTTL: CACHE_SECONDS });

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
  const response = await axios.post(AFAD_URL, payload, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'BGsDreamFactory' },
    timeout: 10000
  });
  return response.data;
}

// === Rotalar ===
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

app.get('/api/events', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days || DEFAULT_DAYS, 10));
    const minMag = req.query.minMag ? parseFloat(req.query.minMag) : null;
    const limit = Math.min(MAX_TAKE, Math.max(10, parseInt(req.query.limit || MAX_TAKE, 10)));

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
    console.error('❌ /api/events hata:', error.message);
    res.status(502).json({ error: 'AFAD verisi alınamadı', code: 'AFAD_UPSTREAM_ERROR' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// 🔹 Vercel için express instance'ı export ediyoruz:
module.exports = app;
