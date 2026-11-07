import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { ownerMutationFailed } from "../lib/ownerMutation";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { previewSample } from "../lib/previewSample";
import { isEarningsSoon, nyToday, formatDay } from "../lib/sellSignals";
import { sampleHoldings, sampleQuotesBySymbol, sampleScreenerRows } from "../lib/sellSignalsSample";
import { buildSwingSample } from "../lib/swingSample";
import { sampleMarketStressRows } from "../lib/marketStressSample";
import {
  formatGrowth,
  readAnalyst,
  readBusinessFundamentals,
  readOwnership,
} from "../lib/businessFundamentals";
import { buildDecisionRows } from "../lib/decisionBook";
import { assessmentOrder } from "../lib/signalAssessment";
import { TIMING_NOTE } from "../lib/sessionClock";
import EarningsDate from "./EarningsDate";

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
            <th>Decision</th>
            <th>Company evidence</th>
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
            const decision = row.decision;
            const earningsDate = earningsDateFor(earningsBySymbol, row.ticker, row.next_earnings_date);
            const soon = isEarningsSoon(earningsDate, today);
            return (
              <tr key={row.ticker} className={soon ? "earn-soon-row" : undefined}>
                <td>
                  <strong className={soon ? "earn-soon" : undefined}>{row.ticker}</strong>
                  <div className="sync-note"><EarningsDate date={earningsDate} today={today} /></div>
                </td>
                <td>
                  <strong>{decision ? decision.assessment : "Loading"}</strong>
                  {decision ? <div className="sync-note wrap-note">{decision.reason}</div> : null}
                </td>
                <td>
                  <div>{decision ? decision.fundamentals : "Unknown"}</div>
                  {read.score != null ? <div className="sync-note">Company research figure {read.score}. Not the decision.</div> : null}
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
  const { ready, session } = useOwnerSession();
  const { bySymbol } = useEarningsMap();
  const today = sample ? "2026-10-30" : nyToday();
  const [rows, setRows] = useState([]);
  const [context, setContext] = useState({ quotes: [], stress: null, holdings: [], holdingsKnown: false });
  const [ticker, setTicker] = useState("");

  const load = useCallback(async (userId) => {
    const [scores, quotes, stress, portfolio] = await Promise.all([
      supabase.from("fundamental_scores").select("*").order("ticker"),
      supabase.from("quotes").select("symbol, price, setup_label, suggested_stop, chandelier_stop, bar_date, rs_3m, rs_6m, rs_12m, rs_composite"),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
      userId ? supabase.from("portfolio").select("ticker, shares, cost_basis, theme") : Promise.resolve({ data: [], error: null }),
    ]);
    setRows(scores.data || []);
    setContext({
      quotes: quotes.data || [],
      stress: stress.error ? null : (stress.data || [])[0] || null,
      holdings: portfolio.error ? [] : (portfolio.data || []),
      holdingsKnown: Boolean(userId) && !portfolio.error,
    });
  }, []);

  useEffect(() => {
    if (sample) {
      setRows(sampleScreenerRows());
      return undefined;
    }
    if (!ready) return undefined;
    const userId = session?.user?.id || null;
    setContext({ quotes: [], stress: null, holdings: [], holdingsKnown: false });
    load(userId);
    const channel = supabase
      .channel("fundamental-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, () => load(userId))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, ready, sample, session?.user?.id]);

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

  const now = sample ? new Date("2026-10-30T17:00:00Z") : new Date();
  const decisions = useMemo(() => {
    if (sample) {
      const swing = buildSwingSample();
      return buildDecisionRows({
        quotes: Object.entries(sampleQuotesBySymbol()).map(([symbol, quote]) => ({ symbol, ...quote })),
        views: swing.rows,
        fundamentals: rows,
        holdings: sampleHoldings(),
        holdingsKnown: true,
        stress: sampleMarketStressRows().at(-1),
        earningsBySymbol: bySymbol,
        now,
        today,
      });
    }
    return buildDecisionRows({
      quotes: context.quotes,
      fundamentals: rows,
      holdings: context.holdings,
      holdingsKnown: context.holdingsKnown,
      stress: context.stress,
      earningsBySymbol: bySymbol,
      now,
      today,
    });
  }, [bySymbol, context.holdings, context.holdingsKnown, context.quotes, context.stress, now, rows, sample, today]);
  const prepared = rows.map((row) => ({
    ...row,
    read: readBusinessFundamentals(row, { now }),
    decision: decisions.byTicker.get(row.ticker) || null,
    ownership: readOwnership(row),
    analyst: readAnalyst(row),
    onRemove: () => removeRow(row.ticker),
  })).sort((a, b) => {
    const order = assessmentOrder(a.decision?.assessment) - assessmentOrder(b.decision?.assessment);
    if (order !== 0) return order;
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
        The decision is the same one as Signals. Company evidence can be positive while the decision is Avoid. The research figure is not that decision and is not added to the other columns. A blank growth rate is missing, not zero.
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
