// src/components/PortfolioAllocation.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const COLORS = ["#4f8dfd", "#3ecf8e", "#f0b955", "#f0555a", "#a06cf5", "#4fd1c5", "#f57ec1", "#9aa5b1"];

export default function PortfolioAllocation() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ticker: "", sector: "", weight: "", conviction: 3 });

  const load = useCallback(async () => {
    const { data } = await supabase.from("portfolio").select("*").order("ticker");
    setRows(data || []);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("portfolio-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  const addRow = async () => {
    if (!form.ticker.trim()) return;
    await supabase.from("portfolio").upsert({
      ticker: form.ticker.trim().toUpperCase(),
      sector: form.sector.trim() || "Unclassified",
      weight: Number(form.weight) || 0,
      conviction: Number(form.conviction) || 3,
      updated_at: new Date().toISOString(),
    });
    setForm({ ticker: "", sector: "", weight: "", conviction: 3 });
  };

  const removeRow = async (ticker) => {
    await supabase.from("portfolio").delete().eq("ticker", ticker);
  };

  const totalWeight = rows.reduce((s, r) => s + Number(r.weight), 0);

  const warnings = [];
  if (rows.length > 0 && Math.abs(totalWeight - 100) > 0.5) {
    warnings.push(`Weights sum to ${totalWeight.toFixed(1)}% — not 100%.`);
  }
  rows.forEach((r) => {
    if (r.weight > 25) warnings.push(`${r.ticker} is ${r.weight}% of book — concentration risk.`);
  });
  const sectorTotals = {};
  rows.forEach((r) => { sectorTotals[r.sector] = (sectorTotals[r.sector] || 0) + Number(r.weight); });
  Object.entries(sectorTotals).forEach(([sector, w]) => {
    if (w > 40) warnings.push(`${sector} sector is ${w.toFixed(1)}% of book — concentrated exposure.`);
  });

  let cumulative = 0;
  const cx = 90, cy = 90, radius = 80;
  const slices = rows.map((r, i) => {
    const fraction = totalWeight > 0 ? r.weight / totalWeight : 1 / rows.length;
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

  return (
    <div className="panel">
      <h2>Portfolio Allocation</h2>
      <div className="add-form">
        <div className="field"><label>Ticker</label><input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} /></div>
        <div className="field"><label>Sector</label><input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} /></div>
        <div className="field"><label>Weight %</label><input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></div>
        <div className="field"><label>Conviction 1-5</label><input type="number" min="1" max="5" value={form.conviction} onChange={(e) => setForm({ ...form, conviction: e.target.value })} /></div>
        <button className="action" onClick={addRow}>Add</button>
      </div>

      <div className="grid-2">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ticker</th><th>Sector</th><th>Weight</th><th>Conviction</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker}>
                  <td><strong>{r.ticker}</strong></td>
                  <td>{r.sector}</td>
                  <td>{r.weight}%</td>
                  <td>{"*".repeat(r.conviction)}</td>
                  <td><button className="action danger" onClick={() => removeRow(r.ticker)}>x</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No positions logged yet.</div>}
        </div>
        <div>
          {rows.length > 0 && (
            <>
              <svg viewBox="0 0 180 180" style={{ width: 180, height: 180 }}>
                {slices.map((path, i) => (
                  <path key={i} d={path} fill={COLORS[i % COLORS.length]} stroke="#131822" strokeWidth="1" />
                ))}
              </svg>
              <div style={{ marginTop: 10 }}>
                {rows.map((r, i) => (
                  <div key={r.ticker} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, background: COLORS[i % COLORS.length], display: "inline-block", borderRadius: 2 }} />
                    {r.ticker} ({r.weight}%)
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
    </div>
  );
}
