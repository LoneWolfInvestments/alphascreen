import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { MIN_TREND_BARS } from "../lib/swingSetups";
import {
  DETAIL_PAGE_SIZE,
  HORIZONS,
  SMALL_SAMPLE,
  STUDY_SETUPS,
  barsBySymbolFromRows,
  eventsToCsv,
  filterSignals,
  forwardReturnSentences,
  historyWindow,
  outcomeWords,
  pageSignals,
  studySetups,
  tickerChoices,
} from "../lib/setupStudy";
import { simulateBook } from "../lib/strategySim";
import ModelSignalRecord from "./ModelSignalRecord";
import {
  breakoutTodayBars,
  downtrendBars,
  pullback20Bars,
  spyBars,
  thinBars,
} from "../lib/swingSample";

function percent(value) {
  if (!Number.isFinite(value)) return "—";
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}%`;
}

function sampleSeries() {
  return {
    SPY: spyBars(),
    NVDA: breakoutTodayBars(),
    AAPL: pullback20Bars(),
    INTC: downtrendBars(),
    ARM: thinBars(),
  };
}

async function loadStoredBars() {
  const pageSize = 1000;
  const maxRows = 20000;
  const rows = [];
  for (let from = 0; rows.length < maxRows; from += pageSize) {
    const { data, error } = await supabase
      .from("daily_bars")
      .select("symbol, bar_date, open, high, low, close, volume")
      .order("symbol", { ascending: true })
      .order("bar_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

function SummaryTable({ study }) {
  return (
    <div className="table-wrap">
      <table>
        <caption className="sync-note">Every name in the saved bars. Choosing a ticker below does not change this table.</caption>
        <thead>
          <tr>
            <th>Setup</th>
            <th>All signals</th>
            <th>Overlap, not averaged</th>
            <th>Non-overlapping</th>
            <th>Horizon</th>
            <th>Finished</th>
            <th>Not finished</th>
            <th>Gap or missing price</th>
            <th>Average</th>
            <th>Median</th>
            <th>Average minus SPY</th>
          </tr>
        </thead>
        <tbody>
          {STUDY_SETUPS.map((setup) => {
            const summary = study.summaries[setup];
            if (!summary) return null;
            const overlap = Math.max(0, summary.raw - summary.independent);
            return HORIZONS.map((horizon) => {
              const bucket = summary.horizons[horizon];
              const thin = bucket.completed < SMALL_SAMPLE;
              return (
                <tr key={`${setup}-${horizon}`}>
                  <td>{setup}</td>
                  <td>{summary.raw}</td>
                  <td>{overlap}</td>
                  <td>{summary.independent}</td>
                  <td>{horizon} sessions</td>
                  <td>{bucket.completed}{thin ? " (too few to judge)" : ""}</td>
                  <td>{bucket.pending}</td>
                  <td>{bucket.ineligible}</td>
                  <td>{percent(bucket.avgReturn)}</td>
                  <td>{percent(bucket.medianReturn)}</td>
                  <td>{bucket.excessCount ? `${percent(bucket.avgExcess)} (${bucket.excessCount})` : "—"}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

function Coverage({ study }) {
  const ready = study.coverage.filter((row) => row.status === "ready");
  const warmup = study.coverage.filter((row) => row.status === "warmup");
  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-box"><div className="label">Names saved</div><div className="value">{study.coverage.length}</div></div>
        <div className="stat-box"><div className="label">Enough history</div><div className="value">{ready.length}</div></div>
        <div className="stat-box"><div className="label">Still warming up</div><div className="value">{warmup.length}</div></div>
        <div className="stat-box"><div className="label">SPY sessions</div><div className="value">{study.spy.bars}</div></div>
      </div>
      {warmup.length > 0 && (
        <p className="sync-note">
          {warmup.map((row) => `${row.symbol} has ${row.bars}`).join(", ")}. A setup needs {MIN_TREND_BARS} sessions. This page does not download the missing days.
        </p>
      )}
    </>
  );
}

function percentPoints(value) {
  if (!Number.isFinite(value)) return "withheld";
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}%`;
}

