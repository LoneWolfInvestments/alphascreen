// src/components/Opportunities.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { blocksNewBuy, isEarningsSoon, nyToday, tradingDaysUntil } from "../lib/sellSignals";
import { technicalReadFromQuote } from "../lib/swingSetups";

function fundamentalRead(f) {
  if (!f) return { score: null, sig: null, reasons: [] };
  const hasBreadth = f.inst_net_breadth != null;
  const hasAnalyst = !!f.analyst_rating;
  if (!hasBreadth && !hasAnalyst) return { score: null, sig: null, reasons: [] };

  const reasons = [];
  if (hasBreadth) reasons.push(`Institutional breadth ${f.inst_net_breadth > 0 ? "+" : ""}${f.inst_net_breadth.toFixed(1)}% (${f.inst_buyers} buyers vs ${f.inst_sellers} sellers)`);
  if (hasAnalyst) reasons.push(`Analyst consensus: ${f.analyst_rating}`);

  const breadthPoints = hasBreadth ? f.inst_net_breadth / 50 : 0;
  const analystPoints = f.analyst_rating === "Buy" ? 1 : f.analyst_rating === "Sell" ? -1 : 0;
  const inputs = (hasBreadth ? 1 : 0) + (hasAnalyst ? 1 : 0);
  const combined = (breadthPoints + analystPoints) / inputs;

  const score = hasBreadth ? Math.round(50 + f.inst_net_breadth) : null;
  let sig = "Hold";
  if (combined > 0.3) sig = "Buy";
  else if (combined < -0.3) sig = "Sell";
  return { score, sig, reasons };
}
function technicalRead(q) {
  const read = technicalReadFromQuote(q);
  return { sig: read.sig, label: read.label, reasons: read.reasons };
}
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
  const [fundamental, setFundamental] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [portfolio, setPortfolio] = useState([]);

  const loadAll = useCallback(async () => {
    const [f, q, p] = await Promise.all([
      supabase.from("fundamental_scores").select("*"),
      supabase.from("quotes").select("*"),
      supabase.from("portfolio").select("*"),
    ]);
    setFundamental(f.data || []);
    setQuotes(q.data || []);
    setPortfolio(p.data || []);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    loadAll();
    const c1 = supabase.channel("opp-fundamental").on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, loadAll).subscribe();
    const c2 = supabase.channel("opp-quotes").on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, loadAll).subscribe();
    const c3 = supabase.channel("opp-portfolio").on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, loadAll).subscribe();
    return () => { supabase.removeChannel(c1); supabase.removeChannel(c2); supabase.removeChannel(c3); };
  }, [loadAll, ready, session?.user?.id]);

  const tickers = Array.from(new Set([
    ...fundamental.map((r) => r.ticker),
    ...quotes.map((r) => r.symbol),
    ...portfolio.map((r) => r.ticker),
  ]));

  const rows = tickers.map((ticker) => {
    const f = fundamental.find((r) => r.ticker === ticker);
    const q = quotes.find((r) => r.symbol === ticker);
    const p = portfolio.find((r) => r.ticker === ticker);

    const { score: fScore, sig: fSig, reasons: fReasons } = fundamentalRead(f);
    const { sig: tSig, label: tLabel, reasons: tReasons } = technicalRead(q);
    const held = !!p;

    const earnDate = earningsDateFor(bySymbol, ticker, f?.next_earnings_date);
    const soon = isEarningsSoon(earnDate, today);
    const earnReason = earningsReason(earnDate, today);

    let category, priority, headline;
    if (blocksNewBuy({ held, fundamentalSignal: fSig, technicalSignal: tSig, earningsSoon: soon })) {
      category = "Earnings soon — skip new buy"; priority = 0;
      headline = "Reporting within 5 trading days, so it stays off the new-buy list until after the report.";
    } else if (!held && fSig === "Buy" && tSig === "Buy") {
      category = "New Buy Candidate"; priority = 0;
      headline = "Fundamentals and technicals both bullish, not currently held";
    } else if (held && fSig === "Buy" && tSig === "Buy") {
      category = "Add to Existing Position"; priority = 1;
      headline = "Already held — both signals bullish, worth considering adding";
    } else if (held && (fSig === "Sell" || tSig === "Sell")) {
      category = "Review Position"; priority = 2;
      headline = "Currently held but showing a bearish signal — worth a closer look";
    } else if (fSig && tSig && fSig !== tSig && fSig !== "Hold" && tSig !== "Hold") {
      category = "Conflicting — Watch"; priority = 3;
      headline = `Fundamental says ${fSig}, technical says ${tSig} — disagreement itself is informative`;
    } else if (fSig || tSig) {
      category = "Neutral / Mixed"; priority = 4;
      headline = "No strong signal either way right now";
    } else {
      category = "Insufficient Data"; priority = 5;
      headline = "Add fundamental scores and/or ensure it's in the live watchlist";
    }

    return {
      ticker, fScore, fSig, tSig, tLabel, held, soon,
      price: q?.price, category, priority, headline,
      allReasons: [...fReasons, ...tReasons, earnReason].filter(Boolean),
    };
  });

  rows.sort((a, b) => a.priority - b.priority || (b.fScore || 0) - (a.fScore || 0));

  const categories = ["Earnings soon — skip new buy", "New Buy Candidate", "Add to Existing Position", "Review Position", "Conflicting — Watch", "Neutral / Mixed", "Insufficient Data"];
  const categoryColor = {
    "Earnings soon — skip new buy": "#f0b955",
    "New Buy Candidate": "#3ecf8e",
    "Add to Existing Position": "#4f8dfd",
    "Review Position": "#f0555a",
    "Conflicting — Watch": "#f0b955",
    "Neutral / Mixed": "#8b93a7",
    "Insufficient Data": "#8b93a7",
  };

  return (
    <div className="panel">
      <h2>Opportunities</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Ranks every ticker into an actionable bucket. A technical Buy is a Breakout or a Pullback in an uptrend,
        not a low RSI. Names reporting within 5 trading days are pulled out of the new-buy list. "Review Position"
        flags names you hold that are now in a downtrend. This is a triage tool, not a trade instruction — read the
        reason before acting.
        {ready && !session ? " Sign in so positions you already hold are marked as held." : ""}
      </p>

      {categories.map((cat) => {
        const catRows = rows.filter((r) => r.category === cat);
        if (catRows.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 20 }}>
            <h3 style={{ color: categoryColor[cat] }}>{cat} ({catRows.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Ticker</th><th>Price</th><th>Fundamental</th><th>Setup</th><th>Why</th></tr>
                </thead>
                <tbody>
                  {catRows.map((r) => (
                    <tr key={r.ticker}>
                      <td><strong className={r.soon ? "earn-soon" : undefined}>{r.ticker}</strong></td>
                      <td>{r.price != null ? Number(r.price).toFixed(2) : "—"}</td>
                      <td>{r.fSig ? `${r.fSig} (${r.fScore})` : "—"}</td>
                      <td>{r.tLabel || "—"}</td>
                      <td style={{ whiteSpace: "normal", fontSize: 12 }}>
                        {r.headline}
                        {r.allReasons.length > 0 && (
                          <div style={{ color: "#8b93a7", marginTop: 2 }}>{r.allReasons.join(" · ")}</div>
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
