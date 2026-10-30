import assert from "node:assert/strict";
import test from "node:test";
import {
  SETUP,
  analyzeSymbol,
  assignRelativeStrengthRanks,
  formatSize,
  isMissingSetupColumnError,
  priorChannel,
  setupToQuoteFields,
  sizeAtOnePercentRisk,
  technicalReadFromQuote,
  withoutSetupColumns,
} from "../src/lib/swingSetups.js";
import {
  breakoutThreeDaysAgoBars,
  breakoutTodayBars,
  buildSwingSample,
  downtrendBars,
  pullback20Bars,
  pullback50Bars,
  spyBars,
  thinBars,
  unconfirmedBreakoutBars,
  uptrendBars,
  wickOnlyBars,
} from "../src/lib/swingSample.js";
import { buildQuotePayload, historyRow } from "./buildQuote.js";
import {
  OUTPUT_SIZE,
  TWELVE_DATA_PAUSE_MS,
  barsFromTwelvePayload,
  canFetchAnother,
  queueForShard,
} from "./twelveData.js";

const spy = spyBars();

function setup(bars, symbol = "TEST") {
  return analyzeSymbol(bars, spy, { symbol });
}

test("a breakout uses the high of the bars before today, not today's own high", () => {
  const bars = breakoutTodayBars();
  const today = bars[bars.length - 1];
  const channel = priorChannel(bars, 20);
  assert.ok(channel.high < today.high);
  assert.ok(today.close > channel.high);
  const result = setup(bars, "NVDA");
  assert.equal(result.label, SETUP.BREAKOUT);
  assert.equal(result.daysSinceBreakout, 0);
  assert.equal(result.freshBreakout, true);
  assert.match(result.reason, /Broke out today/);
  assert.match(result.reason, /20-day and 50-day average/);

  const wick = wickOnlyBars();
  const wickToday = wick[wick.length - 1];
  const wickChannel = priorChannel(wick, 20);
  assert.ok(wickToday.high > wickChannel.high);
  assert.ok(wickToday.close <= wickChannel.high);
  assert.notEqual(setup(wick).label, SETUP.BREAKOUT);
});

test("average volume does not confirm a breakout, and a 3-day-old breakout still counts", () => {
  const quiet = setup(unconfirmedBreakoutBars());
  assert.equal(quiet.label, SETUP.UPTREND);
  assert.equal(quiet.breakoutVolumeOk, false);
  assert.match(quiet.reason, /volume was not above both/);

  const aged = setup(breakoutThreeDaysAgoBars(), "AMD");
  assert.equal(aged.label, SETUP.BREAKOUT);
  assert.equal(aged.daysSinceBreakout, 3);
  assert.match(aged.reason, /3 trading days ago/);
});

test("a low RSI in a downtrend is not a buy, and a hot RSI does not flip an uptrend into a sell", () => {
  const falling = setup(downtrendBars(), "INTC");
  assert.equal(falling.label, SETUP.AVOID);
  assert.equal(falling.trendGate, false);
  assert.ok(falling.rsi < 35);
  assert.equal(falling.rsiWarning, "washout");
  assert.match(falling.reason, /not a dip to buy/);
  const read = technicalReadFromQuote({ setup_label: falling.label, setup_reason: falling.reason, rsi: falling.rsi });
  assert.equal(read.sig, "Sell");
  assert.notEqual(read.sig, "Buy");

  const climbing = setup(uptrendBars(), "GOOGL");
  assert.equal(climbing.label, SETUP.UPTREND);
  assert.equal(climbing.trendGate, true);
  assert.equal(climbing.score, undefined);
  const climbingRead = technicalReadFromQuote(setupToQuoteFields(climbing));
  assert.equal(climbingRead.sig, "Hold");
  assert.notEqual(climbingRead.sig, "Sell");
});

