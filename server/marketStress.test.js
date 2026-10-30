import assert from "node:assert/strict";
import test from "node:test";
import { fetchCboeSnapshot } from "./cboeHistory.js";
import { sampleMarketStressRows } from "../src/lib/marketStressSample.js";
import {
  alignCboeCloses,
  breadthFromSeries,
  buildStressRow,
  classifyRegime,
  closesBySymbol,
  parseCboeDailyCsv,
  parseCboeDate,
  trendFromCloses,
} from "../src/lib/marketStress.js";

const calm = {
  vix: 17.2,
  vix3m: 19.37,
  skew: 130,
  spyAboveSma200: true,
  spySma200Rising: true,
  breadthPct: 62,
  breadthTotal: 28,
};

test("Cboe dates and the SKEW column parse, including a byte-order mark", () => {
  assert.equal(parseCboeDate("10/29/2026"), "2026-10-29");
  assert.equal(parseCboeDate("02/31/2026"), null);
  const text = "\uFEFFDATE,SKEW\n10/28/2026,148.74\n10/29/2026,151.03\n";
  const rows = parseCboeDailyCsv(text, "SKEW");
  assert.deepEqual(rows.at(-1), { date: "2026-10-29", value: 151.03 });
});

test("VIX and VIX3M align on the newest shared day when SKEW is a day behind", () => {
  const aligned = alignCboeCloses({
    vix: [{ date: "2026-10-28", value: 16.91 }, { date: "2026-10-29", value: 17.2 }],
    vix3m: [{ date: "2026-10-28", value: 19.22 }, { date: "2026-10-29", value: 19.37 }],
    skew: [{ date: "2026-10-28", value: 148.74 }],
  });
  assert.equal(aligned.asOf, "2026-10-29");
  assert.equal(aligned.vix, 17.2);
  assert.equal(aligned.skew, null);
});

test("a calm tape with a rich SKEW stays amber, and a broken trend is red", () => {
  const healthy = classifyRegime(calm);
  assert.equal(healthy.regime, "green");
  assert.match(healthy.reason, /Favorable for swing longs/);
  assert.equal(healthy.vixRatio, 0.888);

  const richSkew = classifyRegime({ ...calm, skew: 151.03 });
  assert.equal(richSkew.regime, "amber");
  assert.match(richSkew.reason, /SKEW is 151/);
  assert.match(richSkew.reason, /keeps the light amber/);

  const narrow = classifyRegime({ ...calm, breadthPct: 32, breadthTotal: 28 });
  assert.equal(narrow.regime, "amber");
  assert.match(narrow.reason, /32%/);

  for (const patch of [
    { spyAboveSma200: false },
    { vix: 31 },
    { vix: 22, vix3m: 20 },
  ]) {
    assert.equal(classifyRegime({ ...calm, ...patch }).regime, "red");
  }
});

test("flat curve, VIX at 20, and missing SPY stay amber rather than green or red", () => {
  assert.equal(classifyRegime({ ...calm, vix: 20, vix3m: 24 }).regime, "amber");
  assert.equal(classifyRegime({ ...calm, vix: 19, vix3m: 20 }).regime, "amber");
  assert.equal(classifyRegime({ ...calm, vix: 30, vix3m: 40 }).regime, "amber");
  const missing = classifyRegime({ ...calm, spyAboveSma200: null, spySma200Rising: null });
  assert.equal(missing.regime, "amber");
  assert.match(missing.reason, /Not a full reading/);
  assert.equal(classifyRegime({ ...calm, vix: 34, spyAboveSma200: null }).regime, "red");
});

test("the 200-day average is rising only when the last month of it is higher", () => {
  const rising = Array.from({ length: 230 }, (_, i) => 100 + i);
  const up = trendFromCloses(rising);
  assert.equal(up.above, true);
  assert.equal(up.rising, true);

  const falling = Array.from({ length: 230 }, (_, i) => 400 - i);
  const down = trendFromCloses(falling);
  assert.equal(down.above, false);
  assert.equal(down.rising, false);

  assert.equal(trendFromCloses(rising.slice(0, 199)).sma200, null);
});

test("breadth ignores short histories and prices more than five days old", () => {
  const longUp = Array.from({ length: 210 }, (_, i) => ({ date: iso(i), close: 100 + i }));
  const longDown = Array.from({ length: 210 }, (_, i) => ({ date: iso(i), close: 400 - i }));
  const short = Array.from({ length: 40 }, (_, i) => ({ date: iso(170 + i), close: 50 + i }));
  const asOf = longUp.at(-1).date;
  const stale = longUp.map((bar) => ({ ...bar, date: shift(bar.date, -30) }));
  const result = breadthFromSeries([longUp, longDown, short, stale], asOf);
  assert.equal(result.total, 2);
  assert.equal(result.above, 1);
  assert.equal(result.pct, 50);
});

test("a stress row uses fresh SPY bars and says so when they are a day behind", () => {
  const spy = Array.from({ length: 230 }, (_, i) => ({ date: iso(i), close: 100 + i }));
  const names = [spy.map((bar) => ({ ...bar }))];
  const asOf = shift(spy.at(-1).date, 1);
  const row = buildStressRow({
    asOf,
    vix: 17.2,
    vix3m: 19.37,
    skew: 130,
    spySeries: spy,
    nameSeries: names,
  });
  assert.equal(row.regime, "green");
  assert.equal(row.spy_above_sma200, true);
  assert.match(row.reason, /SPY's saved prices are as of/);
  assert.equal(row.breadth_total, 1);
});

test("the preview history mixes lights and ends on the October 29 amber reading", () => {
  const rows = sampleMarketStressRows();
  assert.equal(rows.length, 30);
  assert.equal(rows.at(-1).as_of, "2026-10-29");
  assert.equal(rows.at(-1).vix, 17.2);
  assert.equal(rows.at(-1).regime, "amber");
  assert.equal(rows.some((row) => row.regime === "red"), true);
  assert.equal(rows.some((row) => row.regime === "green"), true);
  assert.equal(rows.some((row) => /sample/i.test(row.reason)), false);
});

test("the Cboe fetch follows three files and keeps the shared close", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, userAgent: options.headers["User-Agent"], redirect: options.redirect });
    let body = "DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,1,1,1,16.91\n10/29/2026,1,1,1,17.20\n";
    if (url.includes("VIX3M")) body = "DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,1,1,1,19.22\n10/29/2026,1,1,1,19.37\n";
    if (url.includes("SKEW")) body = "DATE,SKEW\n10/29/2026,151.03\n";
    return { ok: true, status: 200, text: async () => body };
  };
  const got = await fetchCboeSnapshot(fetchImpl, { pauseMs: 0 });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].redirect, "follow");
  assert.match(calls[0].userAgent, /personal dashboard/);
  assert.equal(got.asOf, "2026-10-29");
  assert.equal(got.vix, 17.2);
  assert.equal(got.vix3m, 19.37);
  assert.equal(got.skew, 151.03);
});

test("duplicate daily bars for one symbol keep the later close", () => {
  const map = closesBySymbol([
    { symbol: "spy", bar_date: "2026-10-28", close: 10 },
    { symbol: "SPY", bar_date: "2026-10-29", close: 11 },
    { symbol: "SPY", bar_date: "2026-10-29", close: 12 },
  ]);
  assert.deepEqual(map.get("SPY"), [
    { date: "2026-10-28", close: 10 },
    { date: "2026-10-29", close: 12 },
  ]);
});

function iso(offset) {
  const date = new Date("2025-01-02T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function shift(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
