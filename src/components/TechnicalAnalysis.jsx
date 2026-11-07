import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useWatchlistQuotes } from "../hooks/useWatchlistQuotes";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { previewSample } from "../lib/previewSample";
import { buildDecisionRows } from "../lib/decisionBook";
import { sampleHoldings, sampleQuotesBySymbol, sampleScreenerRows } from "../lib/sellSignalsSample";
import { sampleMarketStressRows } from "../lib/marketStressSample";
import { formatDay, isEarningsSoon, nyToday } from "../lib/sellSignals";
import { TIMING_NOTE, sessionsBehind } from "../lib/sessionClock";
import { buildSwingSample } from "../lib/swingSample";
import {
  BENCHMARK_SYMBOL,
  SETUP_ORDER,
  assignRelativeStrengthRanks,
  formatRiskPct,
  formatRs,
  formatSize,
  usd,
  viewRowFromQuote,
} from "../lib/swingSetups";
import EarningsDate from "./EarningsDate";

const SAMPLE = buildSwingSample();

const ENTRY_LABELS = new Set(["Breakout", "Pullback", "Uptrend-no-trigger"]);

function setupClass(label) {
  if (label === "Breakout") return "setup-breakout";
  if (label === "Pullback") return "setup-pullback";
  if (label === "Uptrend-no-trigger") return "setup-uptrend";
  if (label === "Avoid-downtrend") return "setup-avoid";
  return "setup-thin";
}

function sortValue(row, key) {
  if (key === "label") return SETUP_ORDER[row.label] ?? 9;
  if (key === "symbol") return row.symbol || "";
  if (key === "riskPct" && !ENTRY_LABELS.has(row.label)) return null;
  return row[key];
}

function sortRows(rows, sort) {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    const aMissing = av == null || av === "";
    const bMissing = bv == null || bv === "";
    if (aMissing && bMissing) return String(a.symbol).localeCompare(String(b.symbol));
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sign;
    if (av === bv) return String(a.symbol).localeCompare(String(b.symbol));
    return av < bv ? -sign : sign;
  });
}

function SortHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  const arrow = !active ? "" : sort.dir === "asc" ? " ↑" : " ↓";
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={active ? "sort-btn active" : "sort-btn"} onClick={() => onSort(sortKey)}>
        {label}{arrow}
      </button>
    </th>
  );
}

