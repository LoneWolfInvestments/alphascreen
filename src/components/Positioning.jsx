// src/components/Positioning.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Positioning() {
  const [rows, setRows] = useState([]);
  const [log, setLog] = useState([]);
  const [form, setForm] = useState({ asset: "", cot_net: "", cta: "Long", gex: "" });
  const [logForm, setLogForm] = useState({ action: "", rationale: "" });

  const loadPositioning = useCallback(async () => {
    const { data } = await supabase.from("positioning").select("*").order("created_at", { ascending: false });
    setRows(data || []);
  }, []);
  const loadLog = useCallback(async () => {
    const { data } = await supabase.from("reallocation_log").select("*").order("created_at", { ascending: false });
    setLog(data || []);
  }, []);

  useEffect(() => {
    loadPositioning();
    loadLog();
    const c1 = supabase.channel("positioning-changes").on("postgres_changes", { event: "*", schema: "public", table: "positioning" }, loadPositioning).subscribe();
    const c2 = supabase.channel("reallocation-changes").on("postgres_changes", { event: "*", schema: "public", table: "reallocation_log" }, loadLog).subscribe();
    return () => { supabase.removeChannel(c1); supabase.removeChannel(c2); };
  }, [loadPositioning, loadLog]);

  const addPositioning = async () => {
    if (!form.asset.trim()) return;
    await supabase.from("positioning").insert({
      asset: form.asset.trim(),
      cot_net: Number(form.cot_net) || 0,
      cta: form.cta,
      gex: Number(form.gex) || 0,
    });
    setForm({ asset: "", cot_net: "", cta: "Long", gex: "" });
  };
  const removePositioning = async (id) => { await supabase.from("positioning").delete().eq("id", id); };

  const addLog = async () => {
    if (!logForm.action.trim()) return;
    await supabase.from("reallocation_log").insert({ action: logForm.action.trim(), rationale: logForm.rationale.trim() });
    setLogForm({ action: "", rationale: "" });
  };
  const removeLog = async (id) => { await supabase.from("reallocation_log").delete().eq("id", id); };

  const readFor = (r) => {
    let read = "Balanced";
    if (r.cot_net > 0 && r.cta === "Long") read = "Crowded long";
    if (r.cot_net < 0 && r.cta === "Short") read = "Crowded short";
    if (r.gex < 0) read += " · negative gamma (vol-amplifying)";
    return read;
  };

  return (
    <>
      <div className="panel">
        <h2>COT / CTA / GEX Positioning</h2>
        <div className="add-form">
          <div className="field"><label>Asset</label><input value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} placeholder="ES / Copper / VIX" /></div>
          <div className="field"><label>COT Net (spec)</label><input type="number" value={form.cot_net} onChange={(e) => setForm({ ...form, cot_net: e.target.value })} /></div>
          <div className="field">
            <label>CTA Positioning</label>
            <select value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })}>
              <option>Long</option><option>Neutral</option><option>Short</option>
            </select>
          </div>
          <div className="field"><label>GEX ($bn)</label><input type="number" step="0.1" value={form.gex} onChange={(e) => setForm({ ...form, gex: e.target.value })} /></div>
          <button className="action" onClick={addPositioning}>Add</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Asset</th><th>COT Net</th><th>CTA</th><th>GEX</th><th>Read</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.asset}</strong></td>
                  <td>{r.cot_net}</td>
                  <td>{r.cta}</td>
                  <td>{r.gex}</td>
                  <td>{readFor(r)}</td>
                  <td><button className="action danger" onClick={() => removePositioning(r.id)}>x</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="empty">No positioning data logged yet.</div>}
        </div>
      </div>

      <div className="panel">
        <h2>Reallocation Log</h2>
        <div className="add-form">
          <div className="field" style={{ minWidth: 180 }}><label>Action</label><input value={logForm.action} onChange={(e) => setLogForm({ ...logForm, action: e.target.value })} placeholder="Trimmed AAPL 5%" /></div>
          <div className="field" style={{ minWidth: 260 }}><label>Rationale</label><input value={logForm.rationale} onChange={(e) => setLogForm({ ...logForm, rationale: e.target.value })} placeholder="Reason for the move" /></div>
          <button className="action" onClick={addLog}>Log</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Action</th><th>Rationale</th><th></th></tr></thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{r.action}</td>
                  <td>{r.rationale}</td>
                  <td><button className="action danger" onClick={() => removeLog(r.id)}>x</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {log.length === 0 && <div className="empty">No reallocation entries yet.</div>}
        </div>
      </div>
    </>
  );
}
