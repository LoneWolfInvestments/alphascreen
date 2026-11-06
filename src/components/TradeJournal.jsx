import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { monthlyReview, planSnapshot, realisedResult, validateJournalEntry, SINGLE_FILL_LIMIT } from "../lib/tradeJournal";
import { formatUsdFromCents } from "../lib/positionSize";

const EMPTY = {
  ticker: "",
  status: "open",
  opened_on: "",
  closed_on: "",
  shares: "",
  entry_price: "",
  exit_price: "",
  planned_stop: "",
  planned_target: "",
  planned_risk_usd: "",
  assumed_cost_usd: "",
  thesis: "",
  outcome_notes: "",
  review_notes: "",
  change_note: "",
  process_followed: "",
};

const SAMPLE_ROWS = [
  {
    id: "sample-open",
    ticker: "EXAMPLE",
    status: "open",
    opened_on: "2026-10-01",
    shares: 10,
    entry_price: 100,
    planned_stop: 95,
    planned_target: 112,
    planned_risk_usd: 50,
    thesis: "Sample note only.",
    plan_note: "Original plan kept for the sample.",
    process_followed: null,
  },
  {
    id: "sample-closed",
    ticker: "SAMPLE",
    status: "closed",
    opened_on: "2026-09-02",
    closed_on: "2026-09-20",
    shares: 5,
    entry_price: 40,
    exit_price: 46,
    planned_stop: 37,
    assumed_cost_usd: 2,
    thesis: "Sample closed note.",
    outcome_notes: "Sample outcome.",
    process_followed: true,
    plan_note: "Original plan kept for the sample.",
  },
];

function money(value) {
  if (!Number.isFinite(value)) return "—";
  return formatUsdFromCents(Math.round(value * 100));
}

