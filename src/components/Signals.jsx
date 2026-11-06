import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { buildSellBook, isEarningsSoon, nyToday } from "../lib/sellSignals";
import { sampleHoldings, sampleQuotesBySymbol, sampleScreenerRows } from "../lib/sellSignalsSample";
import { buildSwingSample } from "../lib/swingSample";
import { BENCHMARK_SYMBOL, assignRelativeStrengthRanks, viewRowFromQuote } from "../lib/swingSetups";
import { readBusinessFundamentals } from "../lib/businessFundamentals";
import { presentRegime } from "../lib/marketStress";
import { sampleMarketStressRows } from "../lib/marketStressSample";
import { sessionsBehind } from "../lib/sessionClock";
import {
  FILTERS,
  assessmentOrder,
  assessSignal,
  matchesFilter,
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
  sample,
  heldNote,
  symbol,
  onOpenSize,
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
        {regimeLine ? ` ${regimeLine}` : ""}
        {heldNote ? ` ${heldNote}` : ""}
      </p>
      <div className="subnav" role="toolbar" aria-label="Filter by overall label">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "active" : ""}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label} ({counts[item.id]})
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

function compareRows(a, b) {
  const order = assessmentOrder(a.assessment) - assessmentOrder(b.assessment);
  if (order !== 0) return order;
  const ar = Number.isFinite(a.rsRank) ? a.rsRank : 9999;
  const br = Number.isFinite(b.rsRank) ? b.rsRank : 9999;
  if (ar !== br) return ar - br;
  return String(a.ticker).localeCompare(String(b.ticker));
}