test("pullbacks tag a rising 20-day or 50-day average and carry an ATR stop", () => {
  const to20 = setup(pullback20Bars(), "AAPL");
  assert.equal(to20.label, SETUP.PULLBACK);
  assert.equal(to20.pullbackTo, "20");
  assert.match(to20.reason, /20-day/);

  const to50 = setup(pullback50Bars(), "MSFT");
  assert.equal(to50.label, SETUP.PULLBACK);
  assert.equal(to50.pullbackTo, "50");
  assert.ok(to50.stop < to50.price);
  assert.ok(Math.abs(to50.price - to50.atr14 * 2 - to50.stop) < 0.02);
  const size = sizeAtOnePercentRisk(to50.riskPct);
  assert.ok(size.weightPct > 0);
  assert.match(to50.reason, /1% portfolio risk/);
});

test("relative strength is the stock return minus SPY, and rank 1 is the strongest", () => {
  const stock = Array.from({ length: 260 }, (_, index) => ({
    date: `2025-01-${String((index % 28) + 1).padStart(2, "0")}`,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
  }));
  // Unique increasing dates so the windows land on the intended bars.
  stock.forEach((bar, index) => {
    const day = new Date(Date.UTC(2024, 0, 1 + index));
    bar.date = day.toISOString().slice(0, 10);
  });
  const market = stock.map((bar) => ({ ...bar, close: 100, high: 101, low: 99 }));
  stock[stock.length - 1].close = 200;
  stock[stock.length - 1 - 63].close = 200 / 1.2;
  stock[stock.length - 1 - 126].close = 200 / 1.5;
  stock[stock.length - 1 - 252].close = 200 / 2;
  market[market.length - 1].close = 110;
  market[market.length - 1 - 63].close = 110 / 1.05;
  market[market.length - 1 - 126].close = 110 / 1.1;
  market[market.length - 1 - 252].close = 110 / 1.25;

  const result = analyzeSymbol(stock, market, { symbol: "RS" });
  assert.ok(Math.abs(result.rs3m - ((1.2 - 1) - (1.05 - 1)) * 100) < 0.05);
  assert.ok(Math.abs(result.rs6m - ((1.5 - 1) - (1.1 - 1)) * 100) < 0.05);
  assert.ok(Math.abs(result.rs12m - ((2 - 1) - (1.25 - 1)) * 100) < 0.05);
  // 50% of 12-month, 30% of 6-month, 20% of 3-month.
  const expected = result.rs12m * 0.5 + result.rs6m * 0.3 + result.rs3m * 0.2;
  assert.ok(Math.abs(result.rsComposite - expected) < 0.05);

  const ranked = assignRelativeStrengthRanks([
    { symbol: "WEAK", rsComposite: 1 },
    { symbol: "STRONG", rsComposite: 40 },
    { symbol: "MID", rsComposite: 10 },
    { symbol: "SPY", rsComposite: 0 },
    { symbol: "NEW", rsComposite: null },
  ]);
  const bySymbol = Object.fromEntries(ranked.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.STRONG.rsRank, 1);
  assert.equal(bySymbol.STRONG.rsPercentile, 100);
  assert.equal(bySymbol.MID.rsRank, 2);
  assert.equal(bySymbol.WEAK.rsRank, 3);
  assert.equal(bySymbol.SPY.rsRank, null);
  assert.equal(bySymbol.NEW.rsRank, null);
});

test("a short history is not labeled a downtrend, and the stop size respects the 25% cap", () => {
  const thin = setup(thinBars(), "ARM");
  assert.equal(thin.label, SETUP.THIN);
  assert.match(thin.reason, /200 trading days/);
  assert.equal(technicalReadFromQuote(setupToQuoteFields(thin)).sig, null);

  const tinyRisk = sizeAtOnePercentRisk(2);
  assert.equal(tinyRisk.overCap, true);
  assert.match(formatSize(2), /over the 25% cap/);
  const wideRisk = sizeAtOnePercentRisk(8);
  assert.equal(wideRisk.overCap, false);
});

test("missing setup columns can be stripped without dropping the price", () => {
  assert.equal(isMissingSetupColumnError({ message: "Could not find the 'setup_label' column of 'quotes'" }), true);
  assert.equal(isMissingSetupColumnError({ message: "connection reset" }), false);
  const legacy = withoutSetupColumns({
    symbol: "AAPL",
    price: 10,
    setup_label: "Breakout",
    rs_3m: 4,
    suggested_stop: 9,
    sma_20: 11,
  });
  assert.deepEqual(legacy, { symbol: "AAPL", price: 10 });
});

