import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { useOwnerSession } from "../hooks/useOwnerSession";
import FundamentalScreener from "./FundamentalScreener";
import MarketStress from "./MarketStress";
import SetupStudy from "./SetupStudy";
import TechnicalAnalysis from "./TechnicalAnalysis";
import ReallocationLog from "./ReallocationLog";
import { HealthBanner } from "./HealthBanner";
import { resolveJobHistory, summarizeHealth } from "../lib/dataHealth";
import { readBusinessFundamentals } from "../lib/businessFundamentals";

const SECTIONS = [
  { key: "status", label: "Status" },
  { key: "fundamentals", label: "Fundamentals" },
  { key: "stress", label: "Market stress" },
  { key: "setups", label: "Setups" },
  { key: "study", label: "Setup study" },
  { key: "log", label: "Notes" },
];

const SAMPLE_JOB_RUNS = [
  { id: "sample-ok", job_name: "fundamentals", finished_at: "2026-10-30T18:00:00Z", status: "ok", summary: "Sample run finished." },
  { id: "sample-partial", job_name: "indicators", finished_at: "2026-10-30T17:00:00Z", status: "partial", summary: "Sample run left a name behind." },
  { id: "sample-failed", job_name: "market-stress", finished_at: "2026-10-30T16:00:00Z", status: "failed", summary: "Sample run did not save a reading." },
];

const HISTORY_NOTE = {
  loading: "Waiting for the job history read.",
  "signed-out": "Job runs stay private. This list stays empty until you sign in.",
  "missing-table": "A missing table means the history was never installed. That is not a failed run.",
  error: "This list is empty because the read failed, not because there were no runs.",
  empty: "The table is installed and no run has been recorded. That is not a failure or a success.",
  ready: "Each row is one recorded run. Ok, partial, and failed describe that run only.",
};

function JobTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Job</th><th>Status</th><th>Summary</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.finished_at ? new Date(row.finished_at).toLocaleString() : "No finish time"}</td>
              <td>{row.job_name}</td>
              <td>{row.status}</td>
              <td className="wrap">{row.summary || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusDetail() {
  const sample = previewSample();
  const { ready, session } = useOwnerSession();
  const signedIn = Boolean(session?.user);
  const [market, setMarket] = useState(null);
  const [query, setQuery] = useState({ userId: null, pending: true, error: null, rows: [] });

  useEffect(() => {
    if (sample) {
      setMarket({
        quotes: [{ bar_date: "2026-10-29" }, { bar_date: "2026-10-20" }],
        fundamentals: [{ coverage: "ready" }, { coverage: "missing" }],
        stress: null,
        now: new Date("2026-10-30T17:00:00Z"),
      });
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      supabase.from("quotes").select("symbol, bar_date"),
      supabase.from("fundamental_scores").select("*"),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
    ]).then(([quotes, fundamentals, stress]) => {
      if (cancelled) return;
      const reads = (fundamentals.data || []).map((row) => readBusinessFundamentals(row));
      setMarket({
        quotes: quotes.data || [],
        fundamentals: reads,
        stress: stress.error ? null : (stress.data || [])[0] || null,
        now: new Date(),
      });
    });
    return () => { cancelled = true; };
  }, [sample]);

  useEffect(() => {
    if (sample || !ready || !signedIn) return undefined;
    const userId = session.user.id;
    let cancelled = false;
    setQuery({ userId, pending: true, error: null, rows: [] });
    supabase.from("job_runs").select("id, job_name, started_at, finished_at, status, summary").order("started_at", { ascending: false }).limit(40)
      .then(({ data, error }) => {
        if (cancelled) return;
        setQuery({ userId, pending: false, error: error || null, rows: error ? [] : (data || []) });
      });
    return () => { cancelled = true; };
  }, [ready, sample, signedIn, session?.user?.id]);

  const sameAccount = query.userId === session?.user?.id;
  const history = sample
    ? { state: "ready", rows: SAMPLE_JOB_RUNS, detail: null }
    : resolveJobHistory({
      ready,
      signedIn,
      pending: signedIn && (!sameAccount || query.pending),
      error: sameAccount ? query.error : null,
      rows: sameAccount ? query.rows : [],
    });
  const health = market
    ? summarizeHealth({ ...market, jobHistory: history })
    : null;

  return (
    <div className="panel">
      <h2>Data status</h2>
      {sample ? <div className="sample-banner">Sample status, not the live database.</div> : null}
      <HealthBanner health={health} />
      <h3>Recorded jobs</h3>
      <p className="sync-note">{HISTORY_NOTE[history.state] || HISTORY_NOTE.loading}</p>
      <JobTable rows={history.rows} />
    </div>
  );
}

export default function More({ section, onSection }) {
  const active = SECTIONS.some((item) => item.key === section) ? section : "status";
  return (
    <div>
      <div className="subnav" role="tablist" aria-label="Research sections">
        {SECTIONS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={active === item.key} className={active === item.key ? "active" : ""} onClick={() => onSection(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      {active === "status" ? <StatusDetail /> : null}
      {active === "fundamentals" ? <FundamentalScreener /> : null}
      {active === "stress" ? <MarketStress /> : null}
      {active === "setups" ? <TechnicalAnalysis /> : null}
      {active === "study" ? <SetupStudy /> : null}
      {active === "log" ? <ReallocationLog /> : null}
    </div>
  );
}
