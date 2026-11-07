import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { useEarningsMap } from "../hooks/useEarningsMap";
import { nyToday } from "../lib/sellSignals";
import { sampleHoldings, sampleQuotesBySymbol, sampleScreenerRows } from "../lib/sellSignalsSample";
import { buildSwingSample } from "../lib/swingSample";
import { sampleMarketStressRows } from "../lib/marketStressSample";
import { buildDecisionRows } from "../lib/decisionBook";
import { holdingsAccess } from "../lib/holdingsAccess";
import {
  FILTERS,
  matchesFilter,
  whatWouldChange,
} from "../lib/signalAssessment";

const SAMPLE_CLOCK = new Date("2026-10-30T17:00:00Z");

function toneClass(value) {
  if (value === "Positive" || value === "Buy candidate") return "pill positive";
  if (value === "Negative" || value === "Sell / Exit review") return "pill negative";
  if (value === "Mixed" || value === "Hold / Wait" || value === "Avoid / Not ready") return "pill mixed";
  if (value === "Data check") return "pill data";
  return "pill unknown";
}

function EvidenceList({ title, items, empty }) {
  return (
    <div>
      <h3>{title}</h3>
      {items.length === 0 ? <p className="sync-note">{empty}</p> : (
        <ul className="plain-list">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

export function SignalsView({
  rows,
  regimeLine,
  priceLines = [],
  sample,
  holdingsStatus = "known",
  symbol,
  onOpenSize,
  onOpenNames,
}) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(symbol || "");
  const counts = useMemo(() => ({
    all: rows.length,
    buy: rows.filter((row) => matchesFilter(row.assessment, "buy")).length,
    wait: rows.filter((row) => matchesFilter(row.assessment, "wait")).length,
    sell: rows.filter((row) => matchesFilter(row.assessment, "sell")).length,
    avoid: rows.filter((row) => matchesFilter(row.assessment, "avoid")).length,
    data: rows.filter((row) => matchesFilter(row.assessment, "data")).length,
  }), [rows]);
  const filtered = useMemo(
    () => rows.filter((row) => matchesFilter(row.assessment, filter)),
    [filter, rows],
  );
  const current = filtered.find((row) => row.ticker === selected) || filtered[0] || null;

  return (
    <div className="panel">
      <h2>Signals</h2>
      {sample ? <div className="sample-banner">Sample prices for layout preview. Not your account and not a live signal.</div> : null}
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        The label is the overall read. Fundamentals, technicals, and supporting context are shown separately. They are not added into a score. Prices are the daily close. Company reports lag. Nothing here places an order.
        {priceLines.length ? ` ${priceLines.join(" ")}` : ""}
        {regimeLine ? ` ${regimeLine}` : ""}
        {holdingsStatus === "private" ? " Sign in to include names you hold. Exit review is not evaluated until then." : ""}
        {holdingsStatus === "error" ? " Holdings could not be read, so exit review is not evaluated." : ""}
        {holdingsStatus === "empty" ? " No holdings are saved, so there is no exit review." : ""}
      </p>
      {onOpenNames ? (
        <p className="sync-note"><button type="button" className="link-btn" onClick={onOpenNames}>Add or remove a name</button></p>
      ) : null}
      <div className="subnav" role="toolbar" aria-label="Filter by overall label">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "active" : ""}
            aria-pressed={filter === item.id}
            disabled={item.id === "sell" && holdingsStatus !== "known" && holdingsStatus !== "empty"}
            onClick={() => setFilter(item.id)}
          >
            {item.id === "sell" && holdingsStatus !== "known" && holdingsStatus !== "empty"
              ? "Exit (not evaluated)"
              : `${item.label} (${counts[item.id]})`}
          </button>
        ))}
      </div>
      <p className="sync-note">Grouped by the label, then by relative strength versus SPY. Rank is order only.</p>
      {filtered.length === 0 ? <div className="empty">No names in this filter.</div> : (
        <>
        <div className="signal-cards">
          {filtered.map((row) => (
            <button
              key={row.ticker}
              type="button"
              className={current && current.ticker === row.ticker ? "signal-card selected-row" : "signal-card"}
              onClick={() => setSelected(row.ticker)}
            >
              <strong>{row.ticker}</strong>
              <span className={toneClass(row.assessment)}>{row.assessment}</span>
              <span className="sync-note">Fundamentals {row.fundamentals}</span>
              <span className="sync-note">Technicals {row.technicals}</span>
              <span className="sync-note">Supporting {row.supporting}</span>
            </button>
          ))}
        </div>
        <div className="table-wrap signal-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Stock</th>
                <th scope="col">Overall</th>
                <th scope="col">Fundamentals</th>
                <th scope="col">Technicals</th>
                <th scope="col">Supporting</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.ticker} className={current && current.ticker === row.ticker ? "selected-row" : undefined}>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setSelected(row.ticker)}>
                      <strong>{row.ticker}</strong>
                    </button>
                    {row.held ? <div className="sync-note">Held</div> : null}
                    {row.avoidNewEntry ? <div className="sync-note">Avoid new entry — earnings</div> : null}
                  </td>
                  <td><span className={toneClass(row.assessment)}>{row.assessment}</span></td>
                  <td><span className={toneClass(row.fundamentals)}>{row.fundamentals}</span></td>
                  <td><span className={toneClass(row.technicals)}>{row.technicals}</span></td>
                  <td><span className={toneClass(row.supporting)}>{row.supporting}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <div className="field" style={{ maxWidth: 360, marginTop: 12 }}>
        <label htmlFor="inspect-stock">Inspect stock</label>
        <select
          id="inspect-stock"
          value={current ? current.ticker : ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {filtered.map((row) => (
            <option key={row.ticker} value={row.ticker}>{row.ticker} — {row.assessment}</option>
          ))}
        </select>
      </div>

      {current ? (
        <div aria-live="polite">
          <h3>{current.ticker}</h3>
          <p><span className={toneClass(current.assessment)}>{current.assessment}</span></p>
          <p>{current.reason}</p>
          <p>{whatWouldChange(current)}</p>
          <p>{current.trigger}</p>
          <p>{current.invalidation}</p>
          <div className="grid-2">
            <EvidenceList title="Positive evidence" items={current.positives} empty="No positive pillar on this name." />
            <EvidenceList title="Negative evidence" items={current.negatives} empty="No negative pillar on this name." />
          </div>
          <EvidenceList title="Unknown or mixed — not a vote" items={current.neutrals} empty="No extra context." />
          {onOpenSize ? (
            <button type="button" className="action" onClick={onOpenSize}>Open position size</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Signals({ symbol, onOpenSize, onOpenNames }) {
  const sample = previewSample();
  const { ready, session } = useOwnerSession();
  const earnings = useEarningsMap();
  const signedIn = Boolean(session?.user);
  const [pack, setPack] = useState({
    userId: null,
    pending: !sample,
    quotes: [],
    fundamentals: [],
    holdings: [],
    holdingsError: null,
    stress: null,
  });

  const load = useCallback(async (userId) => {
    const [quoteResult, fundamentalResult, portfolioResult, stressResult] = await Promise.all([
      supabase.from("quotes").select("symbol, price, rsi, sma_50, chandelier_stop, setup_label, setup_reason, suggested_stop, risk_pct, rs_3m, rs_6m, rs_12m, rs_composite, bar_date, updated_at"),
      supabase.from("fundamental_scores").select("*"),
      userId
        ? supabase.from("portfolio").select("ticker, shares, cost_basis, theme")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
    ]);
    return {
      userId,
      pending: false,
      quotes: quoteResult.data || [],
      fundamentals: fundamentalResult.data || [],
      holdings: portfolioResult.error ? [] : (portfolioResult.data || []),
      holdingsError: portfolioResult.error || null,
      stress: stressResult.error ? null : (stressResult.data || [])[0] || null,
    };
  }, []);

  useEffect(() => {
    if (sample || !ready) return undefined;
    const userId = session?.user?.id || null;
    let cancelled = false;
    setPack({
      userId,
      pending: true,
      quotes: [],
      fundamentals: [],
      holdings: [],
      holdingsError: null,
      stress: null,
    });
    load(userId).then((next) => {
      if (!cancelled) setPack(next);
    });
    return () => { cancelled = true; };
  }, [load, ready, sample, session?.user?.id]);

  const today = sample ? "2026-10-30" : nyToday();
  const access = holdingsAccess({
    ready: sample || ready,
    signedIn: sample || signedIn,
    pending: sample ? false : !ready || (signedIn && (pack.pending || pack.userId !== session?.user?.id)),
    error: pack.userId === session?.user?.id ? pack.holdingsError : null,
    count: sample ? sampleHoldings().length : (pack.userId === session?.user?.id ? pack.holdings.length : 0),
  });
  const model = useMemo(() => {
    const now = sample ? SAMPLE_CLOCK : new Date();
    if (sample) {
      const swing = buildSwingSample();
      const quoteMap = sampleQuotesBySymbol();
      return buildDecisionRows({
        quotes: Object.entries(quoteMap).map(([symbolName, quote]) => ({ symbol: symbolName, ...quote })),
        views: swing.rows,
        fundamentals: sampleScreenerRows(),
        holdings: sampleHoldings(),
        holdingsKnown: true,
        stress: sampleMarketStressRows().at(-1),
        earningsBySymbol: earnings.bySymbol,
        now,
        today,
      });
    }
    return buildDecisionRows({
      quotes: pack.quotes,
      fundamentals: pack.fundamentals,
      holdings: access.status === "ready" || access.status === "empty" ? pack.holdings : [],
      holdingsKnown: access.status === "ready" || access.status === "empty",
      stress: pack.stress,
      earningsBySymbol: earnings.bySymbol,
      now,
      today,
    });
  }, [access.status, earnings.bySymbol, pack.fundamentals, pack.holdings, pack.quotes, pack.stress, sample, today]);

  if (!sample && (!ready || pack.pending || (signedIn && pack.userId !== session?.user?.id))) {
    return <div className="panel"><h2>Signals</h2><p>Loading…</p></div>;
  }

  return (
    <SignalsView
      rows={model.rows}
      regimeLine={model.regimeLine}
      priceLines={model.priceSummary.lines}
      sample={sample}
      holdingsStatus={access.status === "ready" ? "known" : access.status}
      symbol={symbol}
      onOpenSize={onOpenSize}
      onOpenNames={onOpenNames}
    />
  );
}
