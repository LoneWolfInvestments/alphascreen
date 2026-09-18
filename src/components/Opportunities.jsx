// src/components/Opportunities.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

function fundamentalScore(r) {
  if (!r) return null;
  const sum = Number(r.insider) + Number(r.politician) + Number(r.options_flow) + Number(r.sentiment);
  return Math.round(((sum + 8) / 16) * 100);
}
function fundamentalSignal(score) {
  if (score == null) return null;
  if (score >= 65) return "Buy";
  if (score <= 35) return "Sell";
  return "Hold";
}
function technicalRead(q) {
  if (!q) return { sig: null, rr: null, reason: [] };
  const reasons = [];
  let score = 0;
  if (q.rsi != null) {
    if (q.rsi < 35) { score += 1; reasons.push(`RSI ${Number(q.rsi).toFixed(0)} (oversold)`); }
    else if (q.rsi > 65) { score -= 1; reasons.push(`RSI ${Number(q.rsi).toFixed(0)} (overbought)`); }
  }
  if (q.macd != null) {
    score += q.macd > 0 ? 1 : -1;
    reasons.push(q.macd > 0 ? "MACD positive (bullish momentum)" : "MACD negative (bearish momentum)");
  }
  let sig = null;
  if (score >= 1) sig = "Buy";
  else if (score <= -1) sig = "Sell";
  else if (q.rsi != null || q.macd != null) sig = "Hold";

  let rr = null;
  if (q.price != null && q.bb_lower != null && q.bb_upper != null && q.price !== q.bb_lower) {
    rr = Math.abs((q.bb_upper - q.price) / (q.price - q.bb_lower));
  }
  return { sig, rr, reasons };
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

    const fScore = fundamentalScore(f);
    const fSig = fundamentalSignal(fScore);
    const { sig: tSig, rr, reasons: tReasons } = technicalRead(q);
    const held = !!p;

    const fReasons = [];
    if (f) {
      if (f.insider !== 0) fReasons.push(`Insider ${f.insider > 0 ? "+" : ""}${f.insider} (${f.insider > 0 ? "recent buying" : "recent selling"})`);
      if (f.politician !== 0) fReasons.push(`Politician ${f.politician > 0 ? "+" : ""}${f.politician}`);
      if (f.options_flow !== 0) fReasons.push(`Options flow ${f.options_flow > 0 ? "+" : ""}${f.options_flow}`);
      if (f.sentiment !== 0) fReasons.push(`Sentiment ${f.sentiment > 0 ? "+" : ""}${f.sentiment}`);
    }

    let category, priority, headline;
    if (!held && fSig === "Buy" && tSig === "Buy") {
      category = "New Buy Candidate"; priority = 0;
      headline = "Fundamentals and technicals both bullish, not currently held";
    } else if (held && fSig === "Buy" && tSig === "Buy") {
      category = "Add to Existing Position"; priority = 1;
      headline = `Both signals bullish — currently ${p.weight}% weight, conviction ${p.conviction}/5`;
    } else if (held && (fSig === "Sell" || tSig === "Sell")) {
      category = "Review Position"; priority = 2;
      headline = `Held at ${p.weight}% but showing a bearish signal — worth a closer look`;
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
      ticker, fScore, fSig, tSig, rr, held, weight: p?.weight, conviction: p?.conviction,
      price: q?.price, category, priority, headline,
      allReasons: [...fReasons, ...tReasons, rr != null ? `R:R ${rr.toFixed(2)}` : null].filter(Boolean),
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
