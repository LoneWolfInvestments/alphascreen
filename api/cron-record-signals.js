// Once each weekday night, after the indicator shards and the market-light
// job have had their hour. Reads saved rows only. Does not call Twelve Data
// or Finnhub.

import { createClient } from "@supabase/supabase-js";
import { rejectIfCronUnauthorized } from "../server/cronAuth.js";
import { sendJob } from "../server/jobLog.js";
import { captureNight } from "../server/recordModelSignals.js";
import { isMissingModelTable } from "../src/lib/modelSignals.js";

function repoFrom(supabase) {
  return {
    watchlist: async () => {
      const { data, error } = await supabase.from("watchlist").select("symbol").eq("active", true);
      if (error) throw error;
      return data || [];
    },
    quotes: async () => {
      const { data, error } = await supabase.from("quotes").select("symbol, price, setup_label, suggested_stop, bar_date, updated_at");
      if (error) throw error;
      return data || [];
    },
    fundamentals: async () => {
      const { data, error } = await supabase.from("fundamental_scores").select("*");
      if (error) throw error;
      return data || [];
    },
    earnings: async () => {
      const { data, error } = await supabase.from("earnings_calendar").select("symbol, next_earnings_date, updated_at");
      if (error) return [];
      return data || [];
    },
    stress: async () => {
      const { data, error } = await supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1);
      if (error) return null;
      return (data || [])[0] || null;
    },
    states: async () => {
      const { data, error } = await supabase.from("model_signal_state").select("symbol, last_session, last_qualified, open_signal");
      if (error) throw error;
      return data || [];
    },
    openEpisodes: async () => {
      const { data, error } = await supabase.from("model_signals").select("id, symbol, signal_session, signal_close, initial_stop, target_price, policy_version");
      if (error) throw error;
      const outcomes = await supabase.from("model_signal_outcomes").select("signal_id, status");
      if (outcomes.error) throw outcomes.error;
      const status = new Map((outcomes.data || []).map((row) => [row.signal_id, row.status]));
      return (data || []).filter((row) => !status.has(row.id) || !["win", "loss", "expired", "ambiguous", "data_insufficient"].includes(status.get(row.id)))
        .map((row) => ({ ...row, symbol: String(row.symbol).toUpperCase() }));
    },
    bars: async (symbols, since) => {
      if (!symbols.length) return [];
      const { data, error } = await supabase.from("daily_bars").select("symbol, bar_date, open, high, low, close").in("symbol", symbols).gte("bar_date", since);
      if (error) throw error;
      return data || [];
    },
    saveOutcomes: async (rows) => {
      const payload = rows.map((row) => ({
        signal_id: row.signal_id,
        status: row.status,
        reason: row.reason,
        entry_date: row.entry_date,
        entry_open: row.entry_open,
        exit_date: row.exit_date,
        exit_price: row.exit_price,
        r_multiple: row.r_multiple,
        r_net: row.r_net,
        path_5_status: row.path_5_status,
        path_5: row.path_5,
        spy_5: row.spy_5,
        excess_5: row.excess_5,
        path_10_status: row.path_10_status,
        path_10: row.path_10,
        spy_10: row.spy_10,
        excess_10: row.excess_10,
        path_20_status: row.path_20_status,
        path_20: row.path_20,
        spy_20: row.spy_20,
        excess_20: row.excess_20,
        reviewed_session: row.reviewed_session,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("model_signal_outcomes").upsert(payload, { onConflict: "signal_id" });
      if (error) throw error;
    },
    insertSignals: async (rows) => {
      const { error } = await supabase.from("model_signals").insert(rows);
      if (error) throw error;
    },
    saveStates: async (rows) => {
      const { error } = await supabase.from("model_signal_state").upsert(rows, { onConflict: "symbol" });
      if (error) throw error;
    },
  };
}

export default async function handler(req, res) {
  if (rejectIfCronUnauthorized(req, res)) return;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const result = await captureNight(repoFrom(supabase), new Date());
    return sendJob(res, result.code, result.body, supabase, "model-signals");
  } catch (err) {
    if (isMissingModelTable(err)) {
      return sendJob(res, 500, {
        error: "The Buy candidate record is not installed yet. Paste schema-model-signals.sql into the Supabase SQL editor and run it. Nothing was recorded.",
      }, supabase, "model-signals");
    }
    return sendJob(res, 500, { error: "Model signal record failed", detail: err.message }, supabase, "model-signals");
  }
}
