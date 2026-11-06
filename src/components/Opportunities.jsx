import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { buildSellBook, isEarningsSoon, nyToday, tradingDaysUntil } from "../lib/sellSignals";
import { technicalReadFromQuote } from "../lib/swingSetups";
import { readAnalyst, readBusinessFundamentals, readOwnership } from "../lib/businessFundamentals";
import { CATEGORIES, TIMING_NOTE, categoryTone, decideAction } from "../lib/signalBoard";
import { presentRegime } from "../lib/marketStress";

function earningsReason(dateStr, today) {
  if (!isEarningsSoon(dateStr, today)) return null;
  const days = tradingDaysUntil(today, dateStr);
  if (days === 0) return "Earnings today — skip new buys";
  return `Earnings in ${days} trading day${days === 1 ? "" : "s"} — skip new buys`;
}

export default function Opportunities() {
  const { ready, session } = useOwnerSession();
  const { bySymbol } = useEarningsMap();
  const today = nyToday();
  const now = new Date();
  const [fundamental, setFundamental] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [portfolio, setPortfolio] = useState([]);
  const [regimeRow, setRegimeRow] = useState(null);

  const loadAll = useCallback(async () => {
    const [f, q, p, stress] = await Promise.all([
      supabase.from("fundamental_scores").select("*"),
      supabase.from("quotes").select("*"),
      supabase.from("portfolio").select("*"),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
    ]);
    setFundamental(f.data || []);
    setQuotes(q.data || []);
    setPortfolio(p.data || []);
    setRegimeRow(stress.error ? null : (stress.data || [])[0] || null);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    loadAll();
    const c1 = supabase.channel("opp-fundamental").on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, loadAll).subscribe();
    const c2 = supabase.channel("opp-quotes").on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, loadAll).subscribe();
    const c3 = supabase.channel("opp-portfolio").on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, loadAll).subscribe();
    return () => { supabase.removeChannel(c1); supabase.removeChannel(c2); supabase.removeChannel(c3); };
  }, [loadAll, ready, session?.user?.id]);

  const regime = presentRegime(regimeRow, now);
  const earningsBySymbol = {};
  for (const [symbol, value] of Object.entries(bySymbol || {})) {
    earningsBySymbol[symbol] = value?.date || null;
  }
  const sellBook = buildSellBook({
    holdings: portfolio,
    quotesBySymbol: Object.fromEntries(quotes.map((row) => [row.symbol, row])),
    earningsBySymbol,
    today,
    now,
  });
  const sellByTicker = Object.fromEntries(sellBook.rows.map((row) => [row.ticker, row]));
  const tickers = Array.from(new Set([
    ...fundamental.map((row) => row.ticker),
    ...quotes.map((row) => row.symbol),
    ...portfolio.map((row) => row.ticker),
  ]));

  const rows = tickers.map((ticker) => {
    const f = fundamental.find((row) => row.ticker === ticker);
    const q = quotes.find((row) => row.symbol === ticker);
    const p = portfolio.find((row) => row.ticker === ticker);
    const business = readBusinessFundamentals(f, { now });
    const technical = technicalReadFromQuote(q, { now });
    const held = !!p;
    const earnDate = earningsDateFor(bySymbol, ticker, f?.next_earnings_date);
    const soon = isEarningsSoon(earnDate, today);
    const decision = decideAction({
      business,
      ownership: readOwnership(f),
      analyst: readAnalyst(f),
      technical,
      sell: sellByTicker[ticker] ? { status: sellByTicker[ticker].status, stop: sellByTicker[ticker].stop } : null,
      held,
      earningsSoon: soon,
      regime: regime.state === "fresh" ? regime : null,
    });
    const earnReason = earningsReason(earnDate, today);
    return {
      ticker,
      held,
      soon,
      price: q?.price,
      priceSession: technical.barDate,
      decision,
      earnReason,
    };
  });

  rows.sort((a, b) => a.decision.priority - b.decision.priority || (b.decision.businessScore || 0) - (a.decision.businessScore || 0));

  return (
    <div className="panel">
      <h2>Opportunities</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        The business read and the price setup are kept apart. A name lands in a bucket only when those reads are from a current session or a current company snapshot. Ownership, analyst opinions, RSI, and the market light are context, not extra votes.
        {" "}{TIMING_NOTE}
        {regime.state === "missing" ? " No market-regime row is saved, so nothing is assumed calm or stressed." : ` Market session ${regime.asOf || "unknown"} is ${regime.state === "fresh" ? regime.regime : "not current"}.`}
        {ready && !session ? " Sign in so positions you already hold are marked as held." : ""}
      </p>

      {CATEGORIES.map((category) => {
        const catRows = rows.filter((row) => row.decision.category === category);
        if (catRows.length === 0) return null;
        const color = categoryTone(category);
        return (
          <div key={category} style={{ marginBottom: 20 }}>
            <h3 style={{ color }}>{category} ({catRows.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Ticker</th><th>Price</th><th>Session</th><th>Business</th><th>Setup</th><th>Why</th></tr>
                </thead>
                <tbody>
                  {catRows.map((row) => (
                    <tr key={row.ticker}>
                      <td><strong className={row.soon ? "earn-soon" : undefined}>{row.ticker}</strong></td>
                      <td>{row.price != null ? Number(row.price).toFixed(2) : "—"}</td>
                      <td>{row.priceSession || "—"}</td>
                      <td>{row.decision.businessSignal ? `${row.decision.businessSignal}${row.decision.businessScore != null ? ` (${row.decision.businessScore})` : ""}` : "—"}</td>
                      <td>{row.decision.technicalLabel || "—"}</td>
                      <td style={{ whiteSpace: "normal", fontSize: 12 }}>
                        {row.decision.headline}
                        {row.earnReason ? <div style={{ color: "#8b93a7", marginTop: 2 }}>{row.earnReason}</div> : null}
                        {row.decision.reasons.length > 0 && (
                          <div style={{ color: "#8b93a7", marginTop: 2 }}>{row.decision.reasons.join(" ")}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {rows.length === 0 && <div className="empty">No tickers yet — add names to the Fundamental Screener or watchlist.</div>}
    </div>
  );
}
