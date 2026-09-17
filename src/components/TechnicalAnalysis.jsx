// src/components/TechnicalAnalysis.jsx
import React from "react";
import { useWatchlistQuotes } from "../hooks/useWatchlistQuotes";

function computeDerived(q) {
  // Use RSI/MACD/BB from the live indicator job; approximate support/resistance
  // from Bollinger Bands since we don't store a separate support/resistance field.
  const price = q.price;
  const support = q.bb_lower;
  const resistance = q.bb_upper;
  const fib618 = (resistance != null && support != null) ? (resistance - (resistance - support) * 0.618) : null;

  const entry = price;
  const stop = support;
  const target = resistance;
  const rr = (entry != null && stop != null && target != null && entry !== stop)
    ? Math.abs((target - entry) / (entry - stop)) : null;

  let trend = "Neutral";
  if (q.macd != null) trend = q.macd > 0 ? "Uptrend" : "Downtrend";

  return { fib618, entry, stop, target, rr, trend };
}

export default function TechnicalAnalysis() {
  const { quotes, loading, error, lastUpdated, refetch } = useWatchlistQuotes();
  const fmt = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(2);

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
                <th>Ticker</th><th>Price</th><th>Trend</th><th>RSI</th><th>MACD</th>
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
                    <td>{c.trend}</td>
                    <td>{fmt(q.rsi)}</td>
                    <td>{fmt(q.macd)}</td>
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
        Stop/target are approximated from Bollinger Band lower/upper since no separate support/resistance feed is wired in.
        Trend is read off MACD sign. Treat these as rough reference levels, not precision entries.
      </p>
    </div>
  );
}
