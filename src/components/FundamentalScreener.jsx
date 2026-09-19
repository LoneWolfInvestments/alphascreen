// src/components/FundamentalScreener.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

function scoreFromInstitutional(institutional) {
  // institutional ranges -2..2; scale to 0-100 same as before for consistent thresholds
  return Math.round(((Number(institutional) + 2) / 4) * 100);
}
function signal(score) {
  if (score >= 65) return { label: "Buy", color: "#3ecf8e" };
  if (score <= 35) return { label: "Sell", color: "#f0555a" };
  return { label: "Hold", color: "#f0b955" };
}
const fmtNum = (n, digits = 2) => (n == null ? "—" : Number(n).toFixed(digits));
const fmtCap = (n) => {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n}`;
};

export default function FundamentalScreener() {
  const [rows, setRows] = useState([]);
  const [ticker, setTicker] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("fundamental_scores").select("*").order("ticker");
    setRows(data || []);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("fundamental-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const addTicker = async () => {
    if (!ticker.trim()) return;
    await supabase.from("fundamental_scores").upsert({
      ticker: ticker.trim().toUpperCase(),
      institutional: 0,
      updated_at: new Date().toISOString(),
    });
    setTicker("");
  };

  const removeRow = async (t) => {
    await supabase.from("fundamental_scores").delete().eq("ticker", t);
  };

  const sorted = [...rows].sort((a, b) => scoreFromInstitutional(b.institutional) - scoreFromInstitutional(a.institutional));

  return (
    <div className="panel">
      <h2>Fundamental Screener</h2>
      <div className="add-form">
        <div className="field" style={{ minWidth: 100 }}>
          <label>Add Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="AAPL" />
        </div>
        <button className="action" onClick={addTicker}>Add</button>
      </div>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Adding a ticker here just registers it so the monthly institutional flow automation has something to update —
        everything below fills in automatically from there.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th><th>Institutional Flow</th><th>Signal</th>
              <th>P/E</th><th>Mkt Cap</th><th>EPS</th><th>Margin</th><th>Next Earnings</th><th>Analyst</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const score = scoreFromInstitutional(r.institutional);
              const sig = signal(score);
              return (
                <tr key={r.ticker}>
                  <td><strong>{r.ticker}</strong></td>
                  <td>{r.institutional}</td>
                  <td><span className="badge" style={{ background: sig.color + "26", color: sig.color }}>{sig.label}</span></td>
                  <td>{fmtNum(r.pe_ratio, 1)}</td>
                  <td>{fmtCap(r.market_cap)}</td>
                  <td>{fmtNum(r.eps)}</td>
                  <td>{r.profit_margin != null ? `${(r.profit_margin * 100).toFixed(1)}%` : "—"}</td>
                  <td>{r.next_earnings_date || "—"}</td>
                  <td>{r.analyst_rating || "—"}</td>
                  <td><button className="action danger" onClick={() => removeRow(r.ticker)}>x</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No names screened yet — add a ticker above.</div>}
      </div>
      <p className="disclaimer">
        Institutional Flow, P/E, Market Cap, EPS, Margin, Next Earnings, and Analyst rating are all pulled
        automatically — nothing here needs manual entry beyond adding the ticker itself.
      </p>
    </div>
  );
}
