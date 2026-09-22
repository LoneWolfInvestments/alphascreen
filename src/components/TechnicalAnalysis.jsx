// src/components/TechnicalAnalysis.jsx
import React from "react";
import { useWatchlistQuotes } from "../hooks/useWatchlistQuotes";

function computeDerived(q) {
  // Donchian Channels (actual price extremes over 20 days) are a more honest
  // stop/target reference than the Bollinger Band approximation used before.
  const price = q.price;
  const support = q.donchian_lower;
  const resistance = q.donchian_upper;
  const fib618 = (resistance != null && support != null) ? (resistance - (resistance - support) * 0.618) : null;

  const entry = price;
  const stop = support;
  const target = resistance;
  const rr = (entry != null && stop != null && target != null && entry !== stop)
    ? Math.abs((target - entry) / (entry - stop)) : null;

  // Trend now confirmed by SMA50 vs SMA200 (classic golden/death cross read),
  // with MACD sign as momentum context alongside it.
  let trend = "Neutral";
  if (q.sma_50 != null && q.sma_200 != null) {
    trend = q.sma_50 > q.sma_200 ? "Uptrend" : "Downtrend";
  } else if (q.macd != null) {
    trend = q.macd > 0 ? "Uptrend" : "Downtrend";
  }

  return { fib618, entry, stop, target, rr, trend };
}

export default function TechnicalAnalysis() {
  const { quotes, loading, error, lastUpdated, refetch } = useWatchlistQuotes();
  const fmt = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(2);
  const fmtVol = (n) => (n == null ? "—" : Number(n).toLocaleString());

  return (
    <div className="panel">
      <h2>Technical Snapshot (live)</h2>
      <div className="sync-note" style={{ marginBottom: 12 }}>
        {lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleString()}` : "No data yet"}
        {"  ·  "}
        <button className="link-btn" onClick={refetch}>refresh</button>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "#f0555a" }}>Error: {error}</p>}

      {!loading && quotes.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticker</th><th>Price</th><th>Volume</th><th>50 SMA</th><th>200 SMA</th>
                <th>Trend</th><th>RSI</th><th>ADX</th><th>MACD</th><th>ATR</th>
                <th>Donchian Up</th><th>Donchian Low</th>
                <th>Fib 0.618</th><th>Entry</th><th>Stop</th><th>Target</th><th>R:R</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const c = computeDerived(q);
                return (
                  <tr key={q.symbol}>
                    <td><strong>{q.symbol}</strong></td>
                    <td>{fmt(q.price)}</td>
                    <td>{fmtVol(q.volume)}</td>
                    <td>{fmt(q.sma_50)}</td>
                    <td>{fmt(q.sma_200)}</td>
                    <td>{c.trend}</td>
                    <td>{fmt(q.rsi)}</td>
                    <td>{fmt(q.adx)}</td>
                    <td>{fmt(q.macd)}</td>
                    <td>{fmt(q.atr)}</td>
                    <td>{fmt(q.donchian_upper)}</td>
                    <td>{fmt(q.donchian_lower)}</td>
                    <td>{fmt(c.fib618)}</td>
                    <td>{fmt(c.entry)}</td>
                    <td>{fmt(c.stop)}</td>
                    <td>{fmt(c.target)}</td>
                    <td>{c.rr == null ? "—" : c.rr.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && quotes.length === 0 && (
        <div className="empty">No quotes yet — add symbols to the watchlist table in Supabase and trigger a refresh.</div>
      )}
      <p className="disclaimer">
        Trend reads 50 SMA vs 200 SMA (falls back to MACD sign if SMAs aren't available yet, e.g. right after adding
        a new symbol before 200 days of history accumulate). Stop/Target use the 20-day Donchian Channel — actual
        recent price extremes, not a statistical band. ADX above ~25 generally signals a genuinely trending market;
        below that, MACD/RSI signals are less reliable since there's no strong trend to confirm them. ATR is in the
        same units as price — a useful reference for how far a stop should realistically sit given normal volatility.
      </p>
    </div>
  );
}
