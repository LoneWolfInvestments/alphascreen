import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { formatDay } from "../lib/sellSignals";
import { presentRegime, regimeLabel, ratioTone } from "../lib/marketStress";
import { TIMING_NOTE } from "../lib/sessionClock";
import { sampleMarketStressRows } from "../lib/marketStressSample";

const SPROTT_URANIUM_URL = "https://sprott.com/investment-strategies/exchange-listed-products/physical-commodity-funds/uranium/";

function useMarketStress() {
  const sample = previewSample();
  const [rows, setRows] = useState(() => (sample ? sampleMarketStressRows() : []));
  const [loaded, setLoaded] = useState(sample);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (sample) return undefined;
    let cancelled = false;
    (async () => {
      const { data, error: queryError } = await supabase
        .from("market_stress")
        .select("*")
        .order("as_of", { ascending: false })
        .limit(30);
      if (cancelled) return;
      if (queryError) setError(queryError.message || "Could not load market stress");
      else setRows(data || []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sample]);

  const ordered = [...rows].sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : 0));
  return { sample, rows: ordered, latest: ordered.at(-1) || null, loaded, error };
}

const SAMPLE_CLOCK = new Date("2026-10-30T17:00:00Z");

function whenDownloaded(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function Light({ regime, large }) {
  return (
    <span className={`light ${large ? "lg" : ""} ${regime || "nodata"}`}>
      <i />
      {regimeLabel(regime)}
    </span>
  );
}

function num(value, places) {
  if (value == null || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toFixed(places);
}

function spyParts(row) {
  if (row.spy_close == null || row.spy_sma200 == null) return { text: "Not in yet", slope: null };
  const side = row.spy_above_sma200 ? "above" : "at or below";
  const slope = row.spy_sma200_rising == null
    ? null
    : row.spy_sma200_rising
      ? "Average rising"
      : "Average flat or falling";
  return { text: `${num(row.spy_close, 2)} is ${side} ${num(row.spy_sma200, 2)}`, slope };
}

function spyLine(row) {
  const parts = spyParts(row);
  if (!parts.slope) return parts.text;
  return `${parts.text}, ${parts.slope.toLowerCase()}`;
}

function breadthLine(row) {
  if (row.breadth_pct == null || row.breadth_total == null) return "Not in yet";
  return `${Math.round(Number(row.breadth_pct))}% (${row.breadth_above} of ${row.breadth_total})`;
}

function Sparkline({ rows }) {
  const values = rows.map((row) => Number(row.vix)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 300;
  const height = 56;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="VIX close over the stored days">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
    </svg>
  );
}

function Reading({ row, presentation }) {
  const tone = ratioTone(row.vix_ratio);
  const spy = spyParts(row);
  return (
    <>
      <div className="stress-hero">
        <Light regime={presentation.regime} large />
        <div>
          <p className="stress-reason">{presentation.state === "fresh" ? row.reason : presentation.headline}</p>
          <p className="sync-note">
            Market session {formatDay(presentation.asOf) || presentation.asOf}.
            {presentation.spyBarDate && presentation.spyBarDate !== presentation.asOf ? ` SPY session ${formatDay(presentation.spyBarDate)}.` : ""}
            {whenDownloaded(presentation.fetchedAt) ? ` Downloaded ${whenDownloaded(presentation.fetchedAt)}.` : ""}
            {" "}The download time is not a new session.
          </p>
        </div>
      </div>
      <div className="grid-stats">
        <div className="stat-box">
          <div className="label">VIX</div>
          <div className="value">{num(row.vix, 1)}</div>
        </div>
        <div className="stat-box">
          <div className="label">VIX / VIX3M</div>
          <div className="value">{num(row.vix_ratio, 2)}</div>
          {tone ? <div className="sync-note">{tone}</div> : null}
        </div>
        <div className="stat-box">
          <div className="label">SKEW</div>
          <div className="value">{num(row.skew, 0)}</div>
        </div>
        <div className="stat-box">
          <div className="label">SPY vs 200-day</div>
          <div className="value stress-stat">{spy.text}</div>
          {spy.slope ? <div className="sync-note">{spy.slope}</div> : null}
        </div>
        <div className="stat-box">
          <div className="label">Watchlist above 200-day</div>
          <div className="value stress-stat">{breadthLine(row)}</div>
        </div>
      </div>
    </>
  );
}

function clockFor(sample) {
  return sample ? SAMPLE_CLOCK : new Date();
}

export function MarketStressBanner() {
  const { sample, latest, loaded, error } = useMarketStress();
  const presentation = latest ? presentRegime(latest, clockFor(sample)) : null;
  return (
    <div className="panel">
      <h2>Market regime</h2>
      {sample ? <div className="sample-banner">Sample market reading for preview. Not live data.</div> : null}
      {!loaded && <div className="empty">Loading the latest reading...</div>}
      {loaded && error ? (
        <div className="empty">
          {/market_stress/i.test(error)
            ? "The market stress table is not in the database yet. Paste the contents of schema-market-stress.sql into the Supabase SQL Editor and run them."
            : error}
        </div>
      ) : null}
      {loaded && !error && !latest ? (
        <div className="empty">No market reading yet. It fills in after the nightly job runs.</div>
      ) : null}
      {presentation ? (
        <div className="stress-banner-body">
          <Light regime={presentation.regime} large />
          <div>
            <p className="stress-reason">{presentation.state === "fresh" ? latest.reason : presentation.headline}</p>
            <p className="sync-note">
              Market session {formatDay(presentation.asOf) || presentation.asOf}.
              {whenDownloaded(presentation.fetchedAt) ? ` Downloaded ${whenDownloaded(presentation.fetchedAt)}.` : " "}
              The download time is not a new session.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function History({ rows }) {
  const newestFirst = [...rows].reverse();
  return (
    <>
      <h3>Last {rows.length === 1 ? "day" : `${rows.length} days`}</h3>
      <p className="sync-note">Each row is that session’s close. It is not a live reading.</p>
      {rows.length > 1 ? (
        <p className="sync-note">The line is the VIX close. The bars under it are that day’s light, oldest on the left.</p>
      ) : null}
      <Sparkline rows={rows} />
      <div className="regime-dots" aria-hidden="true">
        {rows.map((row) => <i key={row.as_of} className={row.regime || "nodata"} />)}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Light</th>
              <th>VIX</th>
              <th>VIX / VIX3M</th>
              <th>SKEW</th>
              <th>SPY vs 200-day</th>
              <th>Breadth</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((row) => (
              <tr key={row.as_of}>
                <td>{formatDay(row.as_of) || row.as_of}</td>
                <td><Light regime={row.regime} /></td>
                <td>{num(row.vix, 1)}</td>
                <td>{num(row.vix_ratio, 2)}</td>
                <td>{num(row.skew, 0)}</td>
                <td>{spyLine(row)}</td>
                <td>{breadthLine(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function MarketStress() {
  const { sample, rows, latest, loaded, error } = useMarketStress();
  const missingTable = error && /market_stress/i.test(error);

  return (
    <>
      <div className="panel">
        <h2>Market Stress{sample ? " — sample data" : ""}</h2>
        {sample ? (
          <div className="sample-banner">
            Sample data for preview. These are not live prices. On the real site this panel fills itself in after the nightly job runs.
          </div>
        ) : null}
        {!loaded && <div className="empty">Loading...</div>}
        {loaded && missingTable ? (
          <div className="empty">
            The market stress table is not in the database yet. In Supabase, open SQL Editor, paste the contents of schema-market-stress.sql, and run it. Paste the file’s contents, not its name.
          </div>
        ) : null}
        {loaded && error && !missingTable ? <div className="empty">{error}</div> : null}
        {loaded && !error && !latest ? (
          <div className="empty">No market reading yet. Nothing to type. The first row appears after the nightly job runs.</div>
        ) : null}
        {latest ? <Reading row={latest} presentation={presentRegime(latest, clockFor(sample))} /> : null}
        {rows.length > 0 ? <History rows={rows} /> : null}
        <p className="disclaimer">
          {TIMING_NOTE} Green means the backdrop is favorable for swing longs: SPY is above a 200-day average that is still rising, VIX is under 20, and VIX is under 95% of the 3-month VIX (a normal, upward-sloping fear curve). Red means the trend is not up, or near-term fear is higher than three-month fear, or VIX is over 30. Anything in between is amber. A calm tape stays amber when SKEW is 150 or higher, or when fewer than 40% of your watchlist names are above their own 200-day average. SKEW and breadth never turn the light red by themselves. The 200-day average lags the price. This is a backdrop check, not a buy or sell order. A reading from an older session is shown as not current.
        </p>
      </div>

      <div className="panel">
        <h2>Uranium demand — check by hand</h2>
        <p className="stress-reason">
          Sprott Physical Uranium Trust (SPUT) is not downloaded automatically. Sprott’s terms do not allow a program to scrape or data-mine their site, and no other free source clearly allows a nightly copy. There is no pounds figure in this app, so nothing here can go stale.
        </p>
        <p className="stress-reason">
          It still matters for CCJ, DNN, and NXE. SPUT buys and holds real uranium (U3O8). When the pounds it holds are rising, a large buyer is taking supply off the spot market those miners sell into. The premium or discount to net asset value shows whether investors are eager to own the uranium itself (a premium) or not (a discount). Compare the pounds with a week ago and a month ago: rising pounds means SPUT is still buying.
        </p>
        <p className="stress-reason">
          Look up “Total lbs of U3O8” and “Premium / Discount” on{" "}
          <a href={SPROTT_URANIUM_URL} target="_blank" rel="noreferrer">Sprott’s uranium trust page</a>.
        </p>
      </div>
    </>
  );
}
