// Vercel serverless function: /api/quote.js
// Deploy path: place this file at /api/quote.js in your project root (Vercel auto-detects it)
// Env var needed: TWELVE_DATA_API_KEY (set in Vercel dashboard, never in client code)

const BASE_URL = "https://api.twelvedata.com";

// Simple in-memory cache to avoid burning through rate limits on repeated requests.
// Resets on cold start — fine for a free-tier screener; swap for Redis/Supabase if you scale up.
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60s — adjust based on your rate limit budget

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

export default async function handler(req, res) {
  const { symbol, endpoint = "quote" } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: "Missing required query param: symbol" });
  }

  // Allowlist which Twelve Data endpoints this proxy will forward.
  // Extend this as you wire in more AlphaScreen tabs.
  const allowedEndpoints = ["quote", "rsi", "macd", "bbands", "time_series"];
  if (!allowedEndpoints.includes(endpoint)) {
    return res.status(400).json({ error: `Unsupported endpoint: ${endpoint}` });
  }

  const cacheKey = `${endpoint}:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.status(200).json({ ...cached, _cached: true });
  }

  try {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);

    // Reasonable defaults for indicator endpoints — override via extra query params if needed
    if (endpoint === "rsi" || endpoint === "macd" || endpoint === "bbands") {
      url.searchParams.set("interval", req.query.interval || "1day");
    }
    if (endpoint === "time_series") {
      url.searchParams.set("interval", req.query.interval || "1day");
      url.searchParams.set("outputsize", req.query.outputsize || "30");
    }

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === "error") {
      return res.status(502).json({ error: data.message || "Twelve Data returned an error" });
    }

    setCache(cacheKey, data);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch from Twelve Data", detail: err.message });
  }
}
