import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { previewSample } from "../lib/previewSample";
import {
  buildSellBook,
  formatDay,
  formatPct,
  formatPrice,
  formatUsd,
  nyToday,
} from "../lib/sellSignals";
import { sampleSellBook } from "../lib/sellSignalsSample";
import EarningsDate from "./EarningsDate";

function indexQuotes(rows) {
  const map = {};
  for (const row of rows || []) map[row.symbol] = row;
  return map;
}

function indexEarnings(calendarRows, scoreRows) {
  const map = {};
  for (const row of scoreRows || []) {
    if (row.next_earnings_date) map[row.ticker] = row.next_earnings_date;
  }
  for (const row of calendarRows || []) {
    map[row.symbol] = row.next_earnings_date || null;
  }
  return map;
}

function distanceLabel(row) {
  if (row.distancePct == null) return "Not calculated yet";
  if (row.distancePct >= 0) return `${formatPct(row.distancePct)} above the stop`;
  return <span style={{ color: "var(--red)" }}>{formatPct(Math.abs(row.distancePct))} through the stop</span>;
}

function pnlLabel(row) {
  if (row.pnlDollars == null) return "—";
  if (row.pnlDollars === 0) return "Flat versus your cost";
  const up = row.pnlDollars > 0;
  return (
    <span style={{ color: up ? "var(--green)" : "var(--red)" }}>
      {up ? "Up" : "Down"} {formatUsd(Math.abs(row.pnlDollars))} ({formatPct(Math.abs(row.pnlPct))})
    </span>
  );
}

