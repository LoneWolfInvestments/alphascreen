// Market-regime rules for the nightly job and the Market Stress tab.
// Thresholds are the common swing-trading lines, not a fitted model:
//   * Green needs all of: SPY above its 200-day average, that average higher
//     than it was 21 trading days ago, VIX under 20, and VIX/VIX3M under 0.95
//     (comfortably in contango).
//   * Red if any of: SPY under its 200-day, VIX/VIX3M over 1 (inverted), or
//     VIX over 30.
//   * Otherwise amber.
// A would-be green day is downgraded to amber when SKEW is 150 or higher
// (crash protection is expensive; typical SKEW sits nearer 120–145) or when
// fewer than 40% of watchlist names with a full 200-day history are above
// that average. Neither of those alone turns the light red.

export const VIX_CALM = 20;
export const VIX_STRESS = 30;
export const RATIO_CALM = 0.95;
export const RATIO_INVERTED = 1;
export const SKEW_RICH = 150;
export const BREADTH_NARROW = 40;
export const BREADTH_MIN_NAMES = 5;
export const SMA_WINDOW = 200;
export const SLOPE_SESSIONS = 21;
export const PRICE_MAX_LAG_DAYS = 5;

const CBOE_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function finite(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundTo(value, places) {
  const n = finite(value);
  if (n == null) return null;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function fmt(value, places = 1) {
  const n = finite(value);
  if (n == null) return "—";
  return n.toFixed(places);
}

function sentenceList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function sentences(items) {
  return items.map((item) => (/[.!?]$/.test(item) ? item : `${item}.`)).join(" ");
}

export function parseCboeDate(raw) {
  const match = CBOE_DATE.exec(String(raw || "").trim());
  if (!match) return null;
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  const iso = `${match[3]}-${month}-${day}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime())) return null;
  if (check.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

// Cboe daily files are DATE plus OHLC, except SKEW which is DATE,SKEW.
// The published files redirect (cdn.cboe.com → cdn-api.cboe.com). Callers
// follow that redirect and pass the CSV text here.
export function parseCboeDailyCsv(text, valueColumn) {
  const cleaned = String(text || "").replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((cell) => cell.trim().toUpperCase());
  const dateIdx = header.indexOf("DATE");
  const valueIdx = header.indexOf(String(valueColumn || "").toUpperCase());
  if (dateIdx < 0 || valueIdx < 0) {
    throw new Error(`Unexpected Cboe columns: ${lines[0]}`);
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = parseCboeDate(cols[dateIdx]);
    const value = finite(cols[valueIdx]);
    if (!date || value == null) continue;
    rows.push({ date, value });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

// Newest date that both VIX and VIX3M published. SKEW is used when that
// same date exists, and left blank when Cboe has not posted it yet.
export function alignCboeCloses({ vix, vix3m, skew }) {
  const vixByDate = new Map((vix || []).map((row) => [row.date, row.value]));
  const vix3mByDate = new Map((vix3m || []).map((row) => [row.date, row.value]));
  const skewByDate = new Map((skew || []).map((row) => [row.date, row.value]));
  const common = [...vixByDate.keys()].filter((date) => vix3mByDate.has(date)).sort();
  if (!common.length) throw new Error("VIX and VIX3M have no date in common");
  const asOf = common[common.length - 1];
  return {
    asOf,
    vix: vixByDate.get(asOf),
    vix3m: vix3mByDate.get(asOf),
    skew: skewByDate.has(asOf) ? skewByDate.get(asOf) : null,
  };
}

export function smaEnding(closes, endIndex, window = SMA_WINDOW) {
  if (!Array.isArray(closes) || endIndex == null) return null;
  const start = endIndex - window + 1;
  if (start < 0 || endIndex >= closes.length) return null;
  let sum = 0;
  for (let i = start; i <= endIndex; i += 1) {
    const value = finite(closes[i]);
    if (value == null) return null;
    sum += value;
  }
  return sum / window;
}

// closes are oldest first. "Rising" means today's 200-day average is higher
// than the 200-day average from 21 trading sessions ago (about one month).
export function trendFromCloses(closes) {
  const values = (closes || []).map((value) => finite(value)).filter((value) => value != null);
  const close = values.length ? values[values.length - 1] : null;
  if (values.length < SMA_WINDOW) {
    return { close, sma200: null, above: null, rising: null };
  }
  const last = values.length - 1;
  const sma200 = smaEnding(values, last);
  const prevIndex = last - SLOPE_SESSIONS;
  const smaPrev = smaEnding(values, prevIndex);
  return {
    close,
    sma200,
    above: close != null && sma200 != null ? close > sma200 : null,
    rising: sma200 != null && smaPrev != null ? sma200 > smaPrev : null,
  };
}

export function daysBetween(earlier, later) {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

export function dateWithin(barDate, asOf, maxLagDays = PRICE_MAX_LAG_DAYS) {
  const lag = daysBetween(barDate, asOf);
  return lag != null && lag >= 0 && lag <= maxLagDays;
}

export function closesBySymbol(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || "").toUpperCase();
    const date = String(row.bar_date || "").slice(0, 10);
    const close = finite(row.close);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null) continue;
    if (!map.has(symbol)) map.set(symbol, []);
    map.get(symbol).push({ date, close });
  }
  for (const [symbol, list] of map) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const deduped = [];
    for (const item of list) {
      if (deduped.length && deduped[deduped.length - 1].date === item.date) deduped[deduped.length - 1] = item;
      else deduped.push(item);
    }
    map.set(symbol, deduped);
  }
  return map;
}

export function breadthFromSeries(seriesList, asOf) {
  let above = 0;
  let total = 0;
  for (const series of seriesList || []) {
    if (!series?.length) continue;
    const last = series[series.length - 1];
    if (asOf && !dateWithin(last.date, asOf)) continue;
    const trend = trendFromCloses(series.map((bar) => bar.close));
    if (trend.above == null) continue;
    total += 1;
    if (trend.above) above += 1;
  }
  return {
    above,
    total,
    pct: total ? roundTo((above / total) * 100, 1) : null,
  };
}

export function classifyRegime({
  vix,
  vix3m,
  skew,
  spyAboveSma200,
  spySma200Rising,
  breadthPct,
  breadthTotal,
} = {}) {
  const vixLevel = finite(vix);
  const vix3mLevel = finite(vix3m);
  const skewLevel = finite(skew);
  const ratio = vixLevel != null && vix3mLevel != null && vix3mLevel > 0
    ? vixLevel / vix3mLevel
    : null;
  const above = spyAboveSma200 == null ? null : Boolean(spyAboveSma200);
  const rising = spySma200Rising == null ? null : Boolean(spySma200Rising);
  const breadth = finite(breadthPct);
  const names = finite(breadthTotal);

  const reds = [];
  if (above === false) reds.push("SPY is at or below its 200-day average, so the market trend is not up");
  if (ratio != null && ratio > RATIO_INVERTED) {
    reds.push(`VIX is ${fmt(ratio, 2)} times the 3-month VIX, so near-term fear is higher than three-month fear`);
  }
  if (vixLevel != null && vixLevel > VIX_STRESS) reds.push(`VIX is ${fmt(vixLevel)}, above 30`);

  if (reds.length) {
    return {
      regime: "red",
      reason: `Stressed. ${sentences(reds)}`,
      vixRatio: roundTo(ratio, 4),
    };
  }

  const missing = [];
  if (vixLevel == null) missing.push("VIX");
  if (vix3mLevel == null) missing.push("the 3-month VIX");
  if (above == null) missing.push("SPY versus its 200-day average");
  else if (rising == null) missing.push("whether the 200-day average is rising");

  if (missing.length) {
    return {
      regime: "amber",
      reason: `Not a full reading. Still missing ${sentenceList(missing)}, so this stays amber instead of guessing.`,
      vixRatio: roundTo(ratio, 4),
    };
  }

  const calm = above === true
    && rising === true
    && ratio != null
    && ratio < RATIO_CALM
    && vixLevel != null
    && vixLevel < VIX_CALM;

  if (calm) {
    const facts = `SPY is above a 200-day average that is still rising, VIX is ${fmt(vixLevel)} (under 20), and VIX is ${Math.round(ratio * 100)}% of the 3-month VIX, so near-term fear is lower than three-month fear.`;
    const downgrades = [];
    if (skewLevel != null && skewLevel >= SKEW_RICH) {
      downgrades.push(`SKEW is ${Math.round(skewLevel)}, which means crash protection is expensive even though day-to-day fear is low.`);
    }
    if (breadth != null && names != null && names >= BREADTH_MIN_NAMES && breadth < BREADTH_NARROW) {
      downgrades.push(`Only ${Math.round(breadth)}% of the watchlist names with a 200-day history are above that average, so the index looks healthier than the list.`);
    }
    if (downgrades.length) {
      return {
        regime: "amber",
        reason: `Mixed. ${facts} ${downgrades.join(" ")} That keeps the light amber.`,
        vixRatio: roundTo(ratio, 4),
      };
    }
    let reason = `Favorable for swing longs. ${facts}`;
    if (breadth != null && names != null && names >= BREADTH_MIN_NAMES) {
      reason += ` ${Math.round(breadth)}% of the watchlist is above its own 200-day average.`;
    }
    if (skewLevel == null) reason += " SKEW was not posted for this day.";
    return { regime: "green", reason, vixRatio: roundTo(ratio, 4) };
  }

  const misses = [];
  if (above === true && rising === false) {
    misses.push("SPY is above its 200-day average, but that average is flat or falling");
  }
  if (vixLevel != null && vixLevel >= VIX_CALM && vixLevel <= VIX_STRESS) {
    misses.push(`VIX is ${fmt(vixLevel)}, between 20 and 30`);
  }
  if (ratio != null && ratio >= RATIO_CALM && ratio <= RATIO_INVERTED) {
    misses.push(`VIX is ${fmt(ratio, 2)} times the 3-month VIX, so the volatility curve is flat rather than comfortably sloped`);
  }
  if (!misses.length) misses.push("the checks do not all line up for a calm market, and none of the stress lines were crossed");

  return {
    regime: "amber",
    reason: `Mixed. ${sentences(misses)}`,
    vixRatio: roundTo(ratio, 4),
  };
}

export function buildStressRow({ asOf, vix, vix3m, skew, spySeries, nameSeries }) {
  const spy = spySeries || [];
  const spyLast = spy.length ? spy[spy.length - 1] : null;
  const fresh = Boolean(spyLast && dateWithin(spyLast.date, asOf));
  const trend = fresh
    ? trendFromCloses(spy.map((bar) => bar.close))
    : { close: null, sma200: null, above: null, rising: null };
  const breadth = breadthFromSeries(nameSeries, asOf);
  const classified = classifyRegime({
    vix,
    vix3m,
    skew,
    spyAboveSma200: trend.above,
    spySma200Rising: trend.rising,
    breadthPct: breadth.pct,
    breadthTotal: breadth.total,
  });

  let reason = classified.reason;
  if (spyLast && !fresh) {
    reason += ` SPY's saved prices stop at ${spyLast.date}, which is too old to use for this reading.`;
  } else if (fresh && spyLast.date !== asOf) {
    reason += ` SPY's saved prices are as of ${spyLast.date}.`;
  }

  return {
    as_of: asOf,
    vix: roundTo(vix, 4),
    vix3m: roundTo(vix3m, 4),
    vix_ratio: classified.vixRatio,
    skew: roundTo(skew, 4),
    spy_close: roundTo(trend.close, 4),
    spy_sma200: roundTo(trend.sma200, 4),
    spy_above_sma200: trend.above,
    spy_sma200_rising: trend.rising,
    spy_bar_date: fresh ? spyLast.date : null,
    breadth_above: breadth.above,
    breadth_total: breadth.total,
    breadth_pct: breadth.pct,
    regime: classified.regime,
    reason,
  };
}

export function regimeLabel(regime) {
  if (regime === "green") return "Green — favorable";
  if (regime === "red") return "Red — stressed";
  if (regime === "amber") return "Amber — mixed";
  return "No reading";
}

export function ratioTone(ratio) {
  const value = finite(ratio);
  if (value == null) return null;
  if (value > RATIO_INVERTED) return "inverted";
  if (value >= RATIO_CALM) return "flat";
  return "contango";
}
