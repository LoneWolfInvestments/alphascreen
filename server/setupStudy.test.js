import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSymbol } from "../src/lib/swingSetups.js";
import { outcomesForSignal, studySetups } from "../src/lib/setupStudy.js";
import { breakoutTodayBars, spyBars } from "../src/lib/swingSample.js";

function bar(date, open, close) {
  return { date, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 };
}

test("the entry is the next open, horizons share dates with SPY, and gaps are not filled", () => {
  const bars = [
    bar("2026-01-02", 100, 100),
    bar("2026-01-05", 110, 112),
    bar("2026-01-06", 112, 113),
    bar("2026-01-07", 113, 114),
    bar("2026-01-08", 114, 115),
    bar("2026-01-09", 115, 121),
  ];
  const spy = [
    bar("2026-01-05", 400, 401),
    bar("2026-01-06", 401, 402),
    bar("2026-01-07", 402, 403),
    bar("2026-01-08", 403, 404),
    bar("2026-01-09", 404, 408),
  ];
  const map = new Map(spy.map((item) => [item.date, item]));
  const outcomes = outcomesForSignal({ bars, spyByDate: map, signalIndex: 0 });
  const five = outcomes.find((item) => item.horizon === 5);
  assert.equal(five.status, "completed");
  assert.equal(five.entryDate, "2026-01-05");
  assert.equal(five.entryOpen, 110);
  assert.equal(five.exitDate, "2026-01-09");
  assert.ok(Math.abs(five.stockReturn - (121 / 110 - 1)) < 1e-12);
  assert.ok(Math.abs(five.spyReturn - (408 / 400 - 1)) < 1e-12);
  assert.ok(Math.abs(five.excess - (five.stockReturn - five.spyReturn)) < 1e-12);
  assert.equal(outcomes.find((item) => item.horizon === 10).status, "pending");
  assert.equal(outcomes.find((item) => item.horizon === 20).status, "pending");

  const missingSpy = outcomesForSignal({
    bars,
    spyByDate: new Map([["2026-01-05", spy[0]]]),
    signalIndex: 0,
  }).find((item) => item.horizon === 5);
  assert.equal(missingSpy.status, "completed");
  assert.equal(missingSpy.spyReturn, null);
  assert.equal(missingSpy.excess, null);
  assert.ok(missingSpy.stockReturn > 0);

  const gapped = [
    bar("2026-01-02", 100, 100),
    bar("2026-01-05", 110, 112),
    bar("2026-01-20", 130, 140),
  ];
  const gap = outcomesForSignal({ bars: gapped, spyByDate: map, signalIndex: 0 }).find((item) => item.horizon === 5);
  assert.equal(gap.status, "ineligible_gap");
  assert.equal(gap.stockReturn, null);

  const noOpen = [bar("2026-01-02", 100, 100), { ...bar("2026-01-05", 110, 112), open: null }];
  const open = outcomesForSignal({ bars: noOpen, spyByDate: map, signalIndex: 0 })[0];
  assert.equal(open.status, "ineligible_open");
  assert.equal(open.stockReturn, null);
});

test("a future breakout does not create an earlier signal", () => {
  const bars = breakoutTodayBars();
  const spy = spyBars();
  const last = bars.length - 1;
  const past = analyzeSymbol(bars.slice(0, last), spy.filter((item) => item.date <= bars[last - 1].date), { symbol: "NVDA" });
  const study = studySetups({ NVDA: bars, SPY: spy });
  const prior = study.signals.filter((signal) => signal.signalDate === bars[last - 1].date);
  if (past.label === "Breakout" || past.label === "Pullback") {
    assert.equal(prior.length, 1);
    assert.equal(prior[0].setup, past.label);
  } else {
    assert.equal(prior.length, 0);
  }

  const mutated = bars.map((item) => ({ ...item }));
  mutated[last] = { ...mutated[last], close: mutated[last].close * 1.5, high: mutated[last].high * 1.5 };
  const again = studySetups({ NVDA: mutated, SPY: spy });
  const earlier = (result) => result.signals
    .filter((signal) => signal.signalDate < bars[last].date)
    .map((signal) => `${signal.signalDate}|${signal.setup}`)
    .join(",");
  assert.equal(earlier(study), earlier(again));

  const pending = study.events.filter((event) => event.signalDate === bars[last].date && event.horizon === 5);
  if (pending.length) assert.equal(pending[0].status, "pending");
});

test("overlapping signals are disclosed and a short history stays empty", () => {
  const bars = breakoutTodayBars();
  const study = studySetups({
    AAA: bars,
    ARM: bars.slice(0, 40),
    SPY: spyBars(),
    fundamentals: [{ pe_ratio: 10 }],
  });
  assert.equal(study.coverage.find((row) => row.symbol === "ARM").status, "warmup");
  assert.equal(study.signals.some((signal) => signal.symbol === "ARM"), false);
  const raw = study.summaries.Breakout.raw + study.summaries.Pullback.raw;
  const used = study.summaries.Breakout.independent + study.summaries.Pullback.independent;
  assert.ok(raw >= used);
  assert.match(study.notes.join(" "), /fundamentals are not a filter/);
  assert.match(study.notes.join(" "), /not a test of the stop/);
});
