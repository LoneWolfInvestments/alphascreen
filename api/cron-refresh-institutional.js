// api/cron-refresh-institutional.js
// Pulls institutional ownership data (derived from 13F filings) from Finnhub for
// every ticker in fundamental_scores, and updates the `institutional` field.
// Replaces the old individual-insider-trading automation.
//
// Note: 13F filings are quarterly, so this number will only meaningfully change
// every ~3 months even though the job runs daily — that's expected, not a bug.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchInstitutionalSignal(ticker) {
  const url = `https://finnhub.io/api/v1/stock/ownership?symbol=${ticker}&limit=20&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  const holders = data.ownership;
  if (!Array.isArray(holders) || holders.length === 0) return null;

  // Count how many of the top holders increased vs decreased their position
  // since the prior filing. Using breadth (how many, not by how much) rather
  // than summing raw share changes, since share-count scale varies wildly
  // between mega-caps and smaller names and isn't comparable across tickers.
  let increased = 0, decreased = 0;
  holders.forEach((h) => {
    if (typeof h.change === "number") {
      if (h.change > 0) increased += 1;
      else if (h.change < 0) decreased += 1;
    }
  });

  const total = increased + decreased;
  if (total === 0) return 0;
  const netBreadth = (increased - decreased) / total; // -1..1

  if (netBreadth > 0.5) return 2;
  if (netBreadth > 0) return 1;
  if (netBreadth === 0) return 0;
  if (netBreadth > -0.5) return -1;
  return -2;
}

export default async function handler(req, res) {
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!process.env.FINNHUB_API_KEY) {
    return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });
  }

  try {
    const { data: names } = await supabase.from("fundamental_scores").select("ticker");
    if (!names || names.length === 0) {
      return res.status(200).json({ message: "No tickers in fundamental_scores yet" });
    }

    const results = [];
    const failed = [];

    for (const { ticker } of names) {
      try {
        const signal = await fetchInstitutionalSignal(ticker);
        if (signal !== null) {
          await supabase.from("fundamental_scores").update({ institutional: signal, updated_at: new Date().toISOString() }).eq("ticker", ticker);
          results.push(ticker);
        }
      } catch (err) {
        failed.push({ ticker, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 1100)); // Finnhub free tier: 60 calls/min limit
    }

    return res.status(200).json({ updated: results.length, failed, total: names.length });
  } catch (err) {
    return res.status(500).json({ error: "Institutional flow refresh failed", detail: err.message });
  }
}
