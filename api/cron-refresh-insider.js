// api/cron-refresh-insider.js
// Pulls recent insider transactions from Finnhub (free tier) for every ticker in
// fundamental_scores, and updates the `insider` field automatically instead of
// requiring manual entry.
//
// Sign up free at finnhub.io, add FINNHUB_API_KEY to Vercel env vars.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchInsiderSignal(ticker) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // last 90 days

  const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.data) return null;

  // Simple net signal: sum (shares bought - shares sold) across recent filings,
  // then bucket into the same -2..2 scale the rest of the screener uses.
  let netShares = 0;
  data.data.forEach((tx) => {
    const change = tx.change || 0; // Finnhub: positive = acquired, negative = disposed
    netShares += change;
  });

  if (netShares > 100000) return 2;
  if (netShares > 0) return 1;
  if (netShares === 0) return 0;
  if (netShares > -100000) return -1;
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
        const signal = await fetchInsiderSignal(ticker);
        if (signal !== null) {
          await supabase.from("fundamental_scores").update({ insider: signal, updated_at: new Date().toISOString() }).eq("ticker", ticker);
          results.push(ticker);
        }
      } catch (err) {
        failed.push({ ticker, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 1100)); // Finnhub free tier: 60 calls/min limit
    }

    return res.status(200).json({ updated: results.length, failed, total: names.length });
  } catch (err) {
    return res.status(500).json({ error: "Insider refresh failed", detail: err.message });
  }
}
