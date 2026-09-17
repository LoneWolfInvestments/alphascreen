// src/components/FundamentalScreener.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

function compositeScore(insider, politician, flow, sentiment) {
  const sum = insider + politician + flow + sentiment;
  return Math.round(((sum + 8) / 16) * 100);
}
function signal(score) {
  if (score >= 65) return { label: "Buy", color: "#3ecf8e" };
  if (score <= 35) return { label: "Sell", color: "#f0555a" };
  return { label: "Hold", color: "#f0b955" };
}

export default function FundamentalScreener() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ticker: "", insider: 0, politician: 0, options_flow: 0, sentiment: 0, notes: "" });

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

  const addRow = async () => {
    if (!form.ticker.trim()) return;
    await supabase.from("fundamental_scores").upsert({
      ticker: form.ticker.trim().toUpperCase(),
      insider: Number(form.insider) || 0,
      politician: Number(form.politician) || 0,
      options_flow: Number(form.options_flow) || 0,
      sentiment: Number(form.sentiment) || 0,
      notes: form.notes.trim(),
      updated_at: new Date().toISOString(),
    });
    setForm({ ticker: "", insider: 0, politician: 0, options_flow: 0, sentiment: 0, notes: "" });
  };

  const removeRow = async (ticker) => {
    await supabase.from("fundamental_scores").delete().eq("ticker", ticker);
  };

  const sorted = [...rows].sort(
    (a, b) => compositeScore(b.insider, b.politician, b.options_flow, b.sentiment) - compositeScore(a.insider, a.politician, a.options_flow, a.sentiment)
  );

  return (
    <div className="panel">
      <h2>Add / Score a Name</h2>
      <div className="add-form">
        <Field label="Ticker" value={form.ticker} onChange={(v) => setForm({ ...form, ticker: v })} width={80} />
        <Field label="Insider (-2..2)" type="number" value={form.insider} onChange={(v) => setForm({ ...form, insider: v })} />
        <Field label="Politician (-2..2)" type="number" value={form.politician} onChange={(v) => setForm({ ...form, politician: v })} />
        <Field label="Options Flow (-2..2)" type="number" value={form.options_flow} onChange={(v) => setForm({ ...form, options_flow: v })} />
        <Field label="Sentiment (-2..2)" type="number" value={form.sentiment} onChange={(v) => setForm({ ...form, sentiment: v })} />
        <Field label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} width={160} />
        <button className="action" onClick={addRow}>Add</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th><th>Insider</th><th>Politician</th><th>Flow</th><th>Sentiment</th>
              <th>Composite</th><th>Signal</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const score = compositeScore(r.insider, r.politician, r.options_flow, r.sentiment);
              const sig = signal(score);
              return (
                <tr key={r.ticker}>
                  <td><strong>{r.ticker}</strong></td>
                  <td>{r.insider}</td>
                  <td>{r.politician}</td>
                  <td>{r.options_flow}</td>
                  <td>{r.sentiment}</td>
                  <td><strong>{score}</strong></td>
                  <td><span className="badge" style={{ background: sig.color + "26", color: sig.color }}>{sig.label}</span></td>
                  <td>{r.notes}</td>
                  <td><button className="action danger" onClick={() => removeRow(r.ticker)}>x</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No names screened yet — add one above.</div>}
      </div>
      <p className="disclaimer">
        Composite score is a simple weighted average of the four inputs (heuristic filter, not a valuation model).
      </p>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", width }) {
  return (
    <div className="field" style={width ? { minWidth: width } : {}}>
      <label>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