export function TechnicalAnalysisView({ rows, decisions = new Map(), sample, barDate, barDatesMixed, downloadedAt, spyClose, earningsBySymbol, today, now = new Date() }) {
  const [sort, setSort] = useState({ key: "rsRank", dir: "asc" });
  const onSort = (key) => {
    setSort((current) => {
      if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      const dir = key === "symbol" || key === "rsRank" || key === "label" ? "asc" : "desc";
      return { key, dir };
    });
  };

  const visible = useMemo(
    () => sortRows(rows.filter((row) => row.symbol !== BENCHMARK_SYMBOL && row.label !== "Benchmark"), sort),
    [rows, sort]
  );
  const counts = visible.reduce((acc, row) => {
    acc[row.label || "Not ready"] = (acc[row.label || "Not ready"] || 0) + 1;
    return acc;
  }, {});
  const waiting = visible.length > 0 && visible.every((row) => !row.label);
  const notCurrent = visible.filter((row) => row.label && sessionsBehind(row.barDate, now).state !== "fresh").length;

  return (
    <div className="panel">
      <h2>Technical Analysis</h2>
      {sample && (
        <div className="sample-banner">
          Sample prices for preview, so you can see how a breakout, a pullback, an uptrend, and a downtrend read. These are not live quotes.
        </div>
      )}
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Sorted by relative strength. Rank 1 has beaten SPY by the most over the last 3, 6, and 12 months.
        A long is only considered when price is above a rising 50-day average and that 50-day is above the 200-day.
        Breakout means the close cleared the highest high of the 20 days before that day, on volume above both the
        20-day and 50-day average, within the last 5 sessions. Pullback means price tagged the rising 20-day or 50-day
        and held it. The decision column is the same one as Signals. Breakout and Pullback are the price pattern, not a separate buy. RSI does not add a buy. The stop is 2×ATR(14) under the close. At a 1% portfolio risk, position
        size is about 1% divided by the distance to that stop. Anything over 25% of the account is above your single-name cap.
        {barDate ? ` Newest price session ${formatDay(barDate)}.` : ""}
        {barDatesMixed ? " Price sessions differ by symbol, so each setup is only as current as its own session." : ""}
        {downloadedAt ? ` Last download ${new Date(downloadedAt).toLocaleString()}, which is not a new session.` : ""}
        {spyClose != null ? ` SPY ${usd(spyClose)} is the benchmark and is not listed as a trade.` : " SPY is the benchmark."}
      </p>

      {notCurrent > 0 && (
        <div className="sample-banner">
          {notCurrent} saved setup{notCurrent === 1 ? "" : "s"} {notCurrent === 1 ? "is" : "are"} behind the latest completed session. Those badges say “not current” and are not entries or exits today.
        </div>
      )}

      {waiting && (
        <div className="sample-banner">
          Setups are not saved yet. In Supabase, open the SQL Editor and run schema-daily-bars.sql. The next weekday night fills them in from the price download the app already makes.
        </div>
      )}

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-box"><div className="label">Breakout</div><div className="value" style={{ color: "var(--green)" }}>{counts.Breakout || 0}</div></div>
        <div className="stat-box"><div className="label">Pullback</div><div className="value" style={{ color: "var(--accent)" }}>{counts.Pullback || 0}</div></div>
        <div className="stat-box"><div className="label">Uptrend, no entry</div><div className="value">{counts["Uptrend-no-trigger"] || 0}</div></div>
        <div className="stat-box"><div className="label">Avoid</div><div className="value" style={{ color: "var(--red)" }}>{counts["Avoid-downtrend"] || 0}</div></div>
      </div>

      {visible.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortHeader label="RS rank" sortKey="rsRank" sort={sort} onSort={onSort} />
                <SortHeader label="Ticker" sortKey="symbol" sort={sort} onSort={onSort} />
                <th>Decision</th>
                <SortHeader label="Setup evidence" sortKey="label" sort={sort} onSort={onSort} />
                <SortHeader label="Price" sortKey="price" sort={sort} onSort={onSort} />
                <th>Stop</th>
                <SortHeader label="Risk" sortKey="riskPct" sort={sort} onSort={onSort} />
                <th>Size at 1% risk</th>
                <th>Vs SPY</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const earningsDate = earningsDateFor(earningsBySymbol, row.symbol, null);
                const soon = isEarningsSoon(earningsDate, today);
                const showStop = ENTRY_LABELS.has(row.label);
                const fresh = sessionsBehind(row.barDate, now).state === "fresh";
                const badgeText = !row.label ? null : fresh ? row.label : `${row.label} (not current)`;
                return (
                  <React.Fragment key={row.symbol}>
                    <tr className={soon ? "earn-soon-row" : undefined}>
                      <td>{row.rsRank == null ? "—" : `${row.rsRank} of ${row.rsCount}`}</td>
                      <td><strong className={soon ? "earn-soon" : undefined}>{row.symbol}</strong></td>
                      <td>{decisions.get(row.symbol)?.assessment || "—"}</td>
                      <td>{badgeText ? <span className={`badge ${fresh ? setupClass(row.label) : "setup-thin"}`}>{badgeText}</span> : "—"}</td>
                      <td>{usd(row.price)}</td>
                      <td>{showStop ? usd(row.stop) : "—"}</td>
                      <td>{showStop ? formatRiskPct(row.riskPct) : "—"}</td>
                      <td>{showStop ? formatSize(row.riskPct) : "—"}</td>
                      <td className="rs-cell">
                        3m {formatRs(row.rs3m)}
                        <span> · </span>
                        6m {formatRs(row.rs6m)}
                        <span> · </span>
                        12m {formatRs(row.rs12m)}
                      </td>
                    </tr>
                    <tr className="reason-row">
                      <td colSpan={9}>
                        {row.reason || "—"}
                        {earningsDate && (
                          <div className="reason-earn">
                            Next earnings <EarningsDate date={earningsDate} today={today} />
                          </div>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length === 0 && (
        <div className="empty">No quotes yet. Add symbols to the watchlist, run schema-daily-bars.sql, and let the nightly job run once.</div>
      )}

      <p className="disclaimer">
        {TIMING_NOTE} The setup’s suggested stop is 2×ATR(14) under the close, for sizing an entry. The Sell tab uses a different trailing stop, the 22-day high minus 3×ATR(22). They are not averaged.
        The first nightly run stores about 320 trading days (roughly 15 months) for each symbol, plus SPY, using the same
        kind of download as before. Breakouts, pullbacks, stops, and the 3- and 6-month comparison are ready the next
        morning. The 12-month comparison is ready the same morning for any name with at least 252 stored sessions. A
        stock with a shorter history shows a blank there until enough days have been saved, one new session per night
        after that first download.
      </p>
    </div>
  );
}

export default function TechnicalAnalysis() {
  const sample = previewSample();
  const live = useWatchlistQuotes();
  const { ready, session } = useOwnerSession();
  const { bySymbol } = useEarningsMap();
  const today = sample ? "2026-10-30" : nyToday();
  const [extra, setExtra] = useState({ fundamentals: [], stress: null, holdings: [], holdingsKnown: false });

  useEffect(() => {
    if (sample || !ready) return undefined;
    const userId = session?.user?.id || null;
    let cancelled = false;
    setExtra({ fundamentals: [], stress: null, holdings: [], holdingsKnown: false });
    Promise.all([
      supabase.from("fundamental_scores").select("*"),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
      userId ? supabase.from("portfolio").select("ticker, shares, cost_basis, theme") : Promise.resolve({ data: [], error: null }),
    ]).then(([fundamentals, stress, portfolio]) => {
      if (cancelled) return;
      setExtra({
        fundamentals: fundamentals.data || [],
        stress: stress.error ? null : (stress.data || [])[0] || null,
        holdings: portfolio.error ? [] : (portfolio.data || []),
        holdingsKnown: Boolean(userId) && !portfolio.error,
      });
    });
    return () => { cancelled = true; };
  }, [ready, sample, session?.user?.id]);

  const sampleNow = new Date("2026-10-30T17:00:00Z");
  const decisions = useMemo(() => {
    if (sample) {
      return buildDecisionRows({
        quotes: Object.entries(sampleQuotesBySymbol()).map(([symbol, quote]) => ({ symbol, ...quote })),
        views: SAMPLE.rows,
        fundamentals: sampleScreenerRows(),
        holdings: sampleHoldings(),
        holdingsKnown: true,
        stress: sampleMarketStressRows().at(-1),
        earningsBySymbol: bySymbol,
        now: sampleNow,
        today,
      }).byTicker;
    }
    return buildDecisionRows({
      quotes: live.quotes || [],
      fundamentals: extra.fundamentals,
      holdings: extra.holdings,
      holdingsKnown: extra.holdingsKnown,
      stress: extra.stress,
      earningsBySymbol: bySymbol,
      now: new Date(),
      today,
    }).byTicker;
  }, [bySymbol, extra, live.quotes, sample, today]);

  if (sample) {
    const rows = assignRelativeStrengthRanks(SAMPLE.rows);
    return (
      <TechnicalAnalysisView
        rows={rows}
        decisions={decisions}
        sample
        barDate={SAMPLE.barDate}
        spyClose={SAMPLE.spyClose}
        earningsBySymbol={bySymbol}
        today={today}
        now={sampleNow}
      />
    );
  }

  const rows = assignRelativeStrengthRanks((live.quotes || []).map(viewRowFromQuote).filter(Boolean));
  const dates = [...new Set(rows.map((row) => row.barDate).filter(Boolean))];

  return (
    <div>
      <div className="sync-note" style={{ marginBottom: 8 }}>
        {live.lastUpdated ? `Downloaded ${new Date(live.lastUpdated).toLocaleString()}` : "No download yet"}
        {" · "}
        <button className="link-btn" onClick={live.refetch}>refresh</button>
      </div>
      {live.loading && <div className="panel"><h2>Technical Analysis</h2><p>Loading…</p></div>}
      {live.error && <div className="panel"><h2>Technical Analysis</h2><p style={{ color: "var(--red)" }}>{live.error}</p></div>}
      {!live.loading && !live.error && (
        <TechnicalAnalysisView
          rows={rows}
          decisions={decisions}
          sample={false}
          barDate={dates.length === 1 ? dates[0] : null}
          barDatesMixed={dates.length > 1}
          downloadedAt={live.lastUpdated}
          spyClose={null}
          earningsBySymbol={bySymbol}
          today={today}
          now={new Date()}
        />
      )}
    </div>
  );
}
