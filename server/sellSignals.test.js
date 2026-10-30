import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_THEMES,
  blocksNewBuy,
  buildSellBook,
  isEarningsSoon,
  nyDateString,
  pnlAtStop,
  themeForHolding,
  tradingDaysUntil,
  trimToLimit,
} from "../src/lib/sellSignals.js";
import { sampleSellBook } from "../src/lib/sellSignalsSample.js";
import { computeSellLevels, isMissingSellColumnError, withoutSellColumns } from "./computeSellLevels.js";
import { dateWindows, isMissingEarningsTableError, pickNextEarnings } from "./earningsCalendar.js";

test("trading days skip weekends and NYSE holidays", () => {
  assert.equal(tradingDaysUntil("2026-10-30", "2026-10-30"), 0);
  assert.equal(tradingDaysUntil("2026-10-30", "2026-11-04"), 3);
  assert.equal(tradingDaysUntil("2026-10-30", "2026-11-06"), 5);
  assert.equal(tradingDaysUntil("2026-10-30", "2026-11-09"), 6);
  assert.equal(tradingDaysUntil("2026-10-30", "2026-10-29"), null);
  // Wed Nov 25 through Mon Nov 30, 2026 skips Thanksgiving Thursday.
  assert.equal(tradingDaysUntil("2026-11-25", "2026-11-30"), 2);
  assert.equal(isEarningsSoon("2026-11-06", "2026-10-30"), true);
  assert.equal(isEarningsSoon("2026-11-09", "2026-10-30"), false);
});

test("New York date follows the exchange calendar, not UTC", () => {
  assert.equal(nyDateString(new Date("2026-10-30T03:30:00Z")), "2026-10-29");
  assert.equal(nyDateString(new Date("2026-10-30T15:00:00Z")), "2026-10-30");
});

test("names reporting within 5 trading days are blocked from new buys", () => {
  assert.equal(blocksNewBuy({
    held: false,
    fundamentalSignal: "Buy",
    technicalSignal: "Buy",
    earningsSoon: true,
  }), true);
  assert.equal(blocksNewBuy({
    held: true,
    fundamentalSignal: "Buy",
    technicalSignal: "Buy",
    earningsSoon: true,
  }), false);
  assert.equal(blocksNewBuy({
    held: false,
    fundamentalSignal: "Buy",
    technicalSignal: "Hold",
    earningsSoon: true,
  }), false);
});

test("trim dollars bring the weight back to the limit after the sale", () => {
  const total = 100000;
  const trim = trimToLimit(30000, total, 0.25);
  assert.ok(Math.abs(trim - (5000 / 0.75)) < 0.01);
  assert.ok(Math.abs((30000 - trim) / (total - trim) - 0.25) < 1e-9);
  assert.equal(trimToLimit(25000, total, 0.25), null);
  const themeTrim = trimToLimit(45000, total, 0.4);
  assert.ok(Math.abs(themeTrim - (5000 / 0.6)) < 0.01);
  assert.equal(trimToLimit(40000, total, 0.4), null);
});

test("blank themes use the built-in groups and a saved theme wins", () => {
  assert.equal(themeForHolding("nvda", "").name, "Semis/AI");
  assert.equal(themeForHolding("NVDA", "Chips").name, "Chips");
  assert.equal(themeForHolding("ZZZZ", null).name, "Unclassified");
  assert.equal(DEFAULT_THEMES.CCJ, "Uranium");
  assert.equal(DEFAULT_THEMES.ASTS, "Space");
});

test("gain or loss at the stop is measured against cost, not the latest price", () => {
  const pnl = pnlAtStop(176, 90, 100);
  assert.equal(pnl.dollars, 8600);
  assert.ok(Math.abs(pnl.pct - ((176 - 90) / 90) * 100) < 1e-9);
  assert.equal(pnlAtStop(176, 0, 100).dollars, null);
});

