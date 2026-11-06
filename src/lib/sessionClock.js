// Completed US cash sessions. Weekends and full-day NYSE holidays are not
// sessions. A timestamp is never a session: downloading Friday's close on
// Saturday does not create a Saturday price.

export const US_MARKET_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19",
  "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
]);

// Shown next to any combined read. Indicators here are end-of-day and lagged.
export const TIMING_NOTE = "Prices, setups, and the market light are the official daily close, not a live tape. RSI and moving averages are smoothed, so they lag the price. Revenue, earnings, and margins lag until the company reports. 13F ownership lags until the quarterly filing. A new download of the same session is not new information, and none of this predicts the next move.";

const CLOSE_MINUTES = 16 * 60;

export function nyDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function nyToday() {
  return nyDateString(new Date());
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function isTradingDay(value, holidays = US_MARKET_HOLIDAYS) {
  const date = parseISODate(value);
  if (!date) return false;
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(isoDate(date));
}

function addDays(value, days) {
  const date = parseISODate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function previousTradingDay(value, holidays) {
  let cursor = addDays(value, -1);
  let guard = 0;
  while (cursor && !isTradingDay(cursor, holidays)) {
    cursor = addDays(cursor, -1);
    guard += 1;
    if (guard > 14) return null;
  }
  return cursor;
}

function nyMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

// The last session whose close is over. Before 4:00pm New York on a trading
// day, that day is not done. Holidays and weekends step back to the prior
// session. Early closes (the day after Thanksgiving) are treated as a full
// day until 4:00pm, which can mark that afternoon as one session behind.
export function lastCompletedSession(now = new Date(), holidays = US_MARKET_HOLIDAYS) {
  const today = nyDateString(now);
  const minutes = nyMinutes(now);
  if (!today || minutes == null) return null;
  if (isTradingDay(today, holidays) && minutes >= CLOSE_MINUTES) return today;
  return previousTradingDay(today, holidays);
}

// Trading days after `fromIso` through `toIso`, inclusive of `toIso` only.
// Same day is 0. Weekends and holidays are not counted.
export function tradingDaysUntil(fromIso, toIso, holidays = US_MARKET_HOLIDAYS) {
  const from = parseISODate(fromIso);
  const to = parseISODate(toIso);
  if (!from || !to || to < from) return null;
  let days = 0;
  const cursor = new Date(from.getTime());
  while (cursor < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(isoDate(cursor))) continue;
    days += 1;
  }
  return days;
}

// How many completed sessions the saved bar is behind. `fetchedAt` is not an
// input on purpose: saving the row again does not move the session forward.
export function sessionsBehind(barDate, now = new Date(), holidays = US_MARKET_HOLIDAYS) {
  const latest = lastCompletedSession(now, holidays);
  const bar = String(barDate || "").slice(0, 10);
  if (!latest) return { state: "missing", latest: null, sessionsBehind: null, barDate: /^\d{4}-\d{2}-\d{2}$/.test(bar) ? bar : null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bar)) {
    return { state: "missing", latest, sessionsBehind: null, barDate: null };
  }
  if (bar > latest) return { state: "ahead", latest, sessionsBehind: null, barDate: bar };
  const behind = tradingDaysUntil(bar, latest, holidays);
  let state = "fresh";
  if (behind >= 2) state = "stale";
  else if (behind === 1) state = "delayed";
  return { state, latest, sessionsBehind: behind, barDate: bar };
}

export function freshnessSentence(info, noun = "prices") {
  if (!info || info.state === "missing") {
    return `No session date is saved for these ${noun}, so they are not used as a current buy or sell.`;
  }
  if (info.state === "ahead") {
    return `The saved ${noun} date ${info.barDate} is after the latest completed session (${info.latest}), so they are not used.`;
  }
  if (info.state === "fresh") return null;
  const count = info.sessionsBehind;
  const sessions = count === 1 ? "session" : "sessions";
  return `These ${noun} are from ${info.barDate}, ${count} completed ${sessions} behind ${info.latest}. Downloading them again does not make them current, so they are not a buy or sell today.`;
}

// Date-only callers (sample data and tests) are read as 17:00 UTC on that
// calendar day, which is still before the 4:00pm New York close in both
// EST and EDT. Live screens should pass a real `Date` instead.
export function clockFromDay(dayIso) {
  const day = String(dayIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Date();
  return new Date(`${day}T17:00:00Z`);
}
