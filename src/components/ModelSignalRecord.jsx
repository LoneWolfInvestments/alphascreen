import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { POLICY_RULES, journalMatches, reviewEpisode, summarizeOutcomes } from "../lib/modelSignals";

function sampleRows() {
  const waiting = {
    symbol: "EXAMPLE",
    signal_session: "2026-10-29",
    signal_close: 100,
    initial_stop: 90,
    target_price: null,
    observed_at: "2026-10-30T06:00:00.000Z",
    origin: "first_observation",
    setup_label: "Breakout",
    fundamentals_state: "Positive",
    technicals_state: "Positive",
    supporting_state: "Unknown",
  };
  const closed = {
    ...waiting,
    symbol: "SAMPLE",
    signal_session: "2026-09-02",
    observed_at: "2026-09-03T06:00:00.000Z",
  };
  return [
    { ...waiting, ...reviewEpisode({ snapshot: waiting, bars: [], spyBars: [], lastSession: "2026-10-29" }) },
    {
      ...closed,
      ...reviewEpisode({
        snapshot: closed,
        bars: [{ date: "2026-09-03", open: 88, high: 89, low: 87, close: 88 }],
        spyBars: [],
        lastSession: "2026-09-03",
      }),
    },
  ];
}

function rText(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} R`;
}

export function modelRowsFrom(signals, outcomes) {
  const byId = new Map((outcomes || []).map((row) => [row.signal_id, row]));
  return (signals || []).map((row) => ({ ...row, ...(byId.get(row.id) || { status: "untriggered", reason: "not_reviewed" }) }));
}

export default function ModelSignalRecord({ sample = previewSample(), notes = null }) {
  const [rows, setRows] = useState(sample ? sampleRows() : null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (sample) return undefined;
    let cancelled = false;
    Promise.all([
      supabase.from("model_signals").select("id, symbol, signal_session, observed_at, origin, setup_label, signal_close, initial_stop, target_price, fundamentals_state, technicals_state, supporting_state, regime_state").order("signal_session", { ascending: false }).limit(200),
      supabase.from("model_signal_outcomes").select("signal_id, status, reason, entry_date, exit_date, r_multiple, r_net, path_5_status, excess_5").limit(200),
    ]).then(([signals, outcomes]) => {
      if (cancelled) return;
      const missing = [signals.error, outcomes.error].find((error) => error && /model_signal/i.test(`${error.message || ""} ${error.code || ""}`));
      if (missing) {
        setNotice("The Buy candidate record is not installed yet. Paste schema-model-signals.sql into the Supabase SQL editor and run it. Until then there is no win rate to show.");
        setRows([]);
        return;
      }
      if (signals.error || outcomes.error) {
        setNotice((signals.error || outcomes.error).message);
        setRows([]);
        return;
      }
      setNotice("");
      setRows(modelRowsFrom(signals.data || [], outcomes.data || []));
    });
    return () => { cancelled = true; };
  }, [sample]);

  const summary = summarizeOutcomes(rows || []);
  const overlaps = notes ? (rows || []).flatMap((row) => journalMatches(row, notes).map((note) => ({ symbol: row.symbol, opened: note.opened_on }))) : [];

  return (
    <section className="panel" aria-label="Buy candidate record">
      <h2>Buy candidate record</h2>
      {sample ? <div className="sample-banner">Sample record for the layout. These are not saved signals and not your trades.</div> : null}
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        This list is the full Buy candidate record. It is not the historical setup table, and it does not use that table as proof. A row is written once, the night after the close, from the figures known then. It does not invent earlier signals. An empty list means nothing has been captured yet. That is not a successful strategy and not a failed one.
      </p>
      {notice ? <p>{notice}</p> : null}
      {rows ? (
        <>
          <p>
            Wins {summary.counts.win}. Losses {summary.counts.loss}. Win rate {summary.winRate == null ? "—" : `${(summary.winRate * 100).toFixed(0)}%`} of {summary.denominator} finished win-or-loss results.
            {" "}Still untriggered {summary.counts.untriggered}. Open {summary.counts.open}. Expired {summary.counts.expired}. Ambiguous {summary.counts.ambiguous}. Data insufficient {summary.counts.data_insufficient}.
          </p>
          <p className="sync-note">
            {summary.withheld
              ? `Average R is withheld until there are ${summary.minClosed} wins and losses. There are ${summary.denominator}. Pending names stay in the counts above and out of the average.`
              : `Average R ${rText(summary.avgR)}. Average R after the 0.05% cost assumption ${rText(summary.avgRNet)}.`}
          </p>
          {overlaps.length ? (
            <p>Your journal has a note on {overlaps.map((item) => `${item.symbol} opened ${item.opened}`).join(", ")}. That note is not this result, and this result was not copied from the note.</p>
          ) : null}
          {rows.length === 0 ? (
            <div className="empty">
              No Buy candidate has been recorded yet. Capture starts the night the record job runs after the table was installed. Past Breakout and Pullback days in the historical study are not copied here.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Signal session</th>
                    <th>Stock</th>
                    <th>Status</th>
                    <th>Setup</th>
                    <th>Pillars</th>
                    <th>R</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.symbol}-${row.signal_session}`}>
                      <td>{row.signal_session}</td>
                      <td><strong>{row.symbol}</strong></td>
                      <td>{row.status}{row.reason ? ` (${row.reason})` : ""}</td>
                      <td>{row.setup_label || "—"}</td>
                      <td>{row.fundamentals_state} / {row.technicals_state} / {row.supporting_state}</td>
                      <td>{rText(row.r_multiple)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : <p>Reading the Buy candidate record…</p>}
      <details>
        <summary>How a Buy candidate row is scored</summary>
        <ul className="why">
          {POLICY_RULES.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </details>
    </section>
  );
}