test("the sample book lights up exit, trim, earnings, trend, and concentration", () => {
  const book = sampleSellBook();
  const byTicker = Object.fromEntries(book.rows.map((row) => [row.ticker, row]));

  assert.equal(byTicker.NVDA.status, "red");
  assert.ok(byTicker.NVDA.flags.some((flag) => flag.code === "stop"));
  assert.ok(byTicker.NVDA.flags.some((flag) => flag.code === "position"));
  assert.ok(byTicker.NVDA.flags.some((flag) => flag.code === "theme"));
  assert.match(byTicker.NVDA.why.join(" "), /Exit signal/);
  assert.match(byTicker.NVDA.why.join(" "), /Sell about/);

  assert.equal(byTicker.MU.status, "amber");
  assert.ok(byTicker.MU.flags.some((flag) => flag.code === "rsi"));
  assert.ok(byTicker.MU.flags.some((flag) => flag.code === "theme"));
  assert.equal(byTicker.MU.flags.some((flag) => flag.code === "position"), false);

  assert.equal(byTicker.LLY.status, "amber");
  assert.ok(byTicker.LLY.flags.some((flag) => flag.code === "stretch"));

  assert.equal(byTicker.AAPL.status, "amber");
  assert.deepEqual(byTicker.AAPL.flags.map((flag) => flag.code), ["earnings"]);
  assert.match(byTicker.AAPL.why.join(" "), /3 trading days/);

  assert.equal(byTicker.MSFT.status, "info");
  assert.ok(byTicker.MSFT.flags.some((flag) => flag.code === "trend"));
  assert.match(byTicker.MSFT.why.join(" "), /not an instruction to sell/);

  for (const ticker of ["NOW", "CCJ", "DNN", "NXE", "ASTS"]) {
    assert.equal(byTicker[ticker].status, "green", ticker);
    assert.match(byTicker[ticker].why.join(" "), /All clear/);
    assert.match(byTicker[ticker].why.join(" "), /Trailing stop/);
  }

  const semis = book.themes.find((theme) => theme.name === "Semis/AI");
  assert.ok(semis.over);
  assert.ok(Math.abs(semis.weight - 0.45) < 0.001);
  assert.deepEqual(semis.tickers, ["MU", "NVDA"]);
  const uranium = book.themes.find((theme) => theme.name === "Uranium");
  assert.equal(uranium.over, false);

  assert.equal(book.asOf, "2026-10-29");
  assert.equal(book.rows[0].ticker, "NVDA");
});

test("RSI of 80 and a 40% stretch sit on the stated side of the line", () => {
  const base = {
    holdings: [{ ticker: "TEST", shares: 10, cost_basis: 50, theme: "Solo" }],
    today: "2026-10-30",
  };
  const hot = buildSellBook({
    ...base,
    quotesBySymbol: {
      TEST: { price: 140, rsi: 80, sma_50: 100, chandelier_stop: 90, high_22: 150, atr_22: 20, bar_date: "2026-10-29" },
    },
    earningsBySymbol: {},
  });
  assert.equal(hot.rows[0].flags.some((flag) => flag.code === "rsi"), false);
  assert.equal(hot.rows[0].flags.some((flag) => flag.code === "stretch"), true);

  const warm = buildSellBook({
    ...base,
    quotesBySymbol: {
      TEST: { price: 139, rsi: 80.01, sma_50: 100, chandelier_stop: 90, bar_date: "2026-10-29" },
    },
    earningsBySymbol: {},
  });
  assert.ok(warm.rows[0].flags.some((flag) => flag.code === "rsi"));
  assert.equal(warm.rows[0].flags.some((flag) => flag.code === "stretch"), false);
  assert.equal(warm.rows[0].status, "amber");
});