export function SellSignalsView({ book, sample, earningsUpdatedAt, drafts, saving, onDraft, onCommit }) {
  const counts = book.counts;
  return (
    <div className="panel">
      <h2>Sell Signals</h2>
      {sample && (
        <div className="sample-banner">
          Sample book for preview. These are not your holdings. On the live site, sign in and this tab reads your Portfolio table.
        </div>
      )}
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        One row per holding. Red means the trailing stop broke (the exit rule). Amber means decide — trim, hedge, or
        wait for earnings — and is not an order to sell everything. “Don’t add” means the short trend is broken; it does
        not mean sell what you already own. Green means none of the checks fired.
        {book.asOf ? ` Prices as of ${formatDay(book.asOf)}.` : ""}
        {book.asOfMixed ? " Price dates differ by holding; each row shows its own as-of date." : ""}
        {earningsUpdatedAt ? ` Earnings dates refreshed ${formatDay(earningsUpdatedAt) || new Date(earningsUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.` : ""}
      </p>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-box"><div className="label">Exit</div><div className="value" style={{ color: "var(--red)" }}>{counts.red}</div></div>
        <div className="stat-box"><div className="label">Decide</div><div className="value" style={{ color: "var(--amber)" }}>{counts.amber}</div></div>
        <div className="stat-box"><div className="label">Don’t add</div><div className="value">{counts.info}</div></div>
        <div className="stat-box"><div className="label">All clear</div><div className="value" style={{ color: "var(--green)" }}>{counts.green}</div></div>
      </div>

      {book.rows.map((row) => {
        const draft = drafts[row.ticker];
        const themeValue = draft ?? row.savedTheme;
        return (
          <article key={row.ticker} className={`sell-row ${row.status}`}>
            <div className="sell-top">
              <span className={`light ${row.status}`}><i /> {row.statusLabel}</span>
              <strong className="sell-ticker">{row.ticker}</strong>
              <label className="theme-edit">
                <span>Theme</span>
                <input
                  className="theme-input"
                  aria-label={`Theme for ${row.ticker}`}
                  value={themeValue}
                  placeholder={row.themeSource === "default" ? row.theme : "Theme"}
                  disabled={sample || !onCommit}
                  onChange={(event) => onDraft(row.ticker, event.target.value)}
                  onBlur={() => onCommit && onCommit(row.ticker, themeValue, row.savedTheme)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
              </label>
              {row.themeSource === "default" && !draft && (
                <span className="sync-note">Using default: {row.theme}</span>
              )}
              {saving === row.ticker && <span className="sync-note">Saving…</span>}
              <span className="sell-price">{formatPrice(row.price)}</span>
              {(!book.asOf || !row.barDate) && (
                <span className="sync-note">{row.barDate ? `as of ${formatDay(row.barDate)}` : "no price date yet"}</span>
              )}
            </div>
            <div className="sell-metrics">
              <div>
                <span className="label">Trailing stop</span>
                <span>{row.stop == null ? "Not calculated yet" : formatPrice(row.stop)}</span>
              </div>
              <div>
                <span className="label">Vs price</span>
                <span>{distanceLabel(row)}</span>
              </div>
              <div>
                <span className="label">If sold at the stop</span>
                <span>{pnlLabel(row)}</span>
              </div>
              <div>
                <span className="label">Next earnings</span>
                <span><EarningsDate date={row.earningsDate} today={book.today} /></span>
              </div>
            </div>
            <div className="why">
              {row.why.map((line) => <p key={line}>{line}</p>)}
            </div>
          </article>
        );
      })}

      <h3>Themes</h3>
      <p className="sync-note" style={{ marginBottom: 8 }}>
        A theme over 40% of the book is amber. One holding over 25% is amber on its own. Blank theme boxes use the
        default group (Uranium, Semis/AI, Big Tech, Software, Healthcare, Space). Type a name and click away to save
        your own. Names left as Unclassified are not grouped into the 40% check.
      </p>
      {book.themes.length === 0 ? (
        <div className="empty">No themed holdings yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Theme</th><th>Holdings</th><th>Value</th><th>Weight</th><th>To get under 40%</th>
              </tr>
            </thead>
            <tbody>
              {book.themes.map((theme) => (
                <tr key={theme.name}>
                  <td><strong>{theme.name}</strong></td>
                  <td>{theme.tickers.join(", ")}</td>
                  <td>{formatUsd(theme.marketValue)}</td>
                  <td style={{ color: theme.over ? "var(--amber)" : undefined }}>{formatPct(theme.weight * 100)}</td>
                  <td>{theme.over ? `Trim about ${formatUsd(theme.trimDollars)}` : "Under the limit"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="disclaimer">
        The trailing stop is the highest high of the last 22 trading days minus 3 × ATR(22). Overextended means RSI(14)
        above 80, or the price 40% or more above the 50-day average. Earnings soon means the next report is within 5
        trading days. Trend broken means two closes in a row under the 50-day average. This matches the daily alert
        checklist. It is a reminder for you, not a broker order.
      </p>
    </div>
  );
}

export default function SellSignals() {
  const sample = previewSample();
  const { ready, session } = useOwnerSession();
  const [book, setBook] = useState(null);
  const [earningsUpdatedAt, setEarningsUpdatedAt] = useState(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    let portfolio = await supabase.from("portfolio").select("ticker, shares, cost_basis, theme").order("ticker");
    if (portfolio.error && /theme/i.test(portfolio.error.message || "")) {
      portfolio = await supabase.from("portfolio").select("ticker, shares, cost_basis").order("ticker");
    }
    if (portfolio.error) {
      setError(portfolio.error.message);
      setBook(null);
      return;
    }

    let quotes = await supabase
      .from("quotes")
      .select("symbol, price, rsi, sma_50, atr_22, high_22, chandelier_stop, below_sma50_streak, bar_date");
    if (quotes.error && /atr_22|high_22|chandelier_stop|below_sma50_streak|bar_date/i.test(quotes.error.message || "")) {
      quotes = await supabase.from("quotes").select("symbol, price, rsi, sma_50");
    }

    const calendar = await supabase.from("earnings_calendar").select("symbol, next_earnings_date, updated_at");
    const scores = await supabase.from("fundamental_scores").select("ticker, next_earnings_date");
    const calendarRows = calendar.error ? [] : (calendar.data || []);
    const latest = calendarRows.reduce(
      (max, row) => (!max || (row.updated_at && row.updated_at > max) ? row.updated_at : max),
      null
    );

    setEarningsUpdatedAt(latest);
    setBook(buildSellBook({
      holdings: portfolio.data || [],
      quotesBySymbol: indexQuotes(quotes.data || []),
      earningsBySymbol: indexEarnings(calendarRows, scores.data || []),
      today: nyToday(),
    }));
    setError("");
  }, []);

  useEffect(() => {
    if (sample || !ready || !session) return undefined;
    load();
    const channel = supabase
      .channel(`sell-signals-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "portfolio" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "earnings_calendar" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, ready, sample, session]);

  const onDraft = (ticker, value) => setDrafts((current) => ({ ...current, [ticker]: value }));

  const onCommit = async (ticker, value, saved) => {
    const next = String(value || "").trim();
    const previous = String(saved || "").trim();
    if (next === previous) {
      setDrafts((current) => {
        const copy = { ...current };
        delete copy[ticker];
        return copy;
      });
      return;
    }
    setSaving(ticker);
    const { error: saveError } = await supabase.from("portfolio").update({
      theme: next || null,
      updated_at: new Date().toISOString(),
    }).eq("ticker", ticker);
    setSaving("");
    if (saveError) {
      const missing = /theme/i.test(saveError.message || "");
      alert(missing
        ? "Theme could not be saved yet. In Supabase, open the SQL Editor and run schema-sell-signals.sql, then try again."
        : `Could not save that theme. ${saveError.message || ""}`);
      return;
    }
    setDrafts((current) => {
      const copy = { ...current };
      delete copy[ticker];
      return copy;
    });
    load();
  };

  if (sample) {
    return (
      <SellSignalsView
        book={sampleSellBook()}
        sample
        earningsUpdatedAt="2026-10-30"
        drafts={{}}
        saving=""
        onDraft={() => {}}
        onCommit={null}
      />
    );
  }

  if (!ready) {
    return <div className="panel"><h2>Sell Signals</h2><p>Loading…</p></div>;
  }

  if (!session) {
    return (
      <div className="panel">
        <h2>Sell Signals</h2>
        <div className="empty">Sign in at the top of the page to see sell signals for your holdings.</div>
      </div>
    );
  }

  if (error) {
    return <div className="panel"><h2>Sell Signals</h2><p style={{ color: "var(--red)" }}>{error}</p></div>;
  }

  if (!book) {
    return <div className="panel"><h2>Sell Signals</h2><p>Loading…</p></div>;
  }

  if (book.rows.length === 0) {
    return (
      <div className="panel">
        <h2>Sell Signals</h2>
        <div className="empty">No holdings yet. Add them on the Portfolio Allocation tab. This list is read from that table.</div>
      </div>
    );
  }

  return (
    <SellSignalsView
      book={book}
      sample={false}
      earningsUpdatedAt={earningsUpdatedAt}
      drafts={drafts}
      saving={saving}
      onDraft={onDraft}
      onCommit={onCommit}
    />
  );
}
