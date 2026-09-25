// src/components/Mag7.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Mag7() {
  const [rows, setRows] = useState([]);
  const [sortBy, setSortBy] = useState("perf_3m");

  const load = useCallback(async () => {
    const { data } = await supabase.from("mag7_performance").select("*");
    setRows(data || []);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("mag7-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "mag7_performance" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

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
        Ranks AAPL, MSFT, GOOGL, AMZN, META, and NVDA by price performance (TSLA excluded — not in your watchlist).
        Click a column header to re-rank by that period.
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th><th>Ticker</th><th>Price</th><th>3-Month</th><th>6-Month</th><th>12-Month</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.ticker}>
                <td>{i + 1}</td>
                <td><strong>{r.ticker}</strong></td>
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