test("one day under the 50-day average does not fire, and an equal stop does not", () => {
  const book = buildSellBook({
    holdings: [
      { ticker: "TEST", shares: 1, cost_basis: 10, theme: null },
      { ticker: "BALL", shares: 4, cost_basis: 10, theme: null },
    ],
    quotesBySymbol: {
      TEST: { price: 100, rsi: 50, sma_50: 110, chandelier_stop: 100, below_sma50_streak: 1, bar_date: "2026-10-29" },
      BALL: { price: 100, rsi: 50, sma_50: 90, chandelier_stop: 80, below_sma50_streak: 0, bar_date: "2026-10-29" },
    },
    earningsBySymbol: {},
    today: "2026-10-30",
  });
  const testRow = book.rows.find((row) => row.ticker === "TEST");
  assert.equal(testRow.status, "green");
  assert.equal(testRow.flags.length, 0);
});

test("unclassified holdings are not rolled into the theme limit", () => {
  const tickers = ["AAA", "BBB", "CCC", "DDD", "EEE"];
  const book = buildSellBook({
    holdings: tickers.map((ticker) => ({ ticker, shares: 20, cost_basis: 10, theme: "" })),
    quotesBySymbol: Object.fromEntries(tickers.map((ticker) => [ticker, {
      price: 10, rsi: 50, sma_50: 10, chandelier_stop: 8, bar_date: "2026-10-29",
    }])),
    earningsBySymbol: {},
    today: "2026-10-30",
  });
  assert.equal(book.themes.length, 0);
  assert.equal(book.rows.every((row) => row.status === "green"), true);
});

test("sell levels use the 22-day high, ATR(22), and a two-day break of the 50-day average", () => {
  const closes = Array.from({ length: 60 }, () => 100);
  const highs = Array.from({ length: 60 }, () => 101);
  const lows = Array.from({ length: 60 }, () => 99);
  highs[50] = 110;
  closes[58] = 90;
  closes[59] = 90;

  const levels = computeSellLevels({ closes, highs, lows });
  assert.equal(levels.high_22, 110);
  assert.ok(levels.atr_22 > 0);
  assert.equal(levels.chandelier_stop, levels.high_22 - 3 * levels.atr_22);
  assert.equal(levels.below_sma50_streak, 2);

  const short = computeSellLevels({
    closes: Array.from({ length: 10 }, () => 5),
    highs: Array.from({ length: 10 }, () => 6),
    lows: Array.from({ length: 10 }, () => 4),
  });
  assert.equal(short.high_22, null);
  assert.equal(short.chandelier_stop, null);
  assert.equal(short.below_sma50_streak, 0);
});

test("a missing sell-column error can fall back to the old quote payload", () => {
  assert.equal(isMissingSellColumnError({ message: "Could not find the 'atr_22' column of 'quotes' in the schema cache" }), true);
  assert.equal(isMissingSellColumnError({ message: "connection reset" }), false);
  const legacy = withoutSellColumns({
    symbol: "AAPL",
    price: 10,
    atr_22: 1,
    high_22: 12,
    chandelier_stop: 9,
    below_sma50_streak: 2,
    bar_date: "2026-10-29",
  });
  assert.deepEqual(legacy, { symbol: "AAPL", price: 10 });
});

test("earnings windows and the next date pick stay inside the free calendar pull", () => {
  assert.deepEqual(dateWindows("2026-10-30"), [
    { from: "2026-10-30", to: "2027-01-27" },
    { from: "2027-01-28", to: "2027-04-27" },
  ]);
  const next = pickNextEarnings([
    { symbol: "aapl", date: "2026-11-04" },
    { symbol: "AAPL", date: "2026-08-01" },
    { symbol: "AAPL", date: "2027-01-28" },
    { symbol: "MSFT", date: "2026-10-29" },
    { symbol: "", date: "2026-11-01" },
  ], "2026-10-30");
  assert.equal(next.get("AAPL"), "2026-11-04");
  assert.equal(next.has("MSFT"), false);
  assert.equal(isMissingEarningsTableError({
    message: "Could not find the table 'public.earnings_calendar' in the schema cache",
  }), true);
});
