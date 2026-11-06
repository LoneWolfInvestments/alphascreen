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
import { summarizeHealth } from "../lib/dataHealth";
import { readBusinessFundamentals } from "../lib/businessFundamentals";

const SECTIONS = [
  { key: "status", label: "Status" },
  { key: "fundamentals", label: "Fundamentals" },
  { key: "stress", label: "Market stress" },
  { key: "setups", label: "Setups" },
  { key: "study", label: "Setup study" },
  { key: "log", label: "Notes" },
];

function JobList() {
  const { ready, session } = useOwnerSession();
  const [rows, setRows] = useState(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!ready) return undefined;
    if (!session) {
      setNote("Sign in to read recorded job runs. They are not public.");
      setRows([]);
      return undefined;
    }
    let cancelled = false;
    supabase.from("job_runs").select("id, job_name, started_at, finished_at, status, summary").order("started_at", { ascending: false }).limit(40)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setRows(null);
          setNote(/job_runs/i.test(error.message || "")
            ? "Job history is not installed yet. Unknown is not the same as a failed job."
            : error.message);
          return;
        }
        setRows(data || []);
        setNote(data && data.length ? "" : "The job table is installed and has no recorded runs yet.");
      });
    return () => { cancelled = true; };
  }, [ready, session]);
  return (
    <div>
      {note ? <p>{note}</p> : null}
      {rows && rows.length > 0 ? (
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
      ) : null}
    </div>
  );
}

function StatusDetail() {
  const sample = previewSample();
  const [health, setHealth] = useState(null);
  useEffect(() => {
    if (sample) {
      setHealth(summarizeHealth({
        quotes: [{ bar_date: "2026-10-29" }, { bar_date: "2026-10-20" }],
        fundamentals: [{ coverage: "ready" }, { coverage: "missing" }],
        stress: null,
        jobRuns: null,
        now: new Date("2026-10-30T17:00:00Z"),
      }));
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
      setHealth(summarizeHealth({
        quotes: quotes.data || [],
        fundamentals: reads,
        stress: stress.error ? null : (stress.data || [])[0] || null,
        jobRuns: null,
      }));
    });
    return () => { cancelled = true; };
  }, [sample]);
  return (
    <div className="panel">
      <h2>Data status</h2>
      {sample ? <div className="sample-banner">Sample status, not the live database.</div> : null}
      <HealthBanner health={health} />
      <h3>Recorded jobs</h3>
      <p className="sync-note">A missing table means the history was never installed. An empty table means no run has been recorded. Neither one is shown as a failure or as success.</p>
      <JobList />
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
