// Vercel serverless function: /api/quote.js
// Env var needed: TWELVE_DATA_API_KEY (set in Vercel dashboard, never in client code)
// Only a signed-in owner can call this, and only for VIX plus symbols already
// on the watchlist. Results are cached for 60 seconds on this instance.

import { requireOwner } from "../server/requireOwner.js";
import { allowedInterval, clampOutputSize, normalizeSymbol } from "../server/quoteGuard.js";

const BASE_URL = "https://api.twelvedata.com";
const HOUR_MS = 60 * 60 * 1000;

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

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

async function symbolAllowed(supabase, symbol) {
  if (symbol === "VIX") return true;
  const { data, error } = await supabase.from("watchlist").select("symbol").eq("active", true);
  if (error) return false;
  return (data || []).some((row) => String(row.symbol).toUpperCase() === symbol);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const owner = await requireOwner(req, res, {
    bucket: "quote",
    limit: 60,
    windowMs: HOUR_MS,
  });
  if (!owner) return;

  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) {
    return res.status(400).json({ error: "Missing or invalid symbol" });
  }

  const endpoint = req.query.endpoint || "quote";
  const allowedEndpoints = ["quote", "rsi", "macd", "bbands", "time_series"];
  if (!allowedEndpoints.includes(endpoint)) {
    return res.status(400).json({ error: `Unsupported endpoint: ${endpoint}` });
  }

  const interval = allowedInterval(req.query.interval);
  if (!interval) {
    return res.status(400).json({ error: "Only the 1day interval is allowed" });
  }

  const allowed = await symbolAllowed(owner.supabase, symbol);
  if (!allowed) {
    return res.status(400).json({ error: "Symbol is not on the watchlist" });
  }

  if (!process.env.TWELVE_DATA_API_KEY) {
    return res.status(500).json({ error: "TWELVE_DATA_API_KEY is not configured" });
  }

  const outputSize = clampOutputSize(req.query.outputsize);
  const cacheKey = `${endpoint}:${symbol}:${interval}:${outputSize}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.status(200).json({ ...cached, _cached: true });
  }

  try {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);

    if (endpoint === "rsi" || endpoint === "macd" || endpoint === "bbands" || endpoint === "time_series") {
      url.searchParams.set("interval", interval);
    }
    if (endpoint === "time_series") {
      url.searchParams.set("outputsize", String(outputSize));
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
