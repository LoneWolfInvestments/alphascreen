// Finnhub earnings-calendar helpers. The HTTP call stays in the cron route.

export const FINNHUB_PAUSE_MS = 1100;
export const EARNINGS_HORIZON_DAYS = 180;
export const EARNINGS_WINDOW_DAYS = 90;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const date = parseISODate(iso);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

// Two 90-day windows cover the next two quarters with one pause between calls,
// which stays inside a short serverless run and Finnhub's free per-minute cap.
export function dateWindows(todayIso, horizonDays = EARNINGS_HORIZON_DAYS, windowDays = EARNINGS_WINDOW_DAYS) {
  const windows = [];
  for (let offset = 0; offset < horizonDays; offset += windowDays) {
    const from = addDays(todayIso, offset);
    const to = addDays(todayIso, Math.min(offset + windowDays - 1, horizonDays - 1));
    if (from && to) windows.push({ from, to });
  }
  return windows;
}

export function pickNextEarnings(events, todayIso) {
  const next = new Map();
  const list = Array.isArray(events) ? events : [];
  for (const event of list) {
    const symbol = String(event?.symbol || "").trim().toUpperCase();
    const date = String(event?.date || "").slice(0, 10);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (todayIso && date < todayIso) continue;
    const previous = next.get(symbol);
    if (!previous || date < previous) next.set(symbol, date);
  }
  return next;
}

export function isMissingEarningsTableError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /earnings_calendar/.test(message) && /schema cache|does not exist|relation|Could not find/i.test(message);
}
