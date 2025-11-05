// ===== Sismograf AFAD Proxy — Vercel Final (Full Compliance + Live Refresh) =====
// 👑 Majesteleri için: AFAD /apiv2/event/filter dokümanına %100 uyumlu
// Kaynak: https://deprem.afad.gov.tr/apiv2/event/filter

import axios from "axios";
import NodeCache from "node-cache";

const AFAD_URL = "https://deprem.afad.gov.tr/apiv2/event/filter";
const CACHE_SECONDS = 120;
const MAX_LIMIT = 2500;
const SAFE_LIMIT = 1000;
const cache = new NodeCache({ stdTTL: CACHE_SECONDS });

// AFAD zaman biçimi: YYYY-MM-DDThh:mm:ss (Z olmadan)
const toAfadTime = (d) => {
  const tzOffset = d.getTimezoneOffset() * 60000;
  const localTime = new Date(d - tzOffset);
  return localTime.toISOString().split(".")[0];
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")
    return res.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED" });

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  try {
    const q = req.query;
    const endDate = q.end ? new Date(q.end) : new Date();
    const startDate = q.start ? new Date(q.start) : new Date(Date.now() - 7 * 86400000);

    const params = {
      start: toAfadTime(startDate),
      end: toAfadTime(endDate),
      orderby: "timedesc", // AFAD sıralaması aktif
      format: "json",
      limit: Math.min(parseInt(q.limit || 1000), SAFE_LIMIT)
    };

    const cacheKey = JSON.stringify(params);
    const forceRefresh = q.nocache === "true" || q.nocache === "1";

    if (!forceRefresh) {
      const cached = cache.get(cacheKey);
      if (cached) return res.status(200).json({ success: true, cached: true, data: cached });
    }

    const r = await axios.get(AFAD_URL, { params, timeout: 10000 });
    if (!r.data) throw new Error("AFAD boş yanıt verdi");

    // AFAD bazı kayıtları origintime yerine eventDate ile gönderiyor
    // normalize ederek origintime alanını zorunlu hale getiriyoruz
    const normalized = (r.data || []).map(ev => ({
      ...ev,
      origintime: ev.origintime || ev.eventDate || ev.date || null
    }));

    cache.set(cacheKey, normalized);
    return res.status(200).json({ success: true, cached: false, data: normalized });
  } catch (err) {
    return res.status(502).json({ success: false, code: "AFAD_ERROR", detail: err.message });
  }
}
