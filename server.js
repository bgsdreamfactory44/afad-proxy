const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const app = express();
const cache = new NodeCache({ stdTTL: 60 });

const AFAD_URL = 'https://deprem.afad.gov.tr/EventData/GetEventsByFilter';

app.get('/', async (req, res) => {
  const cached = cache.get('data');
  if (cached) return res.json(cached);

  const now = new Date();
  const yesterday = new Date(Date.now() - 24*60*60*1000);

  const payload = {
    EventSearchFilterList: [
      { FilterType: 8, Value: yesterday.toISOString() },
      { FilterType: 9, Value: now.toISOString() }
    ],
    Skip: 0,
    Take: 100
  };

  try {
    const r = await axios.post(AFAD_URL, payload, {
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'BGsDreamFactory' }
    });
    cache.set('data', r.data);
    res.json(r.data);
  } catch (e) {
    res.json({ error: 'Veri alınamadı' });
  }
});

app.listen(3000, ()=>console.log('Running...'));
