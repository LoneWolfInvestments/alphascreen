// src/components/Overview.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

function fundamentalScore(r) {
  if (!r || r.inst_net_breadth == null) return null;
  // Map breadth (-100%..+100%, though realistically usually within ±30%) onto
  // the same 0-100 display scale used elsewhere, centered at 50.
  return Math.round(50 + r.inst_net_breadth);
}
function fundamentalSignal(score) {
  if (score == null) return null;
  if (score >= 65) return "Buy";
  if (score <= 35) return "Sell";
  return "Hold";
}

function technicalSignal(q) {
  if (!q) return null;
  let score = 0;
  let hasData = false;
  if (q.rsi != null) {
    hasData = true;
    if (q.rsi < 35) score += 1;
    if (q.rsi > 65) score -= 1;
  }
  if (q.macd != null) {
    hasData = true;
    score += q.macd > 0 ? 1 : -1;
  }
  if (!hasData) return null;
  if (score >= 1) return "Buy";
  if (score <= -1) return "Sell";
  return "Hold";
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
    const c1 = supabase.channel("overview-fundamental").on("postgres_changes", { event: "*", schema: "public", table: "fundamental_scores" }, loadAll).subscribe();
    const c2 = supabase.channel("overview-quotes").on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, loadAll).subscribe();
    const c3 = supabase.channel("overview-portfolio").on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, loadAll).subscribe();
    return () => { supabase.removeChannel(c1); supabase.removeChannel(c2); supabase.removeChannel(c3); };
  }, [loadAll]);

  // Union of every ticker mentioned anywhere across the three tables
  const tickers = Array.from(new Set([
    ...fundamental.map((r) => r.ticker),
    ...quotes.map((r) => r.symbol),
    ...portfolio.map((r) => r.ticker),
  ])).sort();

  const rows = tickers.map((ticker) => {
    const f = fundamental.find((r) => r.ticker === ticker);
    const q = quotes.find((r) => r.symbol === ticker);
    const p = portfolio.find((r) => r.ticker === ticker);

    const fScore = fundamentalScore(f);
    const fSig = fundamentalSignal(fScore);
    const tSig = technicalSignal(q);
    const confluence = confluenceRead(fSig, tSig);

    return { ticker, fScore, fSig, tSig, price: q?.price, rsi: q?.rsi, macd: q?.macd, weight: p?.weight, conviction: p?.conviction, confluence };
  });

  // Sort strongest confluence signals to the top
  const priority = { "Strong Buy confluence": 0, "Strong Sell confluence": 1, "Conflicting signals": 2, "Neutral / mixed": 3, "Partial data": 4, "No data": 5 };
  rows.sort((a, b) => priority[a.confluence.label] - priority[b.confluence.label]);

  return (
    <div className="panel">
      <h2>Overview — Signal Confluence</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Combines Fundamental Screener and Technical Analysis into one read per ticker. A name flagged in both
        tabs the same direction is a stronger signal than either alone — that's the confluence idea. Portfolio
        weight/conviction shown for context, not part of the confluence calculation itself.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th><th>Fundamental</th><th>Technical</th><th>Confluence</th>
              <th>Price</th><th>RSI</th><th>MACD</th><th>Portfolio Wt</th><th>Conviction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker}>
                <td><strong>{r.ticker}</strong></td>
                <td>{r.fSig ? `${r.fSig} (${r.fScore})` : "—"}</td>
                <td>{r.tSig || "—"}</td>
                <td>
                  <span className="badge" style={{ background: r.confluence.color + "26", color: r.confluence.color }}>
                    {r.confluence.label}
                  </span>
                </td>
                <td>{r.price != null ? Number(r.price).toFixed(2) : "—"}</td>
                <td>{r.rsi != null ? Number(r.rsi).toFixed(1) : "—"}</td>
                <td>{r.macd != null ? Number(r.macd).toFixed(2) : "—"}</td>
                <td>{r.weight != null ? `${r.weight}%` : "—"}</td>
                <td>{r.conviction != null ? "*".repeat(r.conviction) : "—"}</td>
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
  );
}
