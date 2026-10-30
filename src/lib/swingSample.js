// Realistic daily bars for the Technical Analysis preview and the setup tests.
// Prices are synthetic. The labels come from the same function the nightly job uses.

import { analyzeSymbol, viewRowFromSetup } from "./swingSetups.js";

export const SAMPLE_END = "2026-10-29";

export function tradingDatesEnding(count, endIso) {
  const dates = [];
  const cursor = new Date(`${endIso}T00:00:00Z`);
  while (dates.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

export function barsFromCloses(closes, { end = SAMPLE_END, volumeAt = () => 1_000_000, range = 0.006 } = {}) {
  const dates = tradingDatesEnding(closes.length, end);
  return closes.map((close, index) => {
    const open = close * (1 - range / 2);
    const high = Math.max(open, close) * (1 + range);
    const low = Math.min(open, close) * (1 - range);
    return {
      date: dates[index],
      open,
      high,
      low,
      close,
      volume: volumeAt(index, closes.length),
    };
  });
}

function linear(count, start, step) {
  return Array.from({ length: count }, (_, index) => start + index * step);
}

function replaceLast(bars, patch) {
  const next = bars.map((bar) => ({ ...bar }));
  next[next.length - 1] = { ...next[next.length - 1], ...patch };
  return next;
}

function replaceAt(bars, indexFromEnd, patch) {
  const next = bars.map((bar) => ({ ...bar }));
  const index = next.length - 1 - indexFromEnd;
  next[index] = { ...next[index], ...patch };
  return next;
}

// Steady uptrend, close still inside the prior 20-day highs. No trigger.
export function uptrendBars() {
  return barsFromCloses(linear(320, 80, 0.35));
}

// Same climb, a short two-way patch so RSI is not pinned at 100, then today's
// close clears the prior 20-day high on heavy volume.
export function breakoutTodayBars() {
  const closes = linear(320, 80, 0.35);
  for (let i = closes.length - 15; i < closes.length - 1; i += 1) {
    closes[i] = closes[i - 1] * ((i % 2 === 0) ? 0.993 : 1.004);
  }
  const base = barsFromCloses(closes);
  const priorHigh = Math.max(...base.slice(-21, -1).map((bar) => bar.high));
  const close = priorHigh * 1.02;
  return replaceLast(base, { close, open: close * 0.99, high: close * 1.01, low: close * 0.985, volume: 3_000_000 });
}

// Breakout three sessions ago. The days after it do not make a newer breakout.
export function breakoutThreeDaysAgoBars() {
  const base = uptrendBars();
  const index = base.length - 4;
  const priorHigh = Math.max(...base.slice(index - 20, index).map((bar) => bar.high));
  const close = priorHigh * 1.03;
  const spiked = replaceAt(base, 3, {
    close,
    open: close * 0.99,
    high: close * 1.012,
    low: close * 0.985,
    volume: 4_000_000,
  });
  // Keep the later closes under that spike's high so they are not new breakouts,
  // and still above the 50-day average.
  for (const ago of [2, 1, 0]) {
    const at = spiked.length - 1 - ago;
    const settled = close * 0.985;
    spiked[at] = {
      ...spiked[at],
      close: settled,
      open: settled * 0.998,
      high: settled * 1.004,
      low: settled * 0.994,
      volume: 1_000_000,
    };
  }
  return spiked;
}

// Close lifts through the old high, but volume is only average.
export function unconfirmedBreakoutBars() {
  const bars = breakoutTodayBars();
  return replaceLast(bars, { volume: 1_000_000 });
}

// Today's wick sets a new high, but the close stays inside the prior channel.
export function wickOnlyBars() {
  const base = uptrendBars();
  const last = base[base.length - 1];
  return replaceLast(base, { high: last.high * 1.25 });
}

// Last close is set to the 20-day neighborhood by dropping onto the rising average.
export function pullback20Bars() {
  const closes = linear(320, 80, 0.35);
  const prior19 = closes.slice(-20, -1);
  const near = prior19.reduce((sum, value) => sum + value, 0) / prior19.length;
  closes[closes.length - 1] = near;
  return barsFromCloses(closes);
}

// Deeper dip onto the 50-day average, still closing on it.
export function pullback50Bars() {
  const closes = linear(320, 80, 0.35);
  const prior49 = closes.slice(-50, -1);
  const near = prior49.reduce((sum, value) => sum + value, 0) / prior49.length;
  closes[closes.length - 1] = near * 1.002;
  return barsFromCloses(closes);
}

// Long decline with a little noise, so RSI is washed out rather than stuck at zero.
// A low RSI here is the falling-knife case and must not read as a buy.
export function downtrendBars() {
  const closes = linear(320, 220, -0.28).map((price, index) => price * (1 + 0.008 * Math.sin(index / 2)));
  return barsFromCloses(closes);
}

// A real uptrend that has gone quiet. Strong enough to keep the gate open,
// last breakout too old to trade, RSI back in a normal range.
export function calmUptrendBars() {
  const closes = [];
  let price = 90;
  for (let i = 0; i < 281; i += 1) {
    price *= 1.0007;
    closes.push(price);
  }
  for (let i = 0; i < 25; i += 1) {
    price *= 1.006;
    closes.push(price);
  }
  const peak = price;
  for (let i = 0; i < 14; i += 1) closes.push(peak * (0.995 - i * 0.0012));
  return barsFromCloses(closes, { range: 0.002 });
}

// Fast climb, then a short pause under a high from 8 sessions ago.
// RSI stays elevated. The old high is too stale to be a fresh breakout,
// and price stays clear of the 20-day and 50-day averages.
export function extendedUptrendBars() {
  const closes = linear(312, 50, 0.22);
  const bars = barsFromCloses(closes, { range: 0.004 });
  const spikeAt = bars.length - 9;
  const spikeClose = bars[spikeAt].close * 1.05;
  bars[spikeAt] = {
    ...bars[spikeAt],
    close: spikeClose,
    open: bars[spikeAt].close,
    high: spikeClose * 1.02,
    low: bars[spikeAt].low,
    volume: 1_000_000,
  };
  const ceiling = bars[spikeAt].high;
  for (let ago = 0; ago < 8; ago += 1) {
    const index = bars.length - 1 - ago;
    const close = ceiling * (0.97 - ago * 0.001);
    bars[index] = {
      ...bars[index],
      close,
      open: close * 0.998,
      high: Math.min(ceiling * 0.985, close * 1.004),
      low: close * 0.996,
      volume: 1_000_000,
    };
  }
  return bars;
}

export function spyBars() {
  return barsFromCloses(linear(320, 400, 0.12));
}

export function thinBars() {
  return barsFromCloses(linear(80, 20, 0.05));
}

export function buildSwingSample() {
  const spy = spyBars();
  const specs = [
    ["NVDA", breakoutTodayBars()],
    ["AMD", breakoutThreeDaysAgoBars()],
    ["AAPL", pullback20Bars()],
    ["MSFT", pullback50Bars()],
    ["LLY", extendedUptrendBars()],
    ["INTC", downtrendBars()],
    ["GOOGL", calmUptrendBars()],
    ["ARM", thinBars()],
  ];
  const rows = specs.map(([symbol, bars]) => viewRowFromSetup(analyzeSymbol(bars, spy, { symbol })));
  return {
    barDate: SAMPLE_END,
    rows,
    spyClose: spy[spy.length - 1].close,
  };
}