function Field({ id, label, value, onChange, type = "text" }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export default function TradeJournal() {
  const sample = previewSample();
  const { ready, session } = useOwnerSession();
  const [rows, setRows] = useState(sample ? SAMPLE_ROWS : []);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState([]);
  const [confirmId, setConfirmId] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (sample || !session) return;
    const { data, error } = await supabase.from("trade_journal").select("*").order("opened_on", { ascending: false });
    if (error) {
      setNotice(/trade_journal/i.test(error.message || "")
        ? "The journal table is not installed yet. Paste schema-trade-journal.sql into the Supabase SQL editor and run it."
        : error.message);
      setRows([]);
      return;
    }
    setNotice("");
    setRows(data || []);
  }, [sample, session]);

  useEffect(() => {
    if (sample || !ready || !session) return undefined;
    load();
    return undefined;
  }, [load, ready, sample, session]);

  const review = useMemo(() => monthlyReview(rows), [rows]);
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const parsed = validateJournalEntry(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors([]);
    if (sample) {
      setNotice("Sample mode does not save.");
      return;
    }
    const payload = {
      ticker: parsed.ticker,
      status: parsed.status,
      opened_on: parsed.opened,
      closed_on: parsed.status === "closed" ? parsed.closed : null,
      shares: parsed.shares,
      entry_price: parsed.entry,
      exit_price: parsed.status === "closed" ? parsed.exit : null,
      planned_stop: parsed.stop,
      planned_target: parsed.target,
      planned_risk_usd: parsed.risk,
      assumed_cost_usd: parsed.cost,
      thesis: form.thesis.trim(),
      outcome_notes: form.outcome_notes.trim(),
      review_notes: form.review_notes.trim(),
      change_note: form.change_note.trim(),
      process_followed: form.process_followed === "" ? null : form.process_followed === "yes",
      updated_at: new Date().toISOString(),
    };
    if (!editing) payload.plan_note = planSnapshot(form);
    const query = editing
      ? supabase.from("trade_journal").update(payload).eq("id", editing)
      : supabase.from("trade_journal").insert(payload);
    const { error } = await query;
    if (error) {
      setNotice(error.message);
      return;
    }
    setForm(EMPTY);
    setEditing(null);
    setNotice("Saved. This does not change the holdings table.");
    load();
  };

  const remove = async (id) => {
    if (sample) return;
    const { error } = await supabase.from("trade_journal").delete().eq("id", id);
    if (error) setNotice(error.message);
    setConfirmId(null);
    load();
  };

  if (!sample && !ready) return <div className="panel"><h2>Journal</h2><p>Loading…</p></div>;
  if (!sample && !session) {
    return <div className="panel"><h2>Journal</h2><div className="empty">Sign in to keep private trade notes.</div></div>;
  }

  return (
    <div className="panel">
      <h2>Trade journal</h2>
      {sample ? <div className="sample-banner">Sample notes. Nothing is saved.</div> : null}
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        {SINGLE_FILL_LIMIT} Only you can read these notes. Saving a note does not buy, sell, or edit a holding.
      </p>
      {notice ? <p>{notice}</p> : null}
      <div className="size-form">
        <Field id="journal-ticker" label="Ticker" value={form.ticker} onChange={set("ticker")} />
        <div className="field">
          <label htmlFor="journal-status">Status</label>
          <select id="journal-status" value={form.status} onChange={(event) => set("status")(event.target.value)}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <Field id="journal-opened" label="Opened (YYYY-MM-DD)" value={form.opened_on} onChange={set("opened_on")} />
        <Field id="journal-closed" label="Closed (YYYY-MM-DD)" value={form.closed_on} onChange={set("closed_on")} />
        <Field id="journal-shares" label="Shares" value={form.shares} onChange={set("shares")} />
        <Field id="journal-entry" label="Entry price (USD)" value={form.entry_price} onChange={set("entry_price")} />
        <Field id="journal-exit" label="Exit price (USD)" value={form.exit_price} onChange={set("exit_price")} />
        <Field id="journal-stop" label="Planned stop (USD)" value={form.planned_stop} onChange={set("planned_stop")} />
        <Field id="journal-target" label="Target (USD, optional)" value={form.planned_target} onChange={set("planned_target")} />
        <Field id="journal-risk" label="Planned risk (USD, optional)" value={form.planned_risk_usd} onChange={set("planned_risk_usd")} />
        <Field id="journal-cost" label="Assumed cost (USD, optional)" value={form.assumed_cost_usd} onChange={set("assumed_cost_usd")} />
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="journal-thesis">Thesis</label>
        <input id="journal-thesis" value={form.thesis} onChange={(event) => set("thesis")(event.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="journal-outcome">Outcome notes</label>
        <input id="journal-outcome" value={form.outcome_notes} onChange={(event) => set("outcome_notes")(event.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="journal-review">Review notes</label>
        <input id="journal-review" value={form.review_notes} onChange={(event) => set("review_notes")(event.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="journal-change">What changed after the original plan</label>
        <input id="journal-change" value={form.change_note} onChange={(event) => set("change_note")(event.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="journal-process">Did you follow your plan? You decide. Profit does not answer this.</label>
        <select id="journal-process" value={form.process_followed} onChange={(event) => set("process_followed")(event.target.value)}>
          <option value="">Not marked</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      {errors.length > 0 ? <ul className="plain-list">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
      <button type="button" className="action" onClick={save} disabled={sample}>{editing ? "Update note" : "Save note"}</button>
      {editing ? <button type="button" className="action secondary" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel edit</button> : null}

      <h3>Monthly review</h3>
      <p className="sync-note">{review.note} Open notes are not in the month totals. Open count: {review.openCount}.</p>
      {review.months.length === 0 ? <p className="sync-note">No closed notes with a close date yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Month</th><th>Closed</th><th>Price result</th><th>Net of typed cost</th><th>Plan followed</th><th>Not followed</th><th>Not marked</th></tr></thead>
            <tbody>
              {review.months.map((month) => (
                <tr key={month.month}>
                  <td>{month.month}</td>
                  <td>{month.closed}</td>
                  <td>{month.grossKnown ? money(month.gross) : "—"}</td>
                  <td>{month.netKnown ? money(month.net) : "—"}</td>
                  <td>{month.followed}</td>
                  <td>{month.notFollowed}</td>
                  <td>{month.notMarked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Notes</h3>
      {rows.map((row) => {
        const result = realisedResult(row);
        return (
          <article key={row.id} className="sell-row info">
            <div className="sell-top">
              <strong>{row.ticker}</strong>
              <span className="badge">{row.status}</span>
              <span className="sync-note">{row.opened_on || "no open date"}{row.closed_on ? ` to ${row.closed_on}` : ""}</span>
            </div>
            <p>{row.thesis || "No thesis."}</p>
            <p className="sync-note">Original plan: {row.plan_note || "Not stored."}</p>
            {row.change_note ? <p>Later change: {row.change_note}</p> : null}
            <p>{result.assumption} {result.gross != null ? `Price result ${money(result.gross)}.` : ""} {result.net != null ? `After typed cost ${money(result.net)}.` : ""}</p>
            <button type="button" className="action secondary" onClick={() => {
              setEditing(row.id);
              setForm({
                ticker: row.ticker || "",
                status: row.status || "open",
                opened_on: row.opened_on || "",
                closed_on: row.closed_on || "",
                shares: row.shares ?? "",
                entry_price: row.entry_price ?? "",
                exit_price: row.exit_price ?? "",
                planned_stop: row.planned_stop ?? "",
                planned_target: row.planned_target ?? "",
                planned_risk_usd: row.planned_risk_usd ?? "",
                assumed_cost_usd: row.assumed_cost_usd ?? "",
                thesis: row.thesis || "",
                outcome_notes: row.outcome_notes || "",
                review_notes: row.review_notes || "",
                change_note: row.change_note || "",
                process_followed: row.process_followed === true ? "yes" : row.process_followed === false ? "no" : "",
              });
            }}>Edit</button>
            {confirmId === row.id ? (
              <button type="button" className="action danger" onClick={() => remove(row.id)}>Confirm delete</button>
            ) : (
              <button type="button" className="action secondary" onClick={() => setConfirmId(row.id)}>Delete</button>
            )}
          </article>
        );
      })}
    </div>
  );
}
