import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { MIN_TREND_BARS } from "../lib/swingSetups";
import {
  HORIZONS,
  SMALL_SAMPLE,
  barsBySymbolFromRows,
  eventsToCsv,
  studySetups,
} from "../lib/setupStudy";
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
        <thead>
          <tr>
            <th>Setup</th>
            <th>Raw signals</th>
            <th>Used in averages</th>
            <th>Horizon</th>
            <th>Finished</th>
            <th>Still open</th>
            <th>Left out</th>
            <th>Average return</th>
            <th>Median</th>
            <th>Average vs SPY</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(study.summaries).map(([setup, summary]) => (
            HORIZONS.map((horizon) => {
              const bucket = summary.horizons[horizon];
              const thin = bucket.completed < SMALL_SAMPLE;
              return (
                <tr key={`${setup}-${horizon}`}>
                  <td>{setup}</td>
                  <td>{summary.raw}</td>
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
            })
          ))}
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

export function SetupStudyView({ study, sample, onDownload }) {
  const finished = study.events.filter((event) => event.status === "completed" && event.independent).length;
  return (
    <div className="panel">
      <h2>Setup Study</h2>
      {sample ? (
        <div className="sample-banner">
          Sample prices so you can see the layout. These are not your saved bars, and the averages are not a result for your account.
        </div>
      ) : null}
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Breakout and Pullback only. Uptrend with nothing to enter, and Avoid, are counted below and then left out of the returns. A signal is that day’s close. The pretend buy is the next session’s open. The result is the close 5, 10, or 20 sessions later, compared with SPY on those same dates. Overlapping signals are not all averaged. Missing sessions are not filled in. This is not a stop-and-target test, and it does not use today’s fundamentals.
      </p>
      <Coverage study={study} />
      <h3>What the labels did</h3>
      <p className="sync-note">
        Breakout days {study.labelDays.Breakout || 0}. Pullback days {study.labelDays.Pullback || 0}. Uptrend, no entry {study.labelDays["Uptrend-no-trigger"] || 0}. Avoid {study.labelDays["Avoid-downtrend"] || 0}.
      </p>
      <SummaryTable study={study} />
      <p className="sync-note" style={{ marginTop: 8 }}>
        {finished < SMALL_SAMPLE
          ? `Finished results used in the averages: ${finished}. Under ${SMALL_SAMPLE}, treat the percentages as a description of what is saved, not as proof the setup works.`
          : `${finished} finished, non-overlapping results are in the averages. That is still not a promise about the next trade.`}
      </p>
      <button type="button" className="action secondary" onClick={onDownload} disabled={study.events.length === 0}>
        Download the row detail
      </button>
      <ul className="why">
        {study.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </div>
  );
}

export default function SetupStudy() {
  const sample = previewSample();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!sample);

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

  const study = useMemo(() => {
    if (sample) return studySetups(sampleSeries());
    if (!rows) return null;
    const grouped = barsBySymbolFromRows(rows);
    return studySetups(grouped.series);
  }, [rows, sample]);

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
    return <div className="panel"><h2>Setup Study</h2><p>Reading saved daily prices…</p></div>;
  }
  if (error) {
    return <div className="panel"><h2>Setup Study</h2><p>{error}</p></div>;
  }
  if (!study || (study.coverage.length === 0 && !sample)) {
    return (
      <div className="panel">
        <h2>Setup Study</h2>
        <div className="empty">No saved daily prices yet. The weekday night job fills them. This page does not start a download.</div>
      </div>
    );
  }
  return <SetupStudyView study={study} sample={sample} onDownload={onDownload} />;
}
