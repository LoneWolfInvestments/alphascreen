import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { ownerMutationFailed } from "../lib/ownerMutation";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { previewSample } from "../lib/previewSample";
import { isEarningsSoon, nyToday, formatDay } from "../lib/sellSignals";
import { sampleScreenerRows } from "../lib/sellSignalsSample";
import {
  formatGrowth,
  readAnalyst,
  readBusinessFundamentals,
  readOwnership,
} from "../lib/businessFundamentals";
import { TIMING_NOTE } from "../lib/sessionClock";
import EarningsDate from "./EarningsDate";

function signalBadge(signal) {
  if (signal === "Buy") return { label: "Buy", color: "#3ecf8e" };
  if (signal === "Caution") return { label: "Caution", color: "#f0555a" };
  if (signal === "Hold") return { label: "Hold", color: "#f0b955" };
  return null;
}

function coverageBadge(read) {
  if (read.coverage === "ready") return null;
  if (read.coverage === "stale") return { label: "Not current", color: "#f0b955" };
  if (read.coverage === "partial") return { label: "Partial", color: "#8b93a7" };
  return { label: "No score", color: "#8b93a7" };
}

function fetchedLabel(value) {
  if (!value) return "Not downloaded yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not downloaded yet";
  return parsed.toLocaleString();
}

function BusinessTable({ rows, earningsBySymbol, today }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Read</th>
            <th>Revenue</th>
            <th>Earnings</th>
            <th>Margin trend</th>
            <th>Valuation</th>
            <th>Statement</th>
            <th>Downloaded</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const read = row.read;
            const badge = signalBadge(read.signal) || coverageBadge(read);
            const earningsDate = earningsDateFor(earningsBySymbol, row.ticker, row.next_earnings_date);
            const soon = isEarningsSoon(earningsDate, today);
            return (
              <tr key={row.ticker} className={soon ? "earn-soon-row" : undefined}>
                <td>
                  <strong className={soon ? "earn-soon" : undefined}>{row.ticker}</strong>
                  <div className="sync-note"><EarningsDate date={earningsDate} today={today} /></div>
                </td>
                <td>
                  {badge ? <span className="badge" style={{ background: `${badge.color}26`, color: badge.color }}>{badge.label}{read.score != null ? ` ${read.score}` : ""}</span> : "—"}
                  <div className="sync-note wrap-note">{read.summary}</div>
                </td>
                <td className="wrap">{read.revenue.text}</td>
                <td className="wrap">{read.earnings.text}</td>
                <td className="wrap">{read.margin.text}</td>
                <td className="wrap">{read.valuation.text}</td>
                <td>{read.period ? formatDay(read.period) : "No statement date"}</td>
                <td>{fetchedLabel(read.fetchedAt)}</td>
                <td><button type="button" className="action danger" onClick={row.onRemove}>x</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OwnershipTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>13F read</th>
            <th>Buyers</th>
            <th>Sellers</th>
            <th>Breadth</th>
            <th>Analyst opinion</th>
            <th>Ownership downloaded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ownership = row.ownership;
            const analyst = row.analyst;
            return (
              <tr key={row.ticker}>
                <td><strong>{row.ticker}</strong></td>
                <td>{ownership.label}</td>
                <td>{ownership.buyers ?? "—"}</td>
                <td>{ownership.sellers ?? "—"}</td>
                <td>{ownership.breadth == null ? "—" : `${ownership.breadth > 0 ? "+" : ""}${ownership.breadth.toFixed(1)}%`}</td>
                <td className="wrap">{analyst.text || "—"}</td>
                <td>{ownership.fetchedAt ? fetchedLabel(ownership.fetchedAt) : ownership.breadth != null ? "Saved, quarter unknown" : "Not downloaded yet"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function FundamentalScreener() {
  const sample = previewSample();
  const { bySymbol } = useEarningsMap();
  const today = nyToday();
  const [rows, setRows] = useState([]);
  const [ticker, setTicker] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("fundamental_scores").select("*").order("ticker");
    setRows(data || []);
  }, []);

  useEffect(() => {
    if (sample) {
      setRows(sampleScreenerRows());
      return undefined;
    }
    load();
    const channel = supabase
      .channel("fundamental-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, sample]);

  const addTicker = async () => {
    if (!ticker.trim()) return;
    const failed = await ownerMutationFailed(supabase.from("fundamental_scores").upsert({
      ticker: ticker.trim().toUpperCase(),
      updated_at: new Date().toISOString(),
    }));
    if (failed) return;
    setTicker("");
  };

  const removeRow = async (symbol) => {
    await ownerMutationFailed(supabase.from("fundamental_scores").delete().eq("ticker", symbol));
  };

  const now = new Date();
  const prepared = rows.map((row) => ({
    ...row,
    read: readBusinessFundamentals(row, { now }),
    ownership: readOwnership(row),
    analyst: readAnalyst(row),
    onRemove: () => removeRow(row.ticker),
  })).sort((a, b) => {
    const as = a.read.score == null ? -1 : a.read.score;
    const bs = b.read.score == null ? -1 : b.read.score;
    if (as !== bs) return bs - as;
    return String(a.ticker).localeCompare(String(b.ticker));
  });

  return (
    <div className="panel">
      <h2>Fundamental Screener</h2>
      <div className="add-form">
        <div className="field" style={{ minWidth: 100 }}>
          <label htmlFor="add-fundamental-ticker">Add ticker</label>
          <input id="add-fundamental-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="AAPL" />
        </div>
        <button type="button" className="action" onClick={addTicker} disabled={sample}>Add</button>
      </div>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Adding a ticker registers it. The weekly job fills the company figures from Finnhub’s free basic financials. Nothing here is live.
        {TIMING_NOTE}
      </p>

      <h3>Business fundamentals</h3>
      <p className="sync-note" style={{ marginBottom: 8 }}>
        Revenue and earnings growth, the margin trend, and a rough P/E check. The score needs a statement date and a download from the last 45 days. A high P/E, negative earnings, or a shrinking top line blocks a Buy. Price to sales is shown only as context. A blank growth rate is missing, not zero.
      </p>
      {prepared.length > 0 ? (
        <BusinessTable rows={prepared} earningsBySymbol={bySymbol} today={today} />
      ) : (
        <div className="empty">No names screened yet — add a ticker above.</div>
      )}

      <h3>Ownership and opinions</h3>
      <p className="sync-note" style={{ marginBottom: 8 }}>
        These are not the business score. 13F breadth is how many institutions added versus reduced last quarter. The filing quarter is not in the saved feed, so the download time is not the quarter. Analyst ratings are opinions.
        {prepared.some((row) => row.revenue_growth_yoy != null) ? "" : " Revenue growth in the table above stays blank until schema-business-fundamentals.sql has been run and the weekly job has saved a new snapshot."}
      </p>
      {prepared.length > 0 ? <OwnershipTable rows={prepared} /> : null}

      <p className="disclaimer">
        Source for the company figures: Finnhub basic financials, free tier, the same weekly call as before. Growth percents are Finnhub’s published year-over-year numbers (or, if that earnings field is blank, the sum of the last four reported quarters versus the four before, when those quarters are consecutive). Sales per share is not used as revenue. Three-year and five-year averages are not copied into the year-over-year column. Example of a saved growth figure: {formatGrowth(0.08)} means 8%. Institutional buyers and sellers still come from the monthly 13F job.
      </p>
    </div>
  );
}
