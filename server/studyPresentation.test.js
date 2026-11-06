import assert from "node:assert/strict";
import test from "node:test";
import {
  eventsToCsv,
  filterSignals,
  forwardReturnSentences,
  historyWindow,
  outcomeWords,
  pageSignals,
  studySetups,
} from "../src/lib/setupStudy.js";
import { breakoutTodayBars, pullback20Bars, spyBars } from "../src/lib/swingSample.js";

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

test("ticker rows, the average, and the download use the same signals", () => {
  const study = studySetups({
    NVDA: breakoutTodayBars(),
    AAPL: pullback20Bars(),
    SPY: spyBars(),
  });
  const text = forwardReturnSentences(study).join(" ");
  assert.match(text, /does not|not the full Buy rule|not evidence the setup works/);
  assert.match(text, /company figures|earnings|Buy rule/i);
  assert.doesNotMatch(text, /disregard|ignore the table/i);

  const span = historyWindow(study);
  assert.ok(span.first && span.last && span.first <= span.last);
  assert.match(text, new RegExp(span.first));

  for (const setup of ["Breakout", "Pullback"]) {
    const summary = study.summaries[setup];
    for (const horizon of [5, 10, 20]) {
      const bucket = summary.horizons[horizon];
      assert.equal(bucket.completed + bucket.pending + bucket.ineligible, summary.independent);
      const finished = study.events.filter((event) => (
        event.setup === setup
        && event.horizon === horizon
        && event.independent
        && event.status === "completed"
        && Number.isFinite(event.stockReturn)
      ));
      assert.equal(finished.length, bucket.completed);
      if (finished.length) {
        assert.ok(Math.abs(mean(finished.map((event) => event.stockReturn)) - bucket.avgReturn) < 1e-9);
      }
    }
  }

  const csv = eventsToCsv(study.events).trim().split("\n");
  assert.equal(csv.length, study.events.length + 1);
  const symbol = study.signals[0].symbol;
  const filtered = filterSignals(study, { symbol, setup: study.signals[0].setup });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((signal) => signal.symbol === symbol));
  assert.ok(csv.some((line) => line.startsWith(`${symbol},`)));
  const page = pageSignals(filtered, 1, 2);
  assert.equal(page.rows.length, Math.min(2, filtered.length));
  assert.equal(page.total, filtered.length);
  const next = pageSignals(filtered, 99, 2);
  assert.equal(next.page, next.pages);
  assert.equal(outcomeWords("pending"), "Not finished yet");
  assert.equal(outcomeWords("ineligible_gap"), "Dropped — gap in the dates");
  const pending = study.events.find((event) => event.status === "pending");
  if (pending) assert.equal(outcomeWords(pending.status), "Not finished yet");
});
