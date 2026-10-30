// Swing setups computed from stored daily bars.
// A trend gate decides whether a long is even allowed. Breakout and pullback
// are separate entries. RSI never adds a buy point.
//
// Relative strength is the stock's return minus SPY's, in percentage points
// (15 means the stock beat SPY by 15 points over that window).

import { ATR, RSI, SMA } from "technicalindicators";
import { POSITION_LIMIT } from "./sellSignals.js";

export const BENCHMARK_SYMBOL = "SPY";

export const MIN_TREND_BARS = 200;
export const BREAKOUT_LOOKBACK = 20;
export const FRESH_BREAKOUT_DAYS = 5;
export const VOLUME_AVG_SHORT = 20;
export const VOLUME_AVG_LONG = 50;
export const SMA_FAST = 50;
export const SMA_SLOW = 200;
export const SMA_PULLBACK = 20;
export const SLOPE_DAYS_50 = 10;
export const SLOPE_DAYS_20 = 5;
export const ATR_PERIOD = 14;
export const ATR_MULT = 2;
export const RSI_PERIOD = 14;
export const RSI_EXTENDED = 75;
export const RSI_WASHOUT = 35;
export const RS_3 = 63;
export const RS_6 = 126;
export const RS_12 = 252;
export const PORTFOLIO_RISK = 0.01;

export const SETUP = Object.freeze({
  BREAKOUT: "Breakout",
  PULLBACK: "Pullback",
  UPTREND: "Uptrend-no-trigger",
  AVOID: "Avoid-downtrend",
  THIN: "Not enough history",
  BENCHMARK: "Benchmark",
});

export const SETUP_ORDER = Object.freeze({
  [SETUP.BREAKOUT]: 0,
  [SETUP.PULLBACK]: 1,
  [SETUP.UPTREND]: 2,
  [SETUP.AVOID]: 3,
  [SETUP.THIN]: 4,
  [SETUP.BENCHMARK]: 5,
});

export const SETUP_QUOTE_COLUMNS = Object.freeze([
  "setup_label",
  "setup_reason",
  "rs_3m",
  "rs_6m",
  "rs_12m",
  "rs_composite",
  "days_since_breakout",
  "suggested_stop",
  "risk_pct",
  "sma_20",
  "breakout_volume_ok",
]);

