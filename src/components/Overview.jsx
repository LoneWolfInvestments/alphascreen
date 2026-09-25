// src/components/Overview.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

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

// ---- Technical side: RSI + MACD + SMA cross + Donchian breakout position ----
function technicalRead(q) {
  if (!q) return { sig: null, caveats: [] };
  let score = 0;
  let hasData = false;
  const caveats = [];

  if (q.rsi != null) {
    hasData = true;
    if (q.rsi < 35) score += 1;
    if (q.rsi > 65) score -= 1;
  }
  if (q.macd != null) {
    hasData = true;
    score += q.macd > 0 ? 1 : -1;
  }
  if (q.sma_50 != null && q.sma_200 != null) {
    hasData = true;
    score += q.sma_50 > q.sma_200 ? 1 : -1;
  }
  if (q.price != null && q.wma_200 != null) {
    hasData = true;
    score += q.price >= q.wma_200 ? 1 : -1;
  }
  if (q.price != null && q.donchian_upper != null && q.donchian_lower != null && q.donchian_upper !== q.donchian_lower) {
    hasData = true;
    const pos = (q.price - q.donchian_lower) / (q.donchian_upper - q.donchian_lower);
    if (pos > 0.9) score += 1;
    else if (pos < 0.1) score -= 1;
  }

  // Caveats — context that changes how much to trust the signal, not the direction itself
  if (q.adx != null) {
    if (q.adx < 20) caveats.push(`ADX ${q.adx.toFixed(0)}: weak trend, lower confidence`);
    else if (q.adx >= 25) caveats.push(`ADX ${q.adx.toFixed(0)}: confirmed trend`);
  }

  if (!hasData) return { sig: null, caveats };
  let sig = "Hold";
  if (score >= 3) sig = "Buy";
  else if (score <= -3) sig = "Sell";
  return { sig, caveats };
}

function earningsCaveat(dateStr) {
  if (!dateStr) return null;
  const days = Math.round((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  if (days < 0 || days > 14) return null;
  return `Earnings in ${days}d`;
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
      supabase.from("portfolio").select("ticker"),
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
    const { sig: tSig, caveats: tCaveats } = technicalRead(q);
    const confluence = confluenceRead(fSig, tSig);

    const caveats = [...tCaveats];
    const earnCaveat = earningsCaveat(f?.next_earnings_date);
    if (earnCaveat) caveats.push(earnCaveat);

    return { ticker, fScore, fSig, tSig, price: q?.price, rsi: q?.rsi, macd: q?.macd, confluence, caveats };
  });

  const priority = { "Strong Buy confluence": 0, "Strong Sell confluence": 1, "Conflicting signals": 2, "Neutral / mixed": 3, "Partial data": 4, "No data": 5 };
  rows.sort((a, b) => priority[a.confluence.label] - priority[b.confluence.label]);

  return (
    <div className="panel">
      <h2>Overview — Signal Confluence</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Fundamental combines institutional 13F breadth and analyst consensus. Technical combines RSI, MACD, 50/200 SMA
        trend, and Donchian breakout position. ADX and upcoming earnings are shown as caveats — they affect how much
        to trust a signal, not its direction. P/E, market cap, EPS, and margin are deliberately left out of the score
        since they need sector/historical context to interpret and would create false precision if forced into it —
        see the Fundamental Screener tab for those directly.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th><th>Fundamental</th><th>Technical</th><th>Confluence</th>
              <th>Price</th><th>RSI</th><th>MACD</th><th>Caveats</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker}>
                <td><strong>{r.ticker}</strong></td>
                <td>{r.fSig ? `${r.fSig}${r.fScore != null ? ` (${r.fScore})` : ""}` : "—"}</td>
                <td>{r.tSig || "—"}</td>
                <td>
                  <span className="badge" style={{ background: r.confluence.color + "26", color: r.confluence.color }}>
                    {r.confluence.label}
                  </span>
                </td>
                <td>{r.price != null ? Number(r.price).toFixed(2) : "—"}</td>
                <td>{r.rsi != null ? Number(r.rsi).toFixed(1) : "—"}</td>
                <td>{r.macd != null ? Number(r.macd).toFixed(2) : "—"}</td>
                <td style={{ fontSize: 12, color: "#8b93a7" }}>{r.caveats.join(" · ") || "—"}</td>
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
