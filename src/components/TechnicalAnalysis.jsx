import React, { useMemo, useState } from "react";
import { useWatchlistQuotes } from "../hooks/useWatchlistQuotes";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { previewSample } from "../lib/previewSample";
import { formatDay, isEarningsSoon, nyToday } from "../lib/sellSignals";
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

export function TechnicalAnalysisView({ rows, sample, barDate, spyClose, earningsBySymbol, today }) {
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
        and held it. RSI does not add a buy. The stop is 2×ATR(14) under the close. At a 1% portfolio risk, position
        size is about 1% divided by the distance to that stop. Anything over 25% of the account is above your single-name cap.
        {barDate ? ` Prices as of ${formatDay(barDate)}.` : ""}
        {spyClose != null ? ` SPY ${usd(spyClose)} is the benchmark and is not listed as a trade.` : " SPY is the benchmark."}
      </p>

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
                <SortHeader label="Setup" sortKey="label" sort={sort} onSort={onSort} />
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
                return (
                  <React.Fragment key={row.symbol}>
                    <tr className={soon ? "earn-soon-row" : undefined}>
                      <td>{row.rsRank == null ? "—" : `${row.rsRank} of ${row.rsCount}`}</td>
                      <td><strong className={soon ? "earn-soon" : undefined}>{row.symbol}</strong></td>
                      <td>{row.label ? <span className={`badge ${setupClass(row.label)}`}>{row.label}</span> : "—"}</td>
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
                      <td colSpan={8}>
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
        The first nightly run stores about 320 trading days (roughly 15 months) for each symbol, plus SPY, using the same
        kind of download as before. Breakouts, pullbacks, stops, and the 3- and 6-month comparison are ready the next
        morning. The 12-month comparison is ready the same morning for any name with at least 252 stored sessions. A
        stock with a shorter history shows a blank there until enough days have been saved, one new session per night
        after that first download. The Sell Signals tab still uses its own exit stop, the 22-day high minus 3×ATR(22),
        now calculated from these saved bars.
      </p>
    </div>
  );
}

export default function TechnicalAnalysis() {
  const sample = previewSample();
  const live = useWatchlistQuotes();
  const { bySymbol } = useEarningsMap();
  const today = nyToday();

  if (sample) {
    const rows = assignRelativeStrengthRanks(SAMPLE.rows);
    return (
      <TechnicalAnalysisView
        rows={rows}
        sample
        barDate={SAMPLE.barDate}
        spyClose={SAMPLE.spyClose}
        earningsBySymbol={bySymbol}
        today={today}
      />
    );
  }

  const rows = assignRelativeStrengthRanks((live.quotes || []).map(viewRowFromQuote).filter(Boolean));
  const dates = [...new Set(rows.map((row) => row.barDate).filter(Boolean))];

  return (
    <div>
      <div className="sync-note" style={{ marginBottom: 8 }}>
        {live.lastUpdated ? `Last refresh ${new Date(live.lastUpdated).toLocaleString()}` : "No refresh yet"}
        {" · "}
        <button className="link-btn" onClick={live.refetch}>refresh</button>
      </div>
      {live.loading && <div className="panel"><h2>Technical Analysis</h2><p>Loading…</p></div>}
      {live.error && <div className="panel"><h2>Technical Analysis</h2><p style={{ color: "var(--red)" }}>{live.error}</p></div>}
      {!live.loading && !live.error && (
        <TechnicalAnalysisView
          rows={rows}
          sample={false}
          barDate={dates.length === 1 ? dates[0] : null}
          spyClose={null}
          earningsBySymbol={bySymbol}
          today={today}
        />
      )}
    </div>
  );
}
