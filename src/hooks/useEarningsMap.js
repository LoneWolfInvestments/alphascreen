import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { sampleEarningsBySymbol } from "../lib/sellSignalsSample";

// Calendar dates win when that table has a row. Otherwise fall back to the
// date the weekly screener job already stores. A missing table is ignored so
// the screens keep working before schema-sell-signals.sql is run.
export function useEarningsMap() {
  const [bySymbol, setBySymbol] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    if (previewSample()) {
      const sample = {};
      for (const [symbol, date] of Object.entries(sampleEarningsBySymbol())) {
        sample[symbol] = { date: date || null, source: "calendar" };
      }
      setBySymbol(sample);
      setUpdatedAt("2026-10-30T21:30:00.000Z");
      return;
    }

    const [calendar, scores] = await Promise.all([
      supabase.from("earnings_calendar").select("symbol, next_earnings_date, updated_at"),
      supabase.from("fundamental_scores").select("ticker, next_earnings_date"),
    ]);

    const next = {};
    for (const row of scores.data || []) {
      next[row.ticker] = { date: row.next_earnings_date || null, source: "scores" };
    }
    let latest = null;
    if (!calendar.error) {
      for (const row of calendar.data || []) {
        next[row.symbol] = { date: row.next_earnings_date || null, source: "calendar" };
        if (row.updated_at && (!latest || row.updated_at > latest)) latest = row.updated_at;
      }
    }
    setBySymbol(next);
    setUpdatedAt(latest);
  }, []);

  useEffect(() => {
    load();
    if (previewSample()) return undefined;
    const channel = supabase
      .channel("earnings-dates")
      .on("postgres_changes", { event: "*", schema: "public", table: "earnings_calendar" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  return { bySymbol, updatedAt, reload: load };
}

export function earningsDateFor(bySymbol, ticker, fallback) {
  const entry = bySymbol?.[ticker];
  if (!entry) return fallback || null;
  if (entry.source === "calendar") return entry.date || null;
  return entry.date || fallback || null;
}
