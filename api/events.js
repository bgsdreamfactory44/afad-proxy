// ===== Sismograf AFAD Proxy — Vercel Final (Full Compliance + Live Refresh) =====
// 👑 Majesteleri için: AFAD /apiv2/event/filter dokümanına %100 uyumlu
// Kaynak: https://deprem.afad.gov.tr/apiv2/event/filter

import axios from "axios";
import NodeCache from "node-cache";

const AFAD_URL = "https://deprem.afad.gov.tr/apiv2/event/filter";
const CACHE_SECONDS = 120;
const MAX_LIMIT = 2500;  // AFAD limit üst sınır
const SAFE_LIMIT = 1000; // Proxy koruma sınırı
const cache = new NodeCache({ stdTTL: CACHE_SECONDS });

// AFAD zaman biçimi: YYYY-MM-DDThh:mm:ss (Z olmadan)
const toAfadTime = (d) => new Date(d).toISOString().split(".")[0];
const pFloat = (v) => (v !== undefined ? parseFloat(v) : undefined);
const pInt = (v) => (v !== undefined ? parseInt(v, 10) : undefined);

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED", detail: "Only GET is supported." });
  }

  // --- Cache ve tarayıcı önbelleği devre dışı ---
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const q = req.query;

    // ---- Zaman: start/end zorunlu, yoksa son 7 gün ----
    const endDate = q.end ? new Date(q.end) : new Date();
    const startDate = q.start ? new Date(q.start) : new Date(Date.now() - 7 * 86400000);

    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({
        success: false,
        code: "BAD_REQUEST",
        detail: "Invalid start/end datetime format (expected YYYY-MM-DDThh:mm:ss).",
      });
    }

    // ---- Coğrafi parametre çakışması ----
    const hasRect = q.minlat || q.maxlat || q.minlon || q.maxlon;
    const hasRad = q.lat || q.lon || q.maxrad || q.minrad;
    if (hasRect && hasRad) {
      return res.status(400).json({
        success: false,
        code: "PARAM_CONFLICT",
        detail: "Rectangle bounds and radial bounds cannot be used together.",
      });
    }

    // ---- Parametreleri AFAD formatına hazırla ----
    const params = {
      start: toAfadTime(startDate),
      end: toAfadTime(endDate),
      orderby: q.orderby || "timedesc",
      format: q.format || "json",
    };

    // Limit ve offset
    if (q.limit !== undefined) {
      const lim = Math.max(0, Math.min(pInt(q.limit), MAX_LIMIT));
      params.limit = Math.min(lim, SAFE_LIMIT);
    }
    if (q.offset !== undefined) {
      const off = Math.max(0, pInt(q.offset));
      params.offset = off;
    }

    // Dikdörtgen sınırlar
    if (hasRect) {
      if (q.minlat !== undefined) params.minlat = pFloat(q.minlat);
      if (q.maxlat !== undefined) params.maxlat = pFloat(q.maxlat);
      if (q.minlon !== undefined) params.minlon = pFloat(q.minlon);
      if (q.maxlon !== undefined) params.maxlon = pFloat(q.maxlon);
    }

    // Radyal sınırlar
    if (hasRad) {
      if (!q.lat || !q.lon || !q.maxrad) {
        return res.status(400).json({
          success: false,
          code: "BAD_REQUEST",
          detail: "For radial filter, lat, lon and maxrad are required (minrad optional).",
        });
      }
      params.lat = pFloat(q.lat);
      params.lon = pFloat(q.lon);
      params.maxrad = pFloat(q.maxrad);
      if (q.minrad !== undefined) params.minrad = pFloat(q.minrad);
    }

    // Derinlik / Büyüklük / Tip
    if (q.mindepth !== undefined) params.mindepth = pFloat(q.mindepth);
    if (q.maxdepth !== undefined) params.maxdepth = pFloat(q.maxdepth);
    if (q.minmag !== undefined) params.minmag = pFloat(q.minmag);
    if (q.maxmag !== undefined) params.maxmag = pFloat(q.maxmag);
    if (q.magtype !== undefined) params.magtype = q.magtype;

    // Tekil event
    if (q.eventid !== undefined) params.eventid = pInt(q.eventid);

    // ---- Cache anahtarı ----
    const cacheKey = JSON.stringify(params);

    // Eğer frontend "nocache" parametresi gönderdiyse cache'i atla (zorunlu yenile)
    const forceRefresh = q.nocache === "true" || q.nocache === "1";

    if (!forceRefresh) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.status(200).json({
          success: true,
          cached: true,
          params,
          data: cached,
          fetchedAt: new Date().toISOString(),
        });
      }
    }

    // ---- AFAD isteği ----
    const r = await axios.get(AFAD_URL, { params, timeout: 12000 });
    if (!r.data) {
      return res.status(502).json({
        success: false,
        code: "AFAD_UPSTREAM_EMPTY",
        detail: "AFAD responded with empty body.",
      });
    }

    cache.set(cacheKey, r.data);
    return res.status(200).json({
      success: true,
      cached: false,
      params,
      data: r.data,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    let code = "AFAD_UPSTREAM_ERROR",
      status = 502,
      detail = err?.message || "Unknown error";

    if (err.code === "ECONNABORTED") {
      code = "AFAD_TIMEOUT";
      detail = "AFAD request timed out.";
    } else if (err.response) {
      status = err.response.status;
      code = "AFAD_HTTP_ERROR";
      detail = `HTTP ${err.response.status} ${err.response.statusText}`;
    } else if (err.request) {
      code = "AFAD_NO_RESPONSE";
      detail = "No response from AFAD (network/server).";
    }

    return res.status(status).json({
      success: false,
      code,
      detail,
      timestamp: new Date().toISOString(),
    });
  }
}
