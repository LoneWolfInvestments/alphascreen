// src/components/Opportunities.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

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
  if (!q) return { sig: null, rr: null, reasons: [] };
  const reasons = [];
  let score = 0;
  let hasData = false;

  if (q.rsi != null) {
    hasData = true;
    if (q.rsi < 35) { score += 1; reasons.push(`RSI ${Number(q.rsi).toFixed(0)} (oversold)`); }
    else if (q.rsi > 65) { score -= 1; reasons.push(`RSI ${Number(q.rsi).toFixed(0)} (overbought)`); }
  }
  if (q.macd != null) {
    hasData = true;
    score += q.macd > 0 ? 1 : -1;
    reasons.push(q.macd > 0 ? "MACD positive (bullish momentum)" : "MACD negative (bearish momentum)");
  }
  if (q.sma_50 != null && q.sma_200 != null) {
    hasData = true;
    if (q.sma_50 > q.sma_200) { score += 1; reasons.push("50 SMA above 200 SMA (uptrend structure)"); }
    else { score -= 1; reasons.push("50 SMA below 200 SMA (downtrend structure)"); }
  }
  if (q.price != null && q.wma_200 != null) {
    hasData = true;
    if (q.price >= q.wma_200) { score += 1; reasons.push("Price above 200 WMA"); }
    else { score -= 1; reasons.push("Price below 200 WMA"); }
  }
  if (q.price != null && q.donchian_upper != null && q.donchian_lower != null && q.donchian_upper !== q.donchian_lower) {
    hasData = true;
    const pos = (q.price - q.donchian_lower) / (q.donchian_upper - q.donchian_lower);
    if (pos > 0.9) { score += 1; reasons.push("Price near 20-day high (Donchian breakout)"); }
    else if (pos < 0.1) { score -= 1; reasons.push("Price near 20-day low (Donchian breakdown)"); }
  }

  // ADX doesn't add to the directional score — it tells you whether the other
  // signals are trustworthy in the first place. A weak ADX means "Buy"/"Sell"
  // here is a low-conviction read regardless of what RSI/MACD/SMA/Donchian say.
  if (q.adx != null && q.adx < 20) {
    reasons.push(`ADX ${Number(q.adx).toFixed(0)} (weak/no trend — signal less reliable)`);
  } else if (q.adx != null && q.adx >= 25) {
    reasons.push(`ADX ${Number(q.adx).toFixed(0)} (confirmed trending market)`);
  }

  let sig = null;
  if (score >= 3) sig = "Buy";
  else if (score <= -3) sig = "Sell";
  else if (hasData) sig = "Hold";

  // Donchian Channel R:R (real price extremes) replaces the old Bollinger-based
  // approximation, matching the same switch made in Technical Analysis.
  let rr = null;
  if (q.price != null && q.donchian_lower != null && q.donchian_upper != null && q.price !== q.donchian_lower) {
    rr = Math.abs((q.donchian_upper - q.price) / (q.price - q.donchian_lower));
  }
  return { sig, rr, reasons };
}
function earningsReason(dateStr) {
  if (!dateStr) return null;
  const days = Math.round((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0 || days > 14) return null;
  return `Earnings in ${days}d — event risk`;
}

export default function Opportunities() {
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
    loadAll();
    const c1 = supabase.channel("opp-fundamental").on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, loadAll).subscribe();
    const c2 = supabase.channel("opp-quotes").on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, loadAll).subscribe();
    const c3 = supabase.channel("opp-portfolio").on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, loadAll).subscribe();
    return () => { supabase.removeChannel(c1); supabase.removeChannel(c2); supabase.removeChannel(c3); };
  }, [loadAll]);

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
    const { sig: tSig, rr, reasons: tReasons } = technicalRead(q);
    const held = !!p;

    const earnReason = earningsReason(f?.next_earnings_date);

    let category, priority, headline;
    if (!held && fSig === "Buy" && tSig === "Buy") {
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
      ticker, fScore, fSig, tSig, rr, held,
      price: q?.price, category, priority, headline,
      allReasons: [...fReasons, ...tReasons, rr != null ? `R:R ${rr.toFixed(2)}` : null, earnReason].filter(Boolean),
    };
  });

  rows.sort((a, b) => a.priority - b.priority || (b.fScore || 0) - (a.fScore || 0));

  const categories = ["New Buy Candidate", "Add to Existing Position", "Review Position", "Conflicting — Watch", "Neutral / Mixed", "Insufficient Data"];
  const categoryColor = {
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
        Ranks every ticker into an actionable bucket rather than just showing raw numbers. "New Buy Candidate" and
        "Add to Existing" surface where fundamentals and technicals agree bullish. "Review Position" flags names you
        hold that are now showing a bearish signal. This is a triage tool, not a trade instruction — check the reasoning
        column before acting on anything.
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
                  <tr><th>Ticker</th><th>Price</th><th>Fundamental</th><th>Technical</th><th>Why</th></tr>
                </thead>
                <tbody>
                  {catRows.map((r) => (
                    <tr key={r.ticker}>
                      <td><strong>{r.ticker}</strong></td>
                      <td>{r.price != null ? Number(r.price).toFixed(2) : "—"}</td>
                      <td>{r.fSig ? `${r.fSig} (${r.fScore})` : "—"}</td>
                      <td>{r.tSig || "—"}</td>
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
