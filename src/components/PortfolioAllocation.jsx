// src/components/PortfolioAllocation.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const COLORS = ["#4f8dfd", "#3ecf8e", "#f0b955", "#f0555a", "#a06cf5", "#4fd1c5", "#f57ec1", "#9aa5b1"];

export default function PortfolioAllocation() {
  const [rows, setRows] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [form, setForm] = useState({ ticker: "", sector: "", shares: "", cost_basis: "", conviction: 3 });

  const load = useCallback(async () => {
    const [p, q] = await Promise.all([
      supabase.from("portfolio").select("*").order("ticker"),
      supabase.from("quotes").select("symbol, price"),
    ]);
    setRows(p.data || []);
    setQuotes(q.data || []);
  }, []);

  useEffect(() => {
    load();
    const c1 = supabase.channel("portfolio-changes").on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, load).subscribe();
    const c2 = supabase.channel("portfolio-quotes").on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, load).subscribe();
    return () => { supabase.removeChannel(c1); supabase.removeChannel(c2); };
  }, [load]);

  const addRow = async () => {
    if (!form.ticker.trim()) return;
    await supabase.from("portfolio").upsert({
      ticker: form.ticker.trim().toUpperCase(),
      sector: form.sector.trim() || "Unclassified",
      shares: Number(form.shares) || 0,
      cost_basis: Number(form.cost_basis) || 0,
      conviction: Number(form.conviction) || 3,
      updated_at: new Date().toISOString(),
    });
    setForm({ ticker: "", sector: "", shares: "", cost_basis: "", conviction: 3 });
  };

  const removeRow = async (ticker) => {
    await supabase.from("portfolio").delete().eq("ticker", ticker);
  };

  // Join each position with its live price and derive everything else
  const enriched = rows.map((r) => {
    const q = quotes.find((qq) => qq.symbol === r.ticker);
    const currentPrice = q ? Number(q.price) : null;
    const marketValue = currentPrice != null ? r.shares * currentPrice : null;
    const costValue = r.shares * r.cost_basis;
    const unrealizedPL = marketValue != null ? marketValue - costValue : null;
    const plPct = costValue > 0 && unrealizedPL != null ? (unrealizedPL / costValue) * 100 : null;
    return { ...r, currentPrice, marketValue, costValue, unrealizedPL, plPct };
  });

  const totalMarketValue = enriched.reduce((s, r) => s + (r.marketValue || 0), 0);
  const withWeights = enriched.map((r) => ({
    ...r,
    weight: totalMarketValue > 0 && r.marketValue != null ? (r.marketValue / totalMarketValue) * 100 : null,
  }));

  const warnings = [];
  withWeights.forEach((r) => {
    if (r.weight != null && r.weight > 25) warnings.push(`${r.ticker} is ${r.weight.toFixed(1)}% of book — concentration risk.`);
    if (r.currentPrice == null) warnings.push(`${r.ticker} has no live price — add it to the watchlist for accurate market value.`);
  });
  const sectorTotals = {};
  withWeights.forEach((r) => { if (r.weight != null) sectorTotals[r.sector] = (sectorTotals[r.sector] || 0) + r.weight; });
  Object.entries(sectorTotals).forEach(([sector, w]) => {
    if (w > 40) warnings.push(`${sector} sector is ${w.toFixed(1)}% of book — concentrated exposure.`);
  });

  let cumulative = 0;
  const cx = 90, cy = 90, radius = 80;
  const pieRows = withWeights.filter((r) => r.weight != null && r.weight > 0);
  const slices = pieRows.map((r, i) => {
    const fraction = r.weight / 100;
    const startAngle = cumulative * 2 * Math.PI;
    cumulative += fraction;
    const endAngle = cumulative * 2 * Math.PI;
    const x1 = cx + radius * Math.sin(startAngle);
    const y1 = cy - radius * Math.cos(startAngle);
    const x2 = cx + radius * Math.sin(endAngle);
    const y2 = cy - radius * Math.cos(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;
    return `M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${largeArc} 1 ${x2},${y2} Z`;
  });

  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  return (
    <div className="panel">
      <h2>Portfolio Allocation</h2>
      <div className="add-form">
        <div className="field"><label>Ticker</label><input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} /></div>
        <div className="field"><label>Sector</label><input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} /></div>
        <div className="field"><label>Shares</label><input type="number" step="0.0001" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} /></div>
        <div className="field"><label>Avg Cost Basis</label><input type="number" step="0.01" value={form.cost_basis} onChange={(e) => setForm({ ...form, cost_basis: e.target.value })} /></div>
        <div className="field"><label>Conviction 1-5</label><input type="number" min="1" max="5" value={form.conviction} onChange={(e) => setForm({ ...form, conviction: e.target.value })} /></div>
        <button className="action" onClick={addRow}>Add / Update</button>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="stat-box"><div className="label">Total Market Value</div><div className="value">{fmtUsd(totalMarketValue)}</div></div>
        <div className="stat-box"><div className="label">Positions</div><div className="value">{rows.length}</div></div>
        <div className="stat-box">
          <div className="label">Total Unrealized P&L</div>
          <div className="value">{fmtUsd(enriched.reduce((s, r) => s + (r.unrealizedPL || 0), 0))}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticker</th><th>Shares</th><th>Cost Basis</th><th>Price</th>
                <th>Mkt Value</th><th>Weight</th><th>P&L</th><th>P&L %</th><th></th>
              </tr>
            </thead>
            <tbody>
              {withWeights.map((r) => (
                <tr key={r.ticker}>
                  <td><strong>{r.ticker}</strong></td>
                  <td>{fmt(r.shares)}</td>
                  <td>{fmtUsd(r.cost_basis)}</td>
                  <td>{r.currentPrice != null ? fmtUsd(r.currentPrice) : "no live price"}</td>
                  <td>{fmtUsd(r.marketValue)}</td>
                  <td>{r.weight != null ? `${r.weight.toFixed(1)}%` : "—"}</td>
                  <td style={{ color: r.unrealizedPL >= 0 ? "#3ecf8e" : "#f0555a" }}>{fmtUsd(r.unrealizedPL)}</td>
                  <td style={{ color: r.plPct >= 0 ? "#3ecf8e" : "#f0555a" }}>{r.plPct != null ? `${r.plPct.toFixed(1)}%` : "—"}</td>
                  <td><button className="action danger" onClick={() => removeRow(r.ticker)}>x</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No positions logged yet.</div>}
        </div>
        <div>
          {pieRows.length > 0 && (
            <>
              <svg viewBox="0 0 180 180" style={{ width: 180, height: 180 }}>
                {slices.map((path, i) => (
                  <path key={i} d={path} fill={COLORS[i % COLORS.length]} stroke="#131822" strokeWidth="1" />
                ))}
              </svg>
              <div style={{ marginTop: 10 }}>
                {pieRows.map((r, i) => (
                  <div key={r.ticker} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, background: COLORS[i % COLORS.length], display: "inline-block", borderRadius: 2 }} />
                    {r.ticker} ({r.weight.toFixed(1)}%)
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <h3>Allocation Check</h3>
      {warnings.length > 0
        ? warnings.map((w, i) => <div key={i} className="badge" style={{ background: "#f0555a26", color: "#f0555a", display: "block", width: "fit-content", marginBottom: 6 }}>{w}</div>)
        : <span className="empty" style={{ padding: 0 }}>No allocation flags.</span>}

      <p className="disclaimer">
        Weight %, market value, and P&L are all computed live from shares × current price — enter shares and average
        cost basis once, and these update automatically as prices move. A position needs to also be in your live
        watchlist to get a current price; otherwise it shows "no live price" and is excluded from weight calculations.
      </p>
    </div>
  );
}
