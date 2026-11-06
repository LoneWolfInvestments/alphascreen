import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { formatDay, isEarningsSoon, nyToday, tradingDaysUntil } from "../lib/sellSignals";
import { technicalReadFromQuote } from "../lib/swingSetups";
import { readBusinessFundamentals, readOwnership } from "../lib/businessFundamentals";
import { TIMING_NOTE, agreementLabel } from "../lib/signalBoard";
import EarningsDate from "./EarningsDate";
import { MarketStressBanner } from "./MarketStress";

function earningsCaveat(dateStr, today) {
  if (!dateStr) return null;
  const pretty = formatDay(dateStr);
  if (!isEarningsSoon(dateStr, today)) return pretty ? `Earnings ${pretty}` : null;
  const days = tradingDaysUntil(today, dateStr);
  const when = days === 0 ? "today" : `in ${days} trading day${days === 1 ? "" : "s"}`;
  return `Earnings ${pretty} (${when}) — skip new buys`;
}

const PRIORITY = {
  "Business and setup both up": 0,
  "Both look weak": 1,
  "Business and price disagree": 2,
  Mixed: 3,
  "Price not current": 4,
  "Fundamentals not current": 4,
  Partial: 5,
  "No current read": 6,
};

export default function Overview() {
  const { ready, session } = useOwnerSession();
  const { bySymbol } = useEarningsMap();
  const today = nyToday();
  const now = new Date();
  const [fundamental, setFundamental] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [portfolio, setPortfolio] = useState([]);

  const loadAll = useCallback(async () => {
    const [f, q, p] = await Promise.all([
      supabase.from("fundamental_scores").select("*"),
      supabase.from("quotes").select("*"),
      supabase.from("portfolio").select("ticker"),
    ]);
    setFundamental(f.data || []);
    setQuotes(q.data || []);
    setPortfolio(p.data || []);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    loadAll();
    const c1 = supabase.channel("overview-fundamental").on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, loadAll).subscribe();
    const c2 = supabase.channel("overview-quotes").on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, loadAll).subscribe();
    const c3 = supabase.channel("overview-portfolio").on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, loadAll).subscribe();
    return () => { supabase.removeChannel(c1); supabase.removeChannel(c2); supabase.removeChannel(c3); };
  }, [loadAll, ready, session?.user?.id]);

  const tickers = Array.from(new Set([
    ...fundamental.map((row) => row.ticker),
    ...quotes.map((row) => row.symbol),
    ...portfolio.map((row) => row.ticker),
  ])).sort();

  const rows = tickers.map((ticker) => {
    const f = fundamental.find((row) => row.ticker === ticker);
    const q = quotes.find((row) => row.symbol === ticker);
    const business = readBusinessFundamentals(f, { now });
    const technical = technicalReadFromQuote(q, { now });
    const ownership = readOwnership(f);
    const agreement = agreementLabel({ business, technical });
    const earnDate = earningsDateFor(bySymbol, ticker, f?.next_earnings_date);
    const notes = [business.summary, technical.reasons[0], ownership.text, earningsCaveat(earnDate, today)].filter(Boolean);
    return {
      ticker,
      business,
      technical,
      agreement,
      price: q?.price,
      rsi: q?.rsi,
      macd: q?.macd,
      earnDate,
      soon: isEarningsSoon(earnDate, today),
      notes,
    };
  });

  rows.sort((a, b) => (PRIORITY[a.agreement.label] ?? 9) - (PRIORITY[b.agreement.label] ?? 9));

  return (
    <>
      <MarketStressBanner />
      <div className="panel">
        <h2>Overview</h2>
        <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
          Business is revenue, earnings, margins, and a rough P/E check. The setup is the daily price pattern. “Together” only describes whether those two agree. It is not a blended score. RSI and MACD are shown as lagging oscillators and are not a third signal. 13F ownership is quoted in the note and is not scored.
          {" "}{TIMING_NOTE}
          {ready && !session ? " Sign in to include tickers that are only in your portfolio." : ""}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Next earnings</th>
                <th>Business</th>
                <th>Setup</th>
                <th>Price session</th>
                <th>Together</th>
                <th>Price</th>
                <th>RSI 14, lagging</th>
                <th>MACD, lagging</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticker} className={row.soon ? "earn-soon-row" : undefined}>
                  <td><strong className={row.soon ? "earn-soon" : undefined}>{row.ticker}</strong></td>
                  <td><EarningsDate date={row.earnDate} today={today} /></td>
                  <td>{row.business.signal ? `${row.business.signal}${row.business.score != null ? ` (${row.business.score})` : ""}` : "—"}</td>
                  <td>{row.technical.displayLabel || "—"}</td>
                  <td>{row.technical.barDate || "—"}{row.technical.fetchedAt ? <div className="sync-note">Saved {new Date(row.technical.fetchedAt).toLocaleString()}</div> : null}</td>
                  <td>
                    <span className="badge" style={{ background: `${row.agreement.tone}26`, color: row.agreement.tone }}>
                      {row.agreement.label}
                    </span>
                  </td>
                  <td>{row.price != null ? Number(row.price).toFixed(2) : "—"}</td>
                  <td>{row.rsi != null ? Number(row.rsi).toFixed(1) : "—"}</td>
                  <td>{row.macd != null ? Number(row.macd).toFixed(2) : "—"}</td>
                  <td className="wrap">{row.notes.join(" ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="empty">
              No names yet — add tickers to the Fundamental Screener and/or the watchlist to see them side by side.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
