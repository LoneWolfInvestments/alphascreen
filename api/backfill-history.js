// One symbol, one Twelve Data call. Stores every returned daily bar in
// daily_bars (unique on symbol + the bar's own date) and refreshes that
// symbol's quote from the stored bars. Run it after adding a ticker, or let
// the nightly job do the same download.
//
// Usage: /api/backfill-history?symbol=TICKER
// Requires the same CRON_SECRET as the nightly jobs. No new API key.

import { createClient } from "@supabase/supabase-js";
import { rejectIfCronUnauthorized } from "../server/cronAuth.js";
import { buildQuotePayload, upsertQuotes } from "../server/buildQuote.js";
import { loadDailyBars, upsertDailyBars } from "../server/dailyBarsStore.js";
import { BENCHMARK_SYMBOL, fetchTwelveDailyBars, isMissingDailyBarsError } from "../server/twelveData.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (rejectIfCronUnauthorized(req, res)) return;

  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return res.status(400).json({ error: "Missing required query param: symbol" });
  }

  try {
    const bars = await fetchTwelveDailyBars(symbol);
    const saved = await upsertDailyBars(supabase, symbol, bars);
    if (saved.error) {
      if (isMissingDailyBarsError(saved.error)) {
        return res.status(500).json({
          error: "The daily_bars table is not there yet. In Supabase, open SQL Editor, paste schema-daily-bars.sql, run it, then try this again.",
        });
      }
      throw saved.error;
    }

    const listed = await supabase.from("watchlist").select("symbol").eq("symbol", symbol).maybeSingle();
    if (listed.error) throw listed.error;

    let quoteUpdated = false;
    if (listed.data) {
      const stored = await loadDailyBars(supabase, symbol);
      if (stored.error) throw stored.error;
      let spyBars = stored.bars;
      if (symbol !== BENCHMARK_SYMBOL) {
        const spy = await loadDailyBars(supabase, BENCHMARK_SYMBOL);
        if (spy.error) throw spy.error;
        spyBars = spy.bars;
      }
      const payload = buildQuotePayload({
        symbol,
        bars: stored.bars.length ? stored.bars : bars,
        spyBars,
      });
      const quote = await upsertQuotes(supabase, [payload]);
      if (quote.error) throw quote.error;
      quoteUpdated = true;
    }

    return res.status(200).json({
      symbol,
      barsStored: saved.count,
      dateRange: { from: bars[0].date, to: bars[bars.length - 1].date },
      quoteUpdated,
    });
  } catch (err) {
    return res.status(500).json({ error: "Backfill failed", detail: err.message });
  }
}