export default function Signals({ symbol, onOpenSize }) {
  const sample = previewSample();
  const { ready, session } = useOwnerSession();
  const earnings = useEarningsMap();
  const [quotes, setQuotes] = useState([]);
  const [fundamentals, setFundamentals] = useState([]);
  const [portfolio, setPortfolio] = useState([]);
  const [heldNote, setHeldNote] = useState("");
  const [stress, setStress] = useState(null);
  const [loading, setLoading] = useState(!sample);

  const load = useCallback(async () => {
    if (sample) return;
    const [quoteResult, fundamentalResult, portfolioResult, stressResult] = await Promise.all([
      supabase.from("quotes").select("symbol, price, rsi, sma_50, chandelier_stop, setup_label, setup_reason, suggested_stop, risk_pct, rs_3m, rs_6m, rs_12m, rs_composite, bar_date, updated_at"),
      supabase.from("fundamental_scores").select("*"),
      supabase.from("portfolio").select("ticker, shares, cost_basis, theme"),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
    ]);
    setQuotes(quoteResult.data || []);
    setFundamentals(fundamentalResult.data || []);
    if (portfolioResult.error) {
      setPortfolio([]);
      setHeldNote("Sign in to mark names you already hold. Exit review only appears for those holdings.");
    } else {
      setPortfolio(portfolioResult.data || []);
      setHeldNote("");
    }
    setStress(stressResult.error ? null : (stressResult.data || [])[0] || null);
    setLoading(false);
  }, [sample]);

  useEffect(() => {
    if (sample || !ready) return undefined;
    load();
    return undefined;
  }, [load, ready, sample, session?.user?.id]);

  const today = sample ? "2026-10-30" : nyToday();
  const model = useMemo(() => {
    const now = sample ? SAMPLE_CLOCK : new Date();
    if (sample) {
      const swing = buildSwingSample();
      const holdings = sampleHoldings();
      const quoteMap = sampleQuotesBySymbol();
      const book = buildSellBook({
        holdings,
        quotesBySymbol: quoteMap,
        earningsBySymbol: {},
        today,
        now,
      });
      const exitByTicker = new Map(book.rows.map((row) => [row.ticker, row.status]));
      const businessByTicker = new Map(sampleScreenerRows().map((row) => [row.ticker, readBusinessFundamentals(row, { now })]));
      const regime = presentRegime(sampleMarketStressRows().at(-1), now);
      const heldNames = new Set(holdings.map((row) => row.ticker));
      const ranked = assignRelativeStrengthRanks(swing.rows);
      const rows = ranked
        .filter((row) => row.symbol !== BENCHMARK_SYMBOL)
        .map((row) => assessSignal({
          ticker: row.symbol,
          held: heldNames.has(row.symbol),
          label: row.label,
          freshness: "fresh",
          barDate: swing.barDate,
          stop: row.stop,
          exitStop: quoteMap[row.symbol]?.chandelier_stop,
          exitStatus: exitByTicker.get(row.symbol) || null,
          rsRank: row.rsRank,
          rsCount: row.rsCount,
          businessCoverage: businessByTicker.get(row.symbol)?.coverage || "missing",
          businessSignal: businessByTicker.get(row.symbol)?.signal || null,
          businessSummary: businessByTicker.get(row.symbol)?.summary || null,
          statementPeriod: businessByTicker.get(row.symbol)?.period || null,
          earningsSoon: isEarningsSoon(earningsDateFor(earnings.bySymbol, row.symbol, null), today),
          earningsDate: earningsDateFor(earnings.bySymbol, row.symbol, null),
          regimeState: regime.state,
          regime: regime.regime,
          regimeAsOf: regime.asOf,
        }))
        .sort(compareRows);
      return {
        rows,
        regimeLine: regime.state === "fresh"
          ? `Market light is ${regime.regime} for ${regime.asOf}. It does not confirm a stock.`
          : "Market light is not a current reading.",
      };
    }

    const regime = presentRegime(stress, now);
    const businessByTicker = new Map((fundamentals || []).map((row) => [row.ticker, readBusinessFundamentals(row, { now })]));
    const quoteBySymbol = new Map((quotes || []).map((row) => [row.symbol, row]));
    const book = buildSellBook({
      holdings: portfolio,
      quotesBySymbol: Object.fromEntries((quotes || []).map((row) => [row.symbol, row])),
      earningsBySymbol: {},
      today,
      now,
    });
    const exitByTicker = new Map(book.rows.map((row) => [row.ticker, row.status]));
    const heldNames = new Set((portfolio || []).map((row) => row.ticker));
    const ranked = assignRelativeStrengthRanks((quotes || []).map(viewRowFromQuote).filter(Boolean));
    const symbols = new Set([
      ...ranked.map((row) => row.symbol),
      ...businessByTicker.keys(),
      ...heldNames,
    ]);
    symbols.delete(BENCHMARK_SYMBOL);
    const rows = [...symbols].map((ticker) => {
      const view = ranked.find((row) => row.symbol === ticker);
      const quote = quoteBySymbol.get(ticker);
      const business = businessByTicker.get(ticker);
      const info = sessionsBehind(quote?.bar_date, now);
      return assessSignal({
        ticker,
        held: heldNames.has(ticker),
        label: view?.label || null,
        freshness: quote ? info.state : "missing",
        barDate: quote?.bar_date ? String(quote.bar_date).slice(0, 10) : null,
        stop: view?.stop,
        exitStop: quote?.chandelier_stop,
        exitStatus: exitByTicker.get(ticker) || null,
        rsRank: view?.rsRank,
        rsCount: view?.rsCount,
        businessCoverage: business?.coverage || "missing",
        businessSignal: business?.signal || null,
        businessSummary: business?.summary || null,
        statementPeriod: business?.period || null,
        earningsSoon: isEarningsSoon(earningsDateFor(earnings.bySymbol, ticker, null), today),
        earningsDate: earningsDateFor(earnings.bySymbol, ticker, null),
        regimeState: regime.state,
        regime: regime.regime,
        regimeAsOf: regime.asOf,
      });
    }).sort(compareRows);
    return {
      rows,
      regimeLine: regime.state === "fresh"
        ? `Market light is ${regime.regime} for ${regime.asOf}. It does not confirm a stock.`
        : "Market light is not a current reading.",
    };
  }, [earnings.bySymbol, fundamentals, portfolio, quotes, sample, stress, today]);

  if (!sample && (!ready || loading)) {
    return <div className="panel"><h2>Signals</h2><p>Loading…</p></div>;
  }

  return (
    <SignalsView
      rows={model.rows}
      regimeLine={model.regimeLine}
      sample={sample}
      heldNote={heldNote}
      symbol={symbol}
      onOpenSize={onOpenSize}
    />
  );
}
