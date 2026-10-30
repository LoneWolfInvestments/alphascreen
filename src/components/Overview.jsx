// src/components/Overview.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { formatDay, isEarningsSoon, nyToday, tradingDaysUntil } from "../lib/sellSignals";
import { technicalReadFromQuote } from "../lib/swingSetups";
import EarningsDate from "./EarningsDate";
import { MarketStressBanner } from "./MarketStress";

// ---- Fundamental side: institutional breadth + analyst rating combined ----
function fundamentalRead(f) {
  if (!f) return { score: null, sig: null };
  const hasBreadth = f.inst_net_breadth != null;
  const hasAnalyst = !!f.analyst_rating;
  if (!hasBreadth && !hasAnalyst) return { score: null, sig: null };

  const breadthPoints = hasBreadth ? f.inst_net_breadth / 50 : 0; // roughly -1..1
  const analystPoints = f.analyst_rating === "Buy" ? 1 : f.analyst_rating === "Sell" ? -1 : 0;
  const inputs = (hasBreadth ? 1 : 0) + (hasAnalyst ? 1 : 0);
  const combined = (breadthPoints + analystPoints) / inputs;

  const score = hasBreadth ? Math.round(50 + f.inst_net_breadth) : null; // kept for display only
  let sig = "Hold";
  if (combined > 0.3) sig = "Buy";
  else if (combined < -0.3) sig = "Sell";
  return { score, sig };
}

function technicalRead(q) {
  return technicalReadFromQuote(q);
}

function earningsCaveat(dateStr, today) {
  if (!dateStr) return null;
  const pretty = formatDay(dateStr);
  if (!isEarningsSoon(dateStr, today)) return pretty ? `Earnings ${pretty}` : null;
  const days = tradingDaysUntil(today, dateStr);
  const when = days === 0 ? "today" : `in ${days} trading day${days === 1 ? "" : "s"}`;
  return `Earnings ${pretty} (${when}) — skip new buys`;
}

function confluenceRead(fSig, tSig) {
  if (fSig == null && tSig == null) return { label: "No data", color: "#8b93a7" };
  if (fSig == null || tSig == null) return { label: "Partial data", color: "#8b93a7" };
  if (fSig === "Buy" && tSig === "Buy") return { label: "Strong Buy confluence", color: "#3ecf8e" };
  if (fSig === "Sell" && tSig === "Sell") return { label: "Strong Sell confluence", color: "#f0555a" };
  if ((fSig === "Buy" && tSig === "Sell") || (fSig === "Sell" && tSig === "Buy")) return { label: "Conflicting signals", color: "#f0b955" };
  return { label: "Neutral / mixed", color: "#8b93a7" };
}

export default function Overview() {
  const { ready, session } = useOwnerSession();
  const { bySymbol } = useEarningsMap();
  const today = nyToday();
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

  // Union of every ticker mentioned anywhere — portfolio just contributes tickers
  // to make sure held positions show up here, even though its weight/conviction
  // fields are no longer displayed on this tab.
  const tickers = Array.from(new Set([
    ...fundamental.map((r) => r.ticker),
    ...quotes.map((r) => r.symbol),
    ...portfolio.map((r) => r.ticker),
  ])).sort();

  const rows = tickers.map((ticker) => {
    const f = fundamental.find((r) => r.ticker === ticker);
    const q = quotes.find((r) => r.symbol === ticker);

    const { score: fScore, sig: fSig } = fundamentalRead(f);
    const { sig: tSig, label: tLabel, caveats: tCaveats } = technicalRead(q);
    const confluence = confluenceRead(fSig, tSig);

    const caveats = [...tCaveats];
    const earnDate = earningsDateFor(bySymbol, ticker, f?.next_earnings_date);
    const earnCaveat = earningsCaveat(earnDate, today);
    if (earnCaveat) caveats.push(earnCaveat);

    return { ticker, fScore, fSig, tSig, tLabel, price: q?.price, rsi: q?.rsi, macd: q?.macd, confluence, caveats, earnDate, soon: isEarningsSoon(earnDate, today) };
  });

  const priority = { "Strong Buy confluence": 0, "Strong Sell confluence": 1, "Conflicting signals": 2, "Neutral / mixed": 3, "Partial data": 4, "No data": 5 };
  rows.sort((a, b) => priority[a.confluence.label] - priority[b.confluence.label]);

  return (
    <>
    <MarketStressBanner />
    <div className="panel">
      <h2>Overview — Signal Confluence</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Fundamental combines institutional 13F breadth and analyst consensus. Technical is the swing setup from the
        Technical Analysis tab: Breakout or Pullback counts as bullish, a downtrend counts as bearish, and an uptrend
        with nothing to enter counts as a hold. RSI is only a warning. P/E, market cap, EPS, and margin stay on the
        Fundamental Screener, where they have the context they need.
        {ready && !session ? " Sign in to include tickers that are only in your portfolio." : ""}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th><th>Next earnings</th><th>Fundamental</th><th>Setup</th><th>Confluence</th>
              <th>Price</th><th>RSI</th><th>MACD</th><th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className={r.soon ? "earn-soon-row" : undefined}>
                <td><strong className={r.soon ? "earn-soon" : undefined}>{r.ticker}</strong></td>
                <td><EarningsDate date={r.earnDate} today={today} /></td>
                <td>{r.fSig ? `${r.fSig}${r.fScore != null ? ` (${r.fScore})` : ""}` : "—"}</td>
                <td>{r.tLabel || "—"}</td>
                <td>
                  <span className="badge" style={{ background: r.confluence.color + "26", color: r.confluence.color }}>
                    {r.confluence.label}
                  </span>
                </td>
                <td>{r.price != null ? Number(r.price).toFixed(2) : "—"}</td>
                <td>{r.rsi != null ? Number(r.rsi).toFixed(1) : "—"}</td>
                <td>{r.macd != null ? Number(r.macd).toFixed(2) : "—"}</td>
                <td className="wrap">{r.caveats.join(" ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty">
            No names yet — add tickers to the Fundamental Screener and/or the watchlist (for live Technical data)
            to see them combined here.
          </div>
        )}
      </div>
    </div>
    </>
  );
}
