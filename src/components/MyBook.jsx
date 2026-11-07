import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { sampleHoldings, sampleQuotesBySymbol } from "../lib/sellSignalsSample";
import { assessBook } from "../lib/portfolioRisk";
import { holdingsAccess } from "../lib/holdingsAccess";
import { formatUsdFromCents } from "../lib/positionSize";
import SellSignals from "./SellSignals";
import PositionSize from "./PositionSize";
import PortfolioAllocation from "./PortfolioAllocation";
import TradeJournal from "./TradeJournal";

const SECTIONS = [
  { key: "risk", label: "Risk" },
  { key: "exits", label: "Exits" },
  { key: "size", label: "Position size" },
  { key: "holdings", label: "Holdings" },
  { key: "journal", label: "Journal" },
];

function money(value) {
  if (!Number.isFinite(value)) return "—";
  return formatUsdFromCents(Math.round(value * 100));
}

function percent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function RiskPanel({ book, sample }) {
  if (!book) return <p>Loading the book…</p>;
  return (
    <div>
      {sample ? <div className="sample-banner">Sample holdings. Not your account.</div> : null}
      <div className="grid-3">
        <div className="stat-box">
          <div className="label">Planned downside (USD)</div>
          <div className="value">{money(book.plannedLoss)}</div>
          <div className="sync-note">{book.coveredCount} of {book.holdingCount} holdings have a fresh price and a trailing exit stop still above that price.</div>
        </div>
        <div className="stat-box">
          <div className="label">That downside / covered value</div>
          <div className="value">{percent(book.plannedLossPct)}</div>
          <div className="sync-note">Covered value {money(book.coveredMarketValue)}. Fresh prices only. Missing names are not treated as zero.</div>
        </div>
        <div className="stat-box">
          <div className="label">Versus cost at the stop</div>
          <div className="value">{money(book.pnlAtStop)}</div>
          <div className="sync-note">Profit here is not negative risk and is not subtracted from the planned downside. {book.pnlAtStopCount} holdings have a cost.</div>
        </div>
      </div>
      <h3>Missing from the risk total</h3>
      {book.holdingCount === 0 ? <p className="sync-note">No holdings are saved, so there is no downside to add.</p> : book.missing.length === 0 ? <p className="sync-note">Every saved holding in this list has a fresh price and a stop still above it.</p> : (
        <ul className="plain-list">
          {book.missing.map((row) => (
            <li key={row.ticker}>{row.ticker}: {row.stopState === "stale" || row.stopState === "delayed" || row.stopState === "ahead" ? `price session ${row.barDate || "unknown"} is not current, so it is not counted` : row.stopState === "through" ? "the trailing exit stop is already through the price, so the old distance is not remaining risk" : row.stopState === "no-stop" ? "no trailing exit stop is saved" : "no current price or share count"}. </li>
          ))}
        </ul>
      )}
      <h3>Concentration</h3>
      <p className="sync-note">Weights use fresh prices only, as a share of {money(book.freshMarketValue)}. A theme is a label, not a correlation. No sector is invented. Blank or “Unclassified” counts as no sector saved.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Weight of fresh value</th></tr></thead>
          <tbody>
            {book.names.map((row) => (
              <tr key={row.ticker}>
                <td>{row.ticker}{row.weight > book.nameCap ? " — over the 25% name guide" : ""}</td>
                <td>{percent(row.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Theme</th><th>Names</th><th>Weight</th></tr></thead>
          <tbody>
            {book.themes.map((row) => (
              <tr key={row.label}>
                <td>{row.label}{row.weight > book.themeCap ? " — over the 40% theme guide" : ""}</td>
                <td>{row.tickers.join(", ")}</td>
                <td>{percent(row.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="disclaimer">{book.caveat} The stop in this total is the trailing exit: the 22-day high minus 3×ATR(22). It is not the 2×ATR(14) entry stop on the Setups page.</p>
    </div>
  );
}

function useBookRisk(sample, ready, session) {
  const [holdings, setHoldings] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [pending, setPending] = useState(!sample);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    if (sample) {
      setHoldings(sampleHoldings());
      setQuotes(Object.entries(sampleQuotesBySymbol()).map(([symbol, quote]) => ({ symbol, ...quote })));
      setPending(false);
      setError(null);
      return undefined;
    }
    if (!ready) return undefined;
    const nextId = session?.user?.id || null;
    setUserId(nextId);
    setHoldings([]);
    setQuotes([]);
    setError(null);
    if (!nextId) {
      setPending(false);
      return undefined;
    }
    let cancelled = false;
    setPending(true);
    Promise.all([
      supabase.from("portfolio").select("ticker, shares, cost_basis, theme, sector"),
      supabase.from("quotes").select("symbol, price, chandelier_stop, bar_date, updated_at"),
    ]).then(([portfolioResult, quoteResult]) => {
      if (cancelled) return;
      setError(portfolioResult.error || null);
      setHoldings(portfolioResult.error ? [] : (portfolioResult.data || []));
      setQuotes(quoteResult.data || []);
      setPending(false);
    });
    return () => { cancelled = true; };
  }, [ready, sample, session]);
  const quotesBySymbol = useMemo(() => {
    const map = {};
    for (const quote of quotes) map[quote.symbol] = quote;
    return map;
  }, [quotes]);
  const access = holdingsAccess({
    ready: sample || ready,
    signedIn: sample || Boolean(session?.user),
    pending: sample ? false : !ready || (Boolean(session?.user) && (pending || userId !== session?.user?.id)),
    error,
    count: holdings.length,
  });
  const book = useMemo(() => assessBook({
    holdings,
    quotesBySymbol,
    now: sample ? new Date("2026-10-30T17:00:00Z") : new Date(),
  }), [holdings, quotesBySymbol, sample]);
  return { book, access };
}

export default function MyBook({ section, onSection }) {
  const sample = previewSample();
  const { ready, session } = useOwnerSession();
  const { book, access } = useBookRisk(sample, ready, session);
  const active = SECTIONS.some((item) => item.key === section) ? section : "risk";

  return (
    <div>
      <div className="subnav" role="tablist" aria-label="Holdings sections">
        {SECTIONS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={active === item.key} className={active === item.key ? "active" : ""} onClick={() => onSection(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      {active === "risk" ? (
        <div className="panel">
          <h2>Portfolio risk</h2>
          {access.status === "loading" ? <p>Loading holdings…</p> : null}
          {access.status === "private" ? <p>Sign in to see risk for your holdings. Nothing has been evaluated, and a blank book is not zero risk.</p> : null}
          {access.status === "error" ? <p>Holdings could not be read. They are not treated as an empty book.</p> : null}
          {access.status === "empty" ? <p>No holdings are saved. There is no planned downside because the book is empty, not because the risk is zero.</p> : null}
          {access.status === "ready" ? <RiskPanel book={book} sample={sample} /> : null}
        </div>
      ) : null}
      {active === "exits" ? <SellSignals /> : null}
      {active === "size" ? <PositionSize /> : null}
      {active === "holdings" ? <PortfolioAllocation /> : null}
      {active === "journal" ? <TradeJournal /> : null}
    </div>
  );
}
