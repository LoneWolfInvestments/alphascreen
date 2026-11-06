// Nightly record of Buy candidates from rows already in the database.
// No price vendor and no company-data vendor are called here.

import { readBusinessFundamentals } from "../src/lib/businessFundamentals.js";
import { presentRegime } from "../src/lib/marketStress.js";
import {
  isTerminal,
  observeSymbol,
  planCapture,
  reviewEpisode,
  universeReady,
} from "../src/lib/modelSignals.js";
import { lastCompletedSession } from "../src/lib/sessionClock.js";
import { BENCHMARK_SYMBOL } from "../src/lib/swingSetups.js";

function day(value) {
  return String(value || "").slice(0, 10);
}

function earningsFor(symbol, calendarBySymbol, scoreRow) {
  const calendar = calendarBySymbol.get(symbol);
  if (calendar) return { date: calendar.date || null, asOf: calendar.updatedAt || null };
  return { date: scoreRow?.next_earnings_date || null, asOf: null };
}

export async function captureNight(repo, now = new Date()) {
  const session = lastCompletedSession(now);
  if (!session) return { code: 200, body: { action: "no_session", inserted: 0, reviewed: 0 } };

  const watchlist = await repo.watchlist();
  const quotes = await repo.quotes();
  const quotesBySymbol = {};
  for (const row of quotes || []) quotesBySymbol[String(row.symbol || "").toUpperCase()] = row;
  const universe = universeReady((watchlist || []).map((row) => row.symbol), quotesBySymbol, session);

  const open = await repo.openEpisodes();
  const earliest = (open || []).reduce((min, row) => {
    const sessionDay = day(row.signal_session);
    return !min || sessionDay < min ? sessionDay : min;
  }, null);
  const barSymbols = [...new Set([...(open || []).map((row) => row.symbol), BENCHMARK_SYMBOL])];
  const barRows = earliest ? await repo.bars(barSymbols, earliest) : [];
  const barsBySymbol = new Map();
  for (const row of barRows || []) {
    const symbol = String(row.symbol || "").toUpperCase();
    if (!barsBySymbol.has(symbol)) barsBySymbol.set(symbol, []);
    barsBySymbol.get(symbol).push(row);
  }
  const spyBars = barsBySymbol.get(BENCHMARK_SYMBOL) || [];

  const reviews = [];
  const stillOpen = [];
  for (const episode of open || []) {
    const outcome = reviewEpisode({
      snapshot: episode,
      bars: barsBySymbol.get(episode.symbol) || [],
      spyBars,
      lastSession: session,
    });
    reviews.push({ signal_id: episode.id, symbol: episode.symbol, ...outcome });
    if (!isTerminal(outcome.status)) stillOpen.push(episode.symbol);
  }
  if (reviews.length) await repo.saveOutcomes(reviews);

  if (universe.symbols.length === 0) {
    return { code: 200, body: { action: "empty_watchlist", session, inserted: 0, reviewed: reviews.length, behind: 0 } };
  }
  if (!universe.complete) {
    return {
      code: 200,
      body: {
        action: "incomplete_universe",
        session,
        inserted: 0,
        reviewed: reviews.length,
        behind: universe.behind.length,
      },
    };
  }

  const states = await repo.states();
  const alreadyRecorded = universe.symbols.every((symbol) => (states || []).some((row) => (
    String(row.symbol).toUpperCase() === symbol && day(row.last_session) === session
  )));
  if (alreadyRecorded) {
    return { code: 200, body: { action: "already_recorded", session, inserted: 0, reviewed: reviews.length, behind: 0 } };
  }

  const [fundamentalRows, calendarRows, stressRow] = await Promise.all([
    repo.fundamentals(),
    repo.earnings(),
    repo.stress(),
  ]);
  const businessBySymbol = new Map();
  for (const row of fundamentalRows || []) {
    businessBySymbol.set(String(row.ticker || "").toUpperCase(), { row, read: readBusinessFundamentals(row, { now }) });
  }
  const calendarBySymbol = new Map();
  for (const row of calendarRows || []) {
    calendarBySymbol.set(String(row.symbol || "").toUpperCase(), {
      date: row.next_earnings_date || null,
      updatedAt: row.updated_at || null,
    });
  }
  const regime = presentRegime(stressRow, now);
  const observedAt = now.toISOString();
  const observations = universe.symbols.map((symbol) => {
    const business = businessBySymbol.get(symbol);
    const earnings = earningsFor(symbol, calendarBySymbol, business?.row);
    return observeSymbol({
      symbol,
      quote: quotesBySymbol[symbol],
      business: business?.read || null,
      earningsDate: earnings.date,
      earningsAsOf: earnings.asOf,
      regime,
      session,
      observedAt,
    });
  });
  const plan = planCapture({
    session,
    observations,
    states,
    openSymbols: stillOpen,
    alreadyRecorded: false,
  });
  if (plan.inserts.length) await repo.insertSignals(plan.inserts);
  if (plan.states.length) await repo.saveStates(plan.states.map((row) => ({
    symbol: row.symbol,
    last_session: row.last_session,
    last_qualified: row.last_qualified,
    open_signal: row.open_symbol,
    updated_at: observedAt,
  })));

  return {
    code: 200,
    body: {
      action: "capture",
      session,
      inserted: plan.inserts.length,
      reviewed: reviews.length,
      behind: 0,
      skipped: plan.skipped,
      origins: plan.inserts.map((row) => row.origin),
    },
  };
}
