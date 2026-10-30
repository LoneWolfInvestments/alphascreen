import { barsToRows, rowsToBars } from "./twelveData.js";

// Indicators need about a year. The table itself keeps every bar ever saved.
const READ_LIMIT = 400;

export async function upsertDailyBars(supabase, symbol, bars) {
  const rows = barsToRows(symbol, bars);
  if (!rows.length) return { error: null, count: 0 };
  const { error } = await supabase.from("daily_bars").upsert(rows, { onConflict: "symbol,bar_date" });
  return { error, count: rows.length };
}

export async function loadDailyBars(supabase, symbol, limit = READ_LIMIT) {
  const { data, error } = await supabase
    .from("daily_bars")
    .select("bar_date, open, high, low, close, volume")
    .eq("symbol", symbol)
    .order("bar_date", { ascending: false })
    .limit(limit);
  if (error) return { error, bars: [] };
  return { error: null, bars: rowsToBars(data || []) };
}
