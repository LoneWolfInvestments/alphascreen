// src/components/Mag7.jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { useEarningsMap } from "../hooks/useEarningsMap";
import { buildDecisionRows } from "../lib/decisionBook";
import { nyToday } from "../lib/sellSignals";
import { lastCompletedSession } from "../lib/sessionClock";

export default function Mag7() {
  const { ready, session } = useOwnerSession();
  const earnings = useEarningsMap();
  const [rows, setRows] = useState([]);
  const [context, setContext] = useState({ quotes: [], fundamentals: [], stress: null, holdings: [], holdingsKnown: false });
  const [sortBy, setSortBy] = useState("perf_3m");

  const load = useCallback(async (userId) => {
    const [performance, quotes, fundamentals, stress, portfolio] = await Promise.all([
      supabase.from("mag7_performance").select("*"),
      supabase.from("quotes").select("symbol, price, setup_label, suggested_stop, chandelier_stop, bar_date, rs_3m, rs_6m, rs_12m, rs_composite"),
      supabase.from("fundamental_scores").select("*"),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
      userId ? supabase.from("portfolio").select("ticker, shares, cost_basis, theme") : Promise.resolve({ data: [], error: null }),
    ]);
    setRows(performance.data || []);
    setContext({
      quotes: quotes.data || [],
      fundamentals: fundamentals.data || [],
      stress: stress.error ? null : (stress.data || [])[0] || null,
      holdings: portfolio.error ? [] : (portfolio.data || []),
      holdingsKnown: Boolean(userId) && !portfolio.error,
    });
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const userId = session?.user?.id || null;
    setContext({ quotes: [], fundamentals: [], stress: null, holdings: [], holdingsKnown: false });
    setRows([]);
    load(userId);
    const channel = supabase
      .channel("mag7-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "mag7_performance" }, () => load(userId))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, ready, session?.user?.id]);

  const decisions = useMemo(() => buildDecisionRows({
    quotes: context.quotes,
    fundamentals: context.fundamentals,
    holdings: context.holdings,
    holdingsKnown: context.holdingsKnown,
    stress: context.stress,
    earningsBySymbol: earnings.bySymbol,
    now: new Date(),
    today: nyToday(),
  }).byTicker, [context, earnings.bySymbol]);
  const priceSession = lastCompletedSession(new Date());
  const downloads = rows.map((row) => row.updated_at).filter(Boolean).sort();
  const downloaded = downloads.length ? downloads[downloads.length - 1] : null;

  const sorted = [...rows].sort((a, b) => (b[sortBy] ?? -Infinity) - (a[sortBy] ?? -Infinity));

  const fmtPct = (n) => {
    if (n == null) return "—";
    const color = n >= 0 ? "#3ecf8e" : "#f0555a";
    return <span style={{ color }}>{n >= 0 ? "+" : ""}{n.toFixed(1)}%</span>;
  };

  const periodLabel = { perf_3m: "3-Month", perf_6m: "6-Month", perf_12m: "12-Month" };

  return (
    <div className="panel">
      <h2>MAG7 Performance</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Ranks the saved set: AAPL, MSFT, GOOGL, AMZN, META, and NVDA. Tesla is not in this set, and no price is invented for it.
        Ranks and returns are descriptive. They are not a buy or a sell. The decision is the same one as Signals. This table does not store a price session. The download time is when the percents were saved, which can be an older close than Signals.
      </p>

      <div className="add-form" style={{ marginBottom: 12 }}>
        {Object.entries(periodLabel).map(([key, label]) => (
          <button
            key={key}
            className={sortBy === key ? "action" : "action secondary"}
            onClick={() => setSortBy(key)}
          >
            Rank by {label}
          </button>
        ))}
      </div>

      <p className="sync-note">
        {downloaded ? `Percents downloaded ${new Date(downloaded).toLocaleString()}.` : "No MAG7 download time is saved."}
        {priceSession ? ` Latest completed price session is ${priceSession}.` : ""}
        {" "}Do not treat the download time as that session.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th><th>Ticker</th><th>Decision</th><th>Signals session</th><th>Saved price</th><th>3-Month</th><th>6-Month</th><th>12-Month</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.ticker}>
                <td>{i + 1}</td>
                <td><strong>{r.ticker}</strong></td>
                <td>{decisions.get(r.ticker)?.assessment || "—"}</td>
                <td>{decisions.get(r.ticker)?.barDate || "No Signals session"}</td>
                <td>{r.price != null ? Number(r.price).toFixed(2) : "—"}</td>
                <td>{fmtPct(r.perf_3m)}</td>
                <td>{fmtPct(r.perf_6m)}</td>
                <td>{fmtPct(r.perf_12m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No data yet — trigger the MAG7 refresh to populate this.</div>}
      </div>
    </div>
  );
}