const WEIGHT_12 = 0.5;
const WEIGHT_6 = 0.3;
const WEIGHT_3 = 0.2;

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function usd(value) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatRs(points) {
  if (!Number.isFinite(points)) return "—";
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}%`;
}

export function formatRiskPct(points) {
  if (!Number.isFinite(points)) return "—";
  return `${points.toFixed(1)}%`;
}

// Share of the account to buy so that a stop-out loses about 1% of the portfolio.
export function sizeAtOnePercentRisk(riskPct) {
  if (!Number.isFinite(riskPct) || riskPct <= 0) return null;
  const weightPct = 100 / riskPct;
  return {
    weightPct,
    overCap: weightPct / 100 > POSITION_LIMIT,
  };
}

export function formatSize(riskPct) {
  const size = sizeAtOnePercentRisk(riskPct);
  if (!size) return "—";
  const text = `${size.weightPct.toFixed(0)}% of account`;
  return size.overCap ? `${text} (over the 25% cap)` : text;
}

function maxFinite(values) {
  let max = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (max == null || value > max) max = value;
  }
  return max;
}

function minFinite(values) {
  let min = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (min == null || value < min) min = value;
  }
  return min;
}

function mean(values) {
  if (!values.length) return null;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return sum / values.length;
}

export function orderedBars(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => ({
      date: String(bar?.date || bar?.bar_date || "").slice(0, 10),
      open: num(bar?.open),
      high: num(bar?.high),
      low: num(bar?.low),
      close: num(bar?.close),
      volume: num(bar?.volume),
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.close))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Highest high and lowest low of the prior `period` bars, excluding today.
// Including today would make today's own high look like a breakout.
export function priorChannel(bars, period = BREAKOUT_LOOKBACK) {
  const series = orderedBars(bars);
  if (series.length < period + 1) return { high: null, low: null };
  const window = series.slice(-period - 1, -1);
  return {
    high: maxFinite(window.map((bar) => bar.high)),
    low: minFinite(window.map((bar) => bar.low)),
  };
}

function smaLatest(values, period) {
  if (values.length < period) return null;
  const series = SMA.calculate({ period, values });
  return series.length ? series[series.length - 1] : null;
}

function smaOffset(values, period, barsAgo) {
  if (values.length < period + barsAgo) return null;
  const series = SMA.calculate({ period, values });
  const index = series.length - 1 - barsAgo;
  return index >= 0 && Number.isFinite(series[index]) ? series[index] : null;
}

function volumeAboveAverages(bars, index) {
  const volume = bars[index].volume;
  if (!Number.isFinite(volume)) return false;
  const prevShort = bars.slice(index - VOLUME_AVG_SHORT, index).map((bar) => bar.volume);
  const prevLong = bars.slice(index - VOLUME_AVG_LONG, index).map((bar) => bar.volume);
  if (prevShort.length < VOLUME_AVG_SHORT || prevLong.length < VOLUME_AVG_LONG) return false;
  const avgShort = mean(prevShort);
  const avgLong = mean(prevLong);
  if (avgShort == null || avgLong == null) return false;
  return volume > avgShort && volume > avgLong;
}

function latestBreakout(bars) {
  for (let i = bars.length - 1; i >= BREAKOUT_LOOKBACK; i -= 1) {
    const priorHigh = maxFinite(bars.slice(i - BREAKOUT_LOOKBACK, i).map((bar) => bar.high));
    if (priorHigh == null) continue;
    if (bars[i].close > priorHigh) {
      return {
        index: i,
        priorHigh,
        daysSince: bars.length - 1 - i,
        volumeOk: volumeAboveAverages(bars, i),
      };
    }
  }
  return null;
}

// "At the average" means the low reached it (or came within 1%) and the close
// finished within 1.5% above it. A smooth climb that merely lives a few
// percent above the average is not a pullback.
function taggedAverage(close, low, average) {
  if (![close, low, average].every(Number.isFinite) || average <= 0) return false;
  const held = close >= average * 0.995 && close <= average * 1.015;
  const tag = low <= average * 1.01;
  return held && tag;
}

function barOnOrBefore(bars, date) {
  let found = null;
  for (const bar of bars) {
    if (bar.date <= date) found = bar;
    else break;
  }
  return found;
}

function calendarGap(a, b) {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  return Math.abs(left - right) / 86400000;
}

function relativeStrength(stockBars, spyBars, lookback) {
  if (!spyBars || stockBars.length <= lookback) return null;
  const end = stockBars[stockBars.length - 1];
  const start = stockBars[stockBars.length - 1 - lookback];
  if (!Number.isFinite(start.close) || start.close === 0 || !Number.isFinite(end.close)) return null;
  const spyStart = barOnOrBefore(spyBars, start.date);
  const spyEnd = barOnOrBefore(spyBars, end.date);
  if (!spyStart || !spyEnd || !Number.isFinite(spyStart.close) || spyStart.close === 0) return null;
  if (calendarGap(spyStart.date, start.date) > 5 || calendarGap(spyEnd.date, end.date) > 5) return null;
  const stockReturn = end.close / start.close - 1;
  const spyReturn = spyEnd.close / spyStart.close - 1;
  return (stockReturn - spyReturn) * 100;
}

function compositeOf(rs3, rs6, rs12) {
  if (rs6 == null && rs12 == null) return null;
  const parts = [];
  if (rs12 != null) parts.push([rs12, WEIGHT_12]);
  if (rs6 != null) parts.push([rs6, WEIGHT_6]);
  if (rs3 != null) parts.push([rs3, WEIGHT_3]);
  const weight = parts.reduce((sum, part) => sum + part[1], 0);
  if (!weight) return null;
  return parts.reduce((sum, part) => sum + part[0] * (part[1] / weight), 0);
}

function agePhrase(days) {
  if (days === 0) return "today";
  if (days === 1) return "1 trading day ago";
  return `${days} trading days ago`;
}

function sizeSentence(stop, riskPct) {
  if (!Number.isFinite(stop) || !Number.isFinite(riskPct)) return "";
  const size = sizeAtOnePercentRisk(riskPct);
  if (!size) return "";
  const cap = size.overCap
    ? " That is over the 25% single-name cap, so use a smaller size."
    : "";
  return ` Suggested stop is ${usd(stop)}, ${formatRiskPct(riskPct)} under the close. At a 1% portfolio risk, that is about a ${size.weightPct.toFixed(0)}% position.${cap}`;
}

function rsiSentence(rsi, label) {
  if (!Number.isFinite(rsi)) return "";
  if (rsi >= RSI_EXTENDED && label !== SETUP.AVOID) {
    return ` RSI is ${rsi.toFixed(0)}, which is extended. That is a warning not to chase, not a point in favor of buying.`;
  }
  if (rsi <= RSI_WASHOUT && label === SETUP.AVOID) {
    return ` RSI is ${rsi.toFixed(0)}. A low RSI in a downtrend is weakness, not a dip to buy.`;
  }
  return "";
}

function buildReason(facts) {
  const {
    label, bars, price, sma20, sma50, sma200, sma50Rising,
    breakout, near20, near50, stop, riskPct, rsi,
  } = facts;

  if (label === SETUP.BENCHMARK) {
    return "SPY is the market benchmark. Other names are compared with it. It is not a trade setup.";
  }
  if (label === SETUP.THIN) {
    return `Only ${bars} daily bars are stored. The trend read needs 200 trading days, so this is not a buy or a sell yet.`;
  }

  let text = "";
  if (label === SETUP.BREAKOUT && breakout) {
    text = `Broke out ${agePhrase(breakout.daysSince)} above the prior 20-day high (${usd(breakout.priorHigh)}). Volume that day was above both the 20-day and 50-day average. The uptrend is intact: price is above a rising 50-day average, and the 50-day is above the 200-day.`;
    text += sizeSentence(stop, riskPct);
  } else if (label === SETUP.PULLBACK) {
    const which = near20 && near50
      ? `the rising 20-day (${usd(sma20)}) and 50-day (${usd(sma50)}) averages`
      : near20
        ? `the rising 20-day average (${usd(sma20)})`
        : `the rising 50-day average (${usd(sma50)})`;
    text = `Uptrend is intact and price has pulled back to ${which}. The close held the average.`;
    text += sizeSentence(stop, riskPct);
  } else if (label === SETUP.UPTREND) {
    if (!sma50Rising && price >= sma50 && sma50 > sma200) {
      text = `Price is above the 50-day average and the 50-day is above the 200-day, but the 50-day average has not risen over the last ${SLOPE_DAYS_50} sessions. Wait for it to turn up before starting a new trade.`;
    } else {
      text = "Uptrend is intact: price is above a rising 50-day average, and the 50-day is above the 200-day. No fresh breakout and no pullback to the 20- or 50-day average, so there is nothing to enter today.";
    }
    if (breakout && !breakout.volumeOk && breakout.daysSince <= FRESH_BREAKOUT_DAYS) {
      text += ` Price cleared the prior 20-day high ${agePhrase(breakout.daysSince)}, but volume was not above both the 20-day and 50-day average.`;
    } else if (breakout && breakout.daysSince > FRESH_BREAKOUT_DAYS) {
      text += ` The last 20-day breakout was ${agePhrase(breakout.daysSince)}.`;
    }
    if (Number.isFinite(stop)) {
      text += ` If you already own it, a 2×ATR stop would sit at ${usd(stop)} (${formatRiskPct(riskPct)} under the close).`;
    }
  } else {
    if (sma50 != null && sma200 != null && sma50 <= sma200) {
      text = `The 50-day average (${usd(sma50)}) is not above the 200-day average (${usd(sma200)}), so the longer trend is down.`;
    } else if (price != null && sma50 != null && price < sma50) {
      text = `Price (${usd(price)}) is below the 50-day average (${usd(sma50)}), so this is not an uptrend entry.`;
    } else {
      text = "The uptrend gate is closed, so this is not a long setup.";
    }
    text += " No long entry. If you already own it, use the Sell Signals tab for the exit stop.";
  }

  return `${text}${rsiSentence(rsi, label)}`;
}

export function analyzeSymbol(rawBars, rawSpyBars, { symbol } = {}) {
  const bars = orderedBars(rawBars);
  const spyBars = orderedBars(rawSpyBars);
  const closes = bars.map((bar) => bar.close);
  const price = bars.length ? bars[bars.length - 1].close : null;
  const low = bars.length ? bars[bars.length - 1].low : null;

  const sma20 = smaLatest(closes, SMA_PULLBACK);
  const sma50 = smaLatest(closes, SMA_FAST);
  const sma200 = smaLatest(closes, SMA_SLOW);
  const sma20Prev = smaOffset(closes, SMA_PULLBACK, SLOPE_DAYS_20);
  const sma50Prev = smaOffset(closes, SMA_FAST, SLOPE_DAYS_50);
  const sma20Rising = sma20 != null && sma20Prev != null && sma20 > sma20Prev;
  const sma50Rising = sma50 != null && sma50Prev != null && sma50 > sma50Prev;

  const rsiSeries = closes.length > RSI_PERIOD
    ? RSI.calculate({ period: RSI_PERIOD, values: closes })
    : [];
  const rsi = rsiSeries.length ? rsiSeries[rsiSeries.length - 1] : null;

  const atrSeries = bars.length > ATR_PERIOD
    ? ATR.calculate({
      period: ATR_PERIOD,
      high: bars.map((bar) => (Number.isFinite(bar.high) ? bar.high : bar.close)),
      low: bars.map((bar) => (Number.isFinite(bar.low) ? bar.low : bar.close)),
      close: closes,
    })
    : [];
  const atr14 = atrSeries.length && Number.isFinite(atrSeries[atrSeries.length - 1])
    ? atrSeries[atrSeries.length - 1]
    : null;
  const stop = price != null && atr14 != null ? price - ATR_MULT * atr14 : null;
  const usableStop = stop != null && price != null && stop < price ? stop : null;
  const riskPct = usableStop != null && price ? ((price - usableStop) / price) * 100 : null;

  const rs3m = relativeStrength(bars, spyBars, RS_3);
  const rs6m = relativeStrength(bars, spyBars, RS_6);
  const rs12m = relativeStrength(bars, spyBars, RS_12);
  const rsComposite = compositeOf(rs3m, rs6m, rs12m);

  const breakout = latestBreakout(bars);
  const channel = priorChannel(bars, BREAKOUT_LOOKBACK);
  const longStructure = sma50 != null && sma200 != null && price >= sma50 && sma50 > sma200;
  const trendGate = longStructure && sma50Rising;
  const near20 = sma20Rising && taggedAverage(price, low, sma20);
  const near50 = taggedAverage(price, low, sma50);
  const freshBreakout = !!(breakout && breakout.daysSince <= FRESH_BREAKOUT_DAYS && breakout.volumeOk && trendGate);

  let label;
  if (symbol === BENCHMARK_SYMBOL) label = SETUP.BENCHMARK;
  else if (bars.length < MIN_TREND_BARS) label = SETUP.THIN;
  else if (freshBreakout) label = SETUP.BREAKOUT;
  else if (trendGate && (near20 || near50)) label = SETUP.PULLBACK;
  else if (longStructure) label = SETUP.UPTREND;
  else label = SETUP.AVOID;

  const facts = {
    label,
    bars: bars.length,
    price,
    sma20,
    sma50,
    sma200,
    sma50Rising,
    breakout,
    near20,
    near50,
    stop: usableStop,
    riskPct,
    rsi,
  };

  let rsiWarning = null;
  if (Number.isFinite(rsi) && rsi >= RSI_EXTENDED && label !== SETUP.AVOID && label !== SETUP.BENCHMARK) {
    rsiWarning = "extended";
  } else if (Number.isFinite(rsi) && rsi <= RSI_WASHOUT && label === SETUP.AVOID) {
    rsiWarning = "washout";
  }

  return {
    symbol: symbol || null,
    label,
    reason: buildReason(facts),
    price,
    rsi: round(rsi, 2),
    rsiWarning,
    sma20: round(sma20, 4),
    sma50: round(sma50, 4),
    sma200: round(sma200, 4),
    sma50Rising,
    sma20Rising,
    trendGate,
    priorHigh20: channel.high,
    priorLow20: channel.low,
    daysSinceBreakout: breakout ? breakout.daysSince : null,
    breakoutVolumeOk: breakout ? breakout.volumeOk : false,
    freshBreakout,
    pullbackTo: label === SETUP.PULLBACK ? (near20 && near50 ? "20-and-50" : near20 ? "20" : "50") : null,
    rs3m: round(rs3m, 2),
    rs6m: round(rs6m, 2),
    rs12m: round(rs12m, 2),
    rsComposite: round(rsComposite, 2),
    atr14: round(atr14, 4),
    stop: round(usableStop, 4),
    riskPct: round(riskPct, 2),
    barDate: bars.length ? bars[bars.length - 1].date : null,
    barCount: bars.length,
  };
}

export function setupToQuoteFields(setup) {
  if (!setup) {
    return {
      setup_label: null,
      setup_reason: null,
      rs_3m: null,
      rs_6m: null,
      rs_12m: null,
      rs_composite: null,
      days_since_breakout: null,
      suggested_stop: null,
      risk_pct: null,
      sma_20: null,
      breakout_volume_ok: null,
    };
  }
  return {
    setup_label: setup.label,
    setup_reason: setup.reason,
    rs_3m: setup.rs3m,
    rs_6m: setup.rs6m,
    rs_12m: setup.rs12m,
    rs_composite: setup.rsComposite,
    days_since_breakout: setup.daysSinceBreakout,
    suggested_stop: setup.stop,
    risk_pct: setup.riskPct,
    sma_20: setup.sma20,
    breakout_volume_ok: setup.breakoutVolumeOk,
  };
}

export function withoutSetupColumns(row) {
  const copy = { ...row };
  for (const key of SETUP_QUOTE_COLUMNS) delete copy[key];
  return copy;
}

export function isMissingSetupColumnError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return SETUP_QUOTE_COLUMNS.some((column) => message.includes(column));
}

export function viewRowFromQuote(quote) {
  if (!quote) return null;
  const label = quote.setup_label || null;
  return {
    symbol: quote.symbol,
    price: num(quote.price),
    label,
    reason: quote.setup_reason || (label
      ? null
      : "The setup has not been saved yet. It shows up after the nightly refresh, once schema-daily-bars.sql has been run."),
    rs3m: num(quote.rs_3m),
    rs6m: num(quote.rs_6m),
    rs12m: num(quote.rs_12m),
    rsComposite: num(quote.rs_composite),
    daysSinceBreakout: quote.days_since_breakout == null || quote.days_since_breakout === ""
      ? null
      : Number(quote.days_since_breakout),
    stop: num(quote.suggested_stop),
    riskPct: num(quote.risk_pct),
    rsi: num(quote.rsi),
    barDate: quote.bar_date ? String(quote.bar_date).slice(0, 10) : null,
    volume: num(quote.volume),
  };
}

export function viewRowFromSetup(setup) {
  return {
    symbol: setup.symbol,
    price: setup.price,
    label: setup.label,
    reason: setup.reason,
    rs3m: setup.rs3m,
    rs6m: setup.rs6m,
    rs12m: setup.rs12m,
    rsComposite: setup.rsComposite,
    daysSinceBreakout: setup.daysSinceBreakout,
    stop: setup.stop,
    riskPct: setup.riskPct,
    rsi: setup.rsi,
    barDate: setup.barDate,
    volume: null,
  };
}

// Rank 1 is the strongest name on this list. Percentile is how many of the
// other names it beat. Names without a 6- or 12-month figure are left unranked
// so a short history cannot jump the list.
export function assignRelativeStrengthRanks(rows) {
  const ranked = (rows || []).filter((row) => row && Number.isFinite(row.rsComposite) && row.symbol !== BENCHMARK_SYMBOL);
  const sorted = [...ranked].sort((a, b) => b.rsComposite - a.rsComposite || String(a.symbol).localeCompare(String(b.symbol)));
  const total = sorted.length;
  const place = new Map();
  sorted.forEach((row, index) => {
    const rank = index + 1;
    const percentile = total <= 1 ? 100 : Math.round(((total - rank) / (total - 1)) * 100);
    place.set(row.symbol, { rsRank: rank, rsPercentile: percentile, rsCount: total });
  });
  return (rows || []).map((row) => {
    const extra = place.get(row.symbol);
    return extra ? { ...row, ...extra } : { ...row, rsRank: null, rsPercentile: null, rsCount: total };
  });
}

export function technicalReadFromQuote(quote) {
  if (!quote) return { sig: null, label: null, reasons: [], caveats: [], riskPct: null };
  const label = quote.setup_label || null;
  let sig = null;
  if (label === SETUP.BREAKOUT || label === SETUP.PULLBACK) sig = "Buy";
  else if (label === SETUP.UPTREND) sig = "Hold";
  else if (label === SETUP.AVOID) sig = "Sell";

  const reasons = [];
  if (quote.setup_reason) reasons.push(quote.setup_reason);
  else if (!label && quote.symbol) reasons.push("Setup not saved yet. It fills in after the next nightly refresh.");

  const caveats = [];
  if (quote.setup_reason) caveats.push(quote.setup_reason);
  else if (!label) caveats.push("Setup not saved yet");

  const riskPct = num(quote.risk_pct);
  return { sig, label, reasons, caveats, riskPct };
}
