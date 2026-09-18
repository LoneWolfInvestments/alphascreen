// api/cron-refresh-cot.js
// Pulls CFTC Commitment of Traders (Legacy Futures Only) data — free, public,
// no API key required — and updates the Positioning table's cot_net field for
// a curated list of assets relevant to the bottleneck thesis / macro overlays.
//
// CFTC updates this once a week (Fridays for the prior Tuesday's data), so
// this only needs to run weekly, not daily — but running it daily is harmless,
// it'll just refetch the same week's data until CFTC publishes the next one.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Map your Positioning tab's asset names to CFTC's official market names.
// Add more pairs here as needed — CFTC market names must match exactly.
const ASSET_MAP = {
  "Copper": "COPPER-GRADE #1",
  "Crude Oil": "CRUDE OIL, LIGHT SWEET-WTI",
  "Gold": "GOLD",
  "Silver": "SILVER",
  "VIX": "VIX FUTURES",
  "S&P 500": "E-MINI S&P 500",
  "Natural Gas": "NATURAL GAS",
};

async function fetchCotNet(cftcName) {
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=market_and_exchange_names like '%25${encodeURIComponent(cftcName)}%25'&$order=report_date_as_yyyy_mm_dd DESC&$limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CFTC API returned ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const row = data[0];
  // Legacy report: noncommercial (speculative) long minus short = net spec positioning
  const long = parseFloat(row.noncomm_positions_long_all) || 0;
  const short = parseFloat(row.noncomm_positions_short_all) || 0;
  return long - short;
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const results = [];
    const failed = [];

    for (const [assetLabel, cftcName] of Object.entries(ASSET_MAP)) {
      try {
        const net = await fetchCotNet(cftcName);
        if (net !== null) {
          // Upsert-like behavior: update if an entry with this asset name exists, else insert
          const { data: existing } = await supabase.from("positioning").select("id").eq("asset", assetLabel).limit(1);
          if (existing && existing.length > 0) {
            await supabase.from("positioning").update({ cot_net: net }).eq("id", existing[0].id);
          } else {
            await supabase.from("positioning").insert({ asset: assetLabel, cot_net: net, cta: "Neutral", gex: 0 });
          }
          results.push(assetLabel);
        }
      } catch (err) {
        failed.push({ asset: assetLabel, error: err.message });
      }
    }

    return res.status(200).json({ updated: results.length, failed, total: Object.keys(ASSET_MAP).length });
  } catch (err) {
    return res.status(500).json({ error: "COT refresh failed", detail: err.message });
  }
}