test("Twelve Data bars are stored oldest-first, and SPY is only one extra call", () => {
  const bars = barsFromTwelvePayload({
    values: [
      { datetime: "2026-10-29", open: "3", high: "4", low: "2", close: "3.5", volume: "30" },
      { datetime: "2026-10-28", open: "2", high: "3", low: "1", close: "2.5", volume: "20" },
      { datetime: "2026-10-28", open: "9", high: "9", low: "9", close: "9", volume: "9" },
    ],
  });
  assert.deepEqual(bars.map((bar) => bar.date), ["2026-10-28", "2026-10-29"]);
  assert.equal(bars[0].close, 2.5);

  const symbols = ["AAPL", "MSFT", "NVDA", "SPY"];
  assert.deepEqual(queueForShard(symbols, 0, 2), ["AAPL", "NVDA"]);
  assert.deepEqual(queueForShard(["AAPL", "MSFT", "NVDA"], 0, 2), ["SPY", "AAPL", "NVDA"]);
  assert.equal(queueForShard(["AAPL", "MSFT"], 1, 2).includes("SPY"), false);
  assert.ok(TWELVE_DATA_PAUSE_MS >= 8000);
  assert.ok(OUTPUT_SIZE >= 253);
  assert.equal(canFetchAnother({ startedAt: 0, now: 0, callsSoFar: 0 }), true);
  assert.equal(canFetchAnother({ startedAt: 0, now: 45000, callsSoFar: 1 }), false);
  assert.equal(canFetchAnother({ startedAt: 0, now: 1000, callsSoFar: 1 }), true);
});

test("the nightly quote row is built from daily bars, including the exit stop", () => {
  const bars = breakoutTodayBars();
  const row = buildQuotePayload({
    symbol: "NVDA",
    bars,
    spyBars: spy,
    updatedAt: "2026-10-29T21:00:00.000Z",
  });
  assert.equal(row.setup_label, SETUP.BREAKOUT);
  assert.equal(row.bar_date, bars[bars.length - 1].date);
  assert.ok(row.donchian_upper < bars[bars.length - 1].high);
  assert.equal(row.suggested_stop < row.price, true);
  assert.equal(typeof row.chandelier_stop, "number");
  assert.equal(row.below_sma50_streak, 0);
  assert.equal(historyRow(row).recorded_at, "2026-10-29T21:00:00.000Z");
});

test("the preview book shows each setup a swing trader needs to tell apart", () => {
  const sample = buildSwingSample();
  const bySymbol = Object.fromEntries(sample.rows.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.NVDA.label, SETUP.BREAKOUT);
  assert.equal(bySymbol.AMD.label, SETUP.BREAKOUT);
  assert.equal(bySymbol.AMD.daysSinceBreakout, 3);
  assert.equal(bySymbol.AAPL.label, SETUP.PULLBACK);
  assert.equal(bySymbol.MSFT.label, SETUP.PULLBACK);
  assert.equal(bySymbol.GOOGL.label, SETUP.UPTREND);
  assert.ok(bySymbol.GOOGL.rsi < 75);
  assert.equal(bySymbol.INTC.label, SETUP.AVOID);
  assert.equal(bySymbol.ARM.label, SETUP.THIN);
  assert.equal(bySymbol.LLY.label, SETUP.UPTREND);
  assert.match(bySymbol.LLY.reason, /extended/);
  assert.ok(bySymbol.NVDA.rsComposite > bySymbol.INTC.rsComposite);
  const ranked = assignRelativeStrengthRanks(sample.rows);
  const leader = ranked.find((row) => row.rsRank === 1);
  assert.equal(leader.symbol, "LLY");
  assert.ok(ranked.find((row) => row.symbol === "NVDA").rsRank < ranked.find((row) => row.symbol === "INTC").rsRank);
  assert.equal(ranked.find((row) => row.symbol === "ARM").rsRank, null);
});