function SignalBrowser({ study }) {
  const [query, setQuery] = useState("");
  const [symbol, setSymbol] = useState("");
  const [setup, setSetup] = useState("all");
  const [page, setPage] = useState(1);
  const choices = tickerChoices(study);
  const needle = query.trim().toUpperCase();
  const matches = choices.filter((item) => !needle || item.symbol.includes(needle));
  const visibleChoices = matches.slice(0, 12);
  const selected = filterSignals(study, { symbol, setup });
  const view = pageSignals(selected, page, DETAIL_PAGE_SIZE);

  const choose = (next) => {
    setSymbol(next);
    setPage(1);
  };

  return (
    <div>
      <h3>Which ticker, which signal</h3>
      <p className="sync-note">The summary above stays every name. This list is only the ticker you pick.</p>
      <div className="field" style={{ maxWidth: 280 }}>
        <label htmlFor="study-ticker-search">Find a ticker</label>
        <input
          id="study-ticker-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a symbol"
          autoComplete="off"
        />
      </div>
      <div className="subnav" role="group" aria-label="Matching tickers">
        {visibleChoices.map((item) => (
          <button
            key={item.symbol}
            type="button"
            className={symbol === item.symbol ? "active" : ""}
            aria-pressed={symbol === item.symbol}
            onClick={() => choose(item.symbol)}
          >
            {item.symbol} ({item.signals})
          </button>
        ))}
      </div>
      {matches.length > visibleChoices.length ? (
        <p className="sync-note">Showing {visibleChoices.length} of {matches.length} names. Keep typing to narrow the list.</p>
      ) : null}
      <div className="subnav" role="group" aria-label="Setup filter for the ticker list">
        {[{ id: "all", label: "All setups" }, { id: "Breakout", label: "Breakout" }, { id: "Pullback", label: "Pullback" }].map((item) => (
          <button
            key={item.id}
            type="button"
            className={setup === item.id ? "active" : ""}
            aria-pressed={setup === item.id}
            onClick={() => { setSetup(item.id); setPage(1); }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {!symbol ? <p>Choose a ticker to see each signal date, the next open, and what happened 5, 10, and 20 sessions later.</p> : null}
      {symbol && view.total === 0 ? <div className="empty">No {setup === "all" ? "" : `${setup} `}signals for {symbol} in the saved bars.</div> : null}
      {symbol && view.total > 0 ? (
        <>
          <p className="sync-note">
            {symbol}: {view.total} {setup === "all" ? "" : `${setup} `}signals in the saved bars. Showing {view.start + 1}–{view.start + view.rows.length}. In the averages means this signal did not overlap an earlier one. Overlap means it is in the raw count only.
          </p>
          {view.rows.map((signal) => {
            const entry = signal.outcomes.find((item) => item.entryDate) || signal.outcomes[0] || {};
            return (
              <article key={`${signal.symbol}-${signal.signalDate}-${signal.setup}`} className="detail-card">
                <p><strong>{signal.symbol}</strong> {signal.setup}</p>
                <p>Signal date {signal.signalDate}. {signal.independent ? "In the averages." : "Overlaps an earlier signal, so left out of the averages."}</p>
                <p>Entry {entry.entryDate || "not available yet"}{Number.isFinite(entry.entryOpen) ? ` at ${entry.entryOpen.toFixed(2)}` : ""}. That open is the next session, not the signal close.</p>
                <ul className="plain-list">
                  {signal.outcomes.map((outcome) => (
                    <li key={outcome.horizon}>
                      {outcome.horizon} sessions: {outcomeWords(outcome.status)}
                      {outcome.status === "completed" ? `. Stock ${percent(outcome.stockReturn)}. SPY ${percent(outcome.spyReturn)}. Difference ${percent(outcome.excess)}.` : ""}
                      {outcome.exitDate ? ` Exit close ${outcome.exitDate}.` : ""}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
          {view.pages > 1 ? (
            <div className="subnav">
              <button type="button" onClick={() => setPage(view.page - 1)} disabled={view.page <= 1}>Previous</button>
              <span className="sync-note">Page {view.page} of {view.pages}</span>
              <button type="button" onClick={() => setPage(view.page + 1)} disabled={view.page >= view.pages}>Next</button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RuleCheck({ simulation, slippageText, onSlippage }) {
  if (!simulation) return null;
  const later = simulation.evaluation;
  return (
    <section className="panel">
      <h2>Trailing-stop check — not the forward-return table</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        {simulation.name}. This asks a different question from the table above. The table has no stop and no cost. This check trails a stop and subtracts an assumed cost. Averages are per trade, not a portfolio return. The later window is the last 30% of signals by date. Company figures are not used. A result here does not validate the Buy candidate record.
      </p>
      <div className="field" style={{ maxWidth: 220, marginBottom: 8 }}>
        <label htmlFor="slippage-bps">Assumed slippage each side (%)</label>
        <input id="slippage-bps" value={slippageText} onChange={(event) => onSlippage(event.target.value)} />
      </div>
      <p className="sync-note">Using {(simulation.slippage * 100).toFixed(2)}% each side on the entry and the exit. That is an assumption, not a broker fee. The same assumption is applied to SPY when an excess is shown.</p>
      <p>
        Closed trades in the later window: {later.closed}. Still open: {later.open}. Incomplete bars: {later.incomplete}.
        {later.withheld ? " The average is withheld because fewer than 20 closed trades are in that later window." : ` Average trade after the cost assumption ${percentPoints(later.avgNet)}. Average excess versus SPY ${percentPoints(later.avgExcess)} (${later.excessCount} with a SPY bar on both dates).`}
      </p>
      <p className="sync-note">Earlier window closed trades: {simulation.development.closed}. That window is not the result to lean on. Overlap signals skipped while a trade was open: {simulation.skippedOverlap}. Names still short of 200 sessions: {simulation.warmup}.</p>
      <details>
        <summary>Rules used in this check</summary>
        <ul className="plain-list">
          {simulation.rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </details>
    </section>
  );
}

export function SetupStudyView({ study, sample, onDownload, simulation, slippageText, onSlippage }) {
  const span = historyWindow(study);
  const sentences = forwardReturnSentences(study);
  return (
    <div>
      <div className="panel">
        <h2>Historical technical setups — not full Buy signals</h2>
        {sample ? (
          <div className="sample-banner">
            Sample prices so you can see the layout. These are not your saved bars, and the averages are not a result for your account.
          </div>
        ) : null}
        <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
          This block is only Breakout and Pullback on the saved daily bars. The pretend buy is the next session’s open. The result is that name’s close 5, 10, or 20 sessions later. It does not use a stop, a target, or a trading cost, and it does not look at company figures or earnings. The trailing-stop check and the Buy candidate record below are different questions.
        </p>
        <Coverage study={study} />
        <p className="sync-note">
          Breakout days {study.labelDays.Breakout || 0}. Pullback days {study.labelDays.Pullback || 0}. Uptrend, no entry {study.labelDays["Uptrend-no-trigger"] || 0}. Avoid {study.labelDays["Avoid-downtrend"] || 0}. Uptrend and Avoid are counted here and then left out of the returns.
          {span.first ? ` Price window ${span.first} to ${span.last}.` : ""}
        </p>
        {sentences.map((line) => <p key={line}>{line}</p>)}
        <SummaryTable study={study} />
        <SignalBrowser study={study} />
        <button type="button" className="action secondary" onClick={onDownload} disabled={study.events.length === 0}>
          Download the row detail
        </button>
        <details>
          <summary>How a row is counted</summary>
          <ul className="why">
            {study.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </details>
      </div>
      <RuleCheck simulation={simulation} slippageText={slippageText} onSlippage={onSlippage} />
      <ModelSignalRecord sample={sample} />
    </div>
  );
}

export default function SetupStudy() {
  const sample = previewSample();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!sample);
  const [slippageText, setSlippageText] = useState("0.05");

  useEffect(() => {
    if (sample) return undefined;
    let cancelled = false;
    loadStoredBars()
      .then((loaded) => {
        if (!cancelled) {
          setRows(loaded);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.message || "Could not read saved prices.";
        setError(/daily_bars/i.test(message)
          ? "The daily price table is not there yet. In Supabase, open the SQL Editor and run schema-daily-bars.sql. This page will not download history."
          : message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sample]);

  const prepared = useMemo(() => {
    const series = sample ? sampleSeries() : rows ? barsBySymbolFromRows(rows).series : null;
    if (!series) return null;
    return { series, study: studySetups(series) };
  }, [rows, sample]);
  const study = prepared?.study || null;
  const simulation = useMemo(() => {
    if (!prepared) return null;
    const parsed = Number(slippageText);
    const slippage = Number.isFinite(parsed) && parsed >= 0 && parsed < 25 ? parsed / 100 : 0.0005;
    return simulateBook({ seriesBySymbol: prepared.series, slippage });
  }, [prepared, slippageText]);

  const onDownload = () => {
    if (!study) return;
    const blob = new Blob([eventsToCsv(study.events)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "setup-study.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div>
        <div className="panel"><h2>Setup Study</h2><p>Reading saved daily prices…</p></div>
        <ModelSignalRecord sample={sample} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <div className="panel"><h2>Setup Study</h2><p>{error}</p></div>
        <ModelSignalRecord sample={sample} />
      </div>
    );
  }
  if (!study || (study.coverage.length === 0 && !sample)) {
    return (
      <div>
        <div className="panel">
          <h2>Setup Study</h2>
          <div className="empty">No saved daily prices yet. The weekday night job fills them. This page does not start a download.</div>
        </div>
        <ModelSignalRecord sample={sample} />
      </div>
    );
  }
  return (
    <SetupStudyView
      study={study}
      sample={sample}
      onDownload={onDownload}
      simulation={simulation}
      slippageText={slippageText}
      onSlippage={setSlippageText}
    />
  );
}
