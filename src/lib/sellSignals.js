// Pure sell-rule checks shared by the Sell Signals panel and the tests.
// Nothing here talks to the network or the database.

import { clockFromDay, freshnessSentence, nyToday, sessionsBehind, tradingDaysUntil } from "./sessionClock.js";

export { nyDateString, nyToday, tradingDaysUntil } from "./sessionClock.js";

export const POSITION_LIMIT = 0.25;
export const THEME_LIMIT = 0.4;
export const RSI_HOT = 80;
export const SMA_STRETCH = 0.4;
export const EARNINGS_SOON_DAYS = 5;
export const TREND_BREAK_DAYS = 2;

// Used only when a holding has no theme saved. Keep this list in sync with
// the one-time update in schema-sell-signals.sql.
export const DEFAULT_THEMES = Object.freeze({
  CCJ: "Uranium",
  DNN: "Uranium",
  NXE: "Uranium",
  NVDA: "Semis/AI",
  MU: "Semis/AI",
  AAPL: "Big Tech",
  MSFT: "Big Tech",
  NOW: "Software",
  LLY: "Healthcare",
  ASTS: "Space",
});

export const STATUS_LABEL = Object.freeze({
  red: "Exit",
  amber: "Decide",
  info: "Don't add",
  green: "All clear",
  nodata: "No price",
  stale: "Not current",
});

const STATUS_RANK = { red: 0, stale: 1, nodata: 2, amber: 3, info: 4, green: 5 };

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function isEarningsSoon(dateIso, todayIso) {
  const days = tradingDaysUntil(todayIso, dateIso);
  return days != null && days <= EARNINGS_SOON_DAYS;
}

// New-buy bucket only. Held names stay in whatever review bucket they earned.
export function blocksNewBuy({ held, fundamentalSignal, technicalSignal, earningsSoon }) {
  return !held && fundamentalSignal === "Buy" && technicalSignal === "Buy" && !!earningsSoon;
}

export function themeForHolding(ticker, savedTheme) {
  const saved = typeof savedTheme === "string" ? savedTheme.trim() : "";
  if (saved) return { name: saved, source: "saved" };
  const fallback = DEFAULT_THEMES[String(ticker || "").toUpperCase()];
  if (fallback) return { name: fallback, source: "default" };
  return { name: "Unclassified", source: "none" };
}

// Dollars to sell so that (value - X) / (total - X) = limit.
// "Over" the limit: equal to the limit does not fire.
export function trimToLimit(value, total, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(limit) || limit <= 0 || limit >= 1) return null;
  if (value / total <= limit) return null;
  const dollars = (value - limit * total) / (1 - limit);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return dollars;
}

export function stopDistancePct(price, stop) {
  if (!Number.isFinite(price) || price === 0 || !Number.isFinite(stop)) return null;
  return ((price - stop) / price) * 100;
}

export function pnlAtStop(stop, costBasis, shares) {
  if (!Number.isFinite(stop) || !Number.isFinite(costBasis) || costBasis <= 0 || !Number.isFinite(shares)) {
    return { dollars: null, pct: null };
  }
  return {
    dollars: (stop - costBasis) * shares,
    pct: ((stop - costBasis) / costBasis) * 100,
  };
}

export function formatUsd(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return sign + abs;
}

export function formatPrice(value) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPct(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  const text = Math.abs(value).toFixed(digits).replace(/\.0$/, "");
  return `${value < 0 ? "-" : ""}${text}%`;
}

export function formatDay(value) {
  const date = parseISODate(value);
  if (!date) return null;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyPhrase(dollars, pct) {
  if (!Number.isFinite(dollars) || !Number.isFinite(pct)) return null;
  const direction = dollars > 0 ? "a gain" : dollars < 0 ? "a loss" : "flat";
  if (dollars === 0) return "flat versus your cost";
  return `${direction} of about ${formatUsd(Math.abs(dollars))} (${formatPct(Math.abs(pct))})`;
}

function stopSentence({ price, stop, high22, atr22, costBasis, pnlDollars, pnlPct, breached }) {
  const outcome = moneyPhrase(pnlDollars, pnlPct);
  const versusCost = outcome && Number.isFinite(costBasis)
    ? ` Versus your ${formatPrice(costBasis)} cost, selling at the stop would be ${outcome}.`
    : "";
  const built = Number.isFinite(high22) && Number.isFinite(atr22)
    ? ` It is the highest high of the last 22 trading days (${formatPrice(high22)}) minus 3 × ATR(22) (${formatPrice(atr22)}).`
    : " It is the highest high of the last 22 trading days minus 3 × ATR(22).";
  if (breached) {
    return `Exit signal. The latest close (${formatPrice(price)}) is below the trailing stop (${formatPrice(stop)}).${built}${versusCost}`;
  }
  const gap = stopDistancePct(price, stop);
  const where = gap == null
    ? `Trailing stop is ${formatPrice(stop)}.`
    : gap >= 0
      ? `Trailing stop is ${formatPrice(stop)}, ${formatPct(gap)} under the close.`
      : `Trailing stop is ${formatPrice(stop)}, and the close is ${formatPct(Math.abs(gap))} through it.`;
  return `${where}${versusCost}`;
}

export function buildSellBook({ holdings, quotesBySymbol, earningsBySymbol, today, now }) {
  const list = Array.isArray(holdings) ? holdings : [];
  const quotes = quotesBySymbol || {};
  const earnings = earningsBySymbol || {};
  const todayIso = today || nyToday();
  const clock = now instanceof Date ? now : clockFromDay(todayIso);

  const prepared = list.map((holding) => {
    const ticker = String(holding.ticker || "").toUpperCase();
    const quote = quotes[ticker] || {};
    const price = num(quote.price);
    const shares = num(holding.shares) ?? 0;
    const costBasis = num(holding.cost_basis);
    const marketValue = price != null && price > 0 ? shares * price : null;
    const theme = themeForHolding(ticker, holding.theme);
    const earningsDate = earnings[ticker] ? String(earnings[ticker]).slice(0, 10) : null;
    const earningsDays = tradingDaysUntil(todayIso, earningsDate);
    return {
      ticker,
      savedTheme: typeof holding.theme === "string" ? holding.theme.trim() : "",
      theme: theme.name,
      themeSource: theme.source,
      shares,
      costBasis,
      price: price != null && price > 0 ? price : null,
      marketValue,
      rsi: num(quote.rsi),
      sma50: num(quote.sma_50),
      atr22: num(quote.atr_22),
      high22: num(quote.high_22),
      stop: num(quote.chandelier_stop),
      streak: num(quote.below_sma50_streak) ?? 0,
      barDate: quote.bar_date ? String(quote.bar_date).slice(0, 10) : null,
      fetchedAt: quote.updated_at || null,
      priceCurrent: sessionsBehind(quote.bar_date, clock).state === "fresh",
      earningsDate,
      earningsDays,
      earningsSoon: isEarningsSoon(earningsDate, todayIso),
    };
  });

  const totalMarketValue = prepared.reduce((sum, row) => sum + (row.marketValue || 0), 0);
  const themeBuckets = new Map();
  for (const row of prepared) {
    if (row.theme === "Unclassified" || row.marketValue == null) continue;
    const bucket = themeBuckets.get(row.theme) || { name: row.theme, marketValue: 0, tickers: [], current: true };
    bucket.marketValue += row.marketValue;
    bucket.tickers.push(row.ticker);
    if (!row.priceCurrent) bucket.current = false;
    themeBuckets.set(row.theme, bucket);
  }

  const themes = [...themeBuckets.values()]
    .map((bucket) => {
      const weight = totalMarketValue > 0 ? bucket.marketValue / totalMarketValue : 0;
      const trimDollars = trimToLimit(bucket.marketValue, totalMarketValue, THEME_LIMIT);
      return {
        name: bucket.name,
        tickers: bucket.tickers.sort(),
        marketValue: bucket.marketValue,
        weight,
        trimDollars,
        over: bucket.current && trimDollars != null,
        unreliable: !bucket.current,
      };
    })
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  const themeByName = new Map(themes.map((theme) => [theme.name, theme]));

  const rows = prepared.map((row) => {
    const flags = [];
    const weight = totalMarketValue > 0 && row.marketValue != null ? row.marketValue / totalMarketValue : null;
    const distancePct = stopDistancePct(row.price, row.stop);
    const pnl = pnlAtStop(row.stop, row.costBasis, row.shares);
    const extensionPct = row.price != null && row.sma50 != null && row.sma50 !== 0
      ? (row.price - row.sma50) / row.sma50
      : null;
    const stopKnown = row.price != null && row.stop != null;
    const freshness = sessionsBehind(row.barDate, clock);
    const priceCurrent = freshness.state === "fresh";

    if (row.price == null) {
      flags.push({
        code: "nodata",
        level: "nodata",
        why: `No saved price for ${row.ticker} yet. Add it to the watchlist and wait for the nightly refresh. This row cannot be checked until then.`,
      });
    }

    if (!priceCurrent && row.price != null) {
      flags.push({
        code: "stale",
        level: "stale",
        why: freshnessSentence(freshness, "prices") || "The saved price is not from the latest completed session.",
      });
    }

    if (priceCurrent && stopKnown && row.price < row.stop) {
      flags.push({
        code: "stop",
        level: "red",
        why: stopSentence({
          price: row.price,
          stop: row.stop,
          high22: row.high22,
          atr22: row.atr22,
          costBasis: row.costBasis,
          pnlDollars: pnl.dollars,
          pnlPct: pnl.pct,
          breached: true,
        }),
      });
    }

    if (priceCurrent && row.price != null && row.rsi != null && row.rsi > RSI_HOT) {
      flags.push({
        code: "rsi",
        level: "amber",
        why: `Consider trimming. The 14-day RSI is ${formatPct(row.rsi, 0).replace("%", "")}, which is above 80, so the move looks stretched. This is a trim decision, not an automatic sell.`,
      });
    }

    if (priceCurrent && row.price != null && extensionPct != null && extensionPct >= SMA_STRETCH) {
      flags.push({
        code: "stretch",
        level: "amber",
        why: `Consider trimming. The price is ${formatPct(extensionPct * 100)} above the 50-day average (${formatPrice(row.sma50)}). Anything 40% or more above that average counts as stretched.`,
      });
    }

    if (row.earningsSoon) {
      const when = row.earningsDays === 0
        ? "today"
        : `in ${row.earningsDays} trading day${row.earningsDays === 1 ? "" : "s"}`;
      flags.push({
        code: "earnings",
        level: "amber",
        why: `Earnings are on ${formatDay(row.earningsDate)} (${when}). Before the report, decide whether to trim, hedge, or hold. This is not an automatic sell.`,
      });
    }

    if (priceCurrent && row.price != null && row.streak >= TREND_BREAK_DAYS) {
      flags.push({
        code: "trend",
        level: "info",
        why: `Do not add. The close has finished below the 50-day average for ${row.streak} days in a row. That means don't buy more yet. It is not an instruction to sell what you already own.`,
      });
    }

    const positionTrim = priceCurrent && row.marketValue != null
      ? trimToLimit(row.marketValue, totalMarketValue, POSITION_LIMIT)
      : null;
    if (positionTrim != null) {
      flags.push({
        code: "position",
        level: "amber",
        why: `${row.ticker} is ${formatPct((weight || 0) * 100)} of the portfolio. The limit for one holding is 25%. Sell about ${formatUsd(positionTrim)} of ${row.ticker} to get back under 25%.`,
      });
    }

    const themeInfo = themeByName.get(row.theme);
    if (priceCurrent && themeInfo?.over && row.marketValue != null) {
      flags.push({
        code: "theme",
        level: "amber",
        why: `${themeInfo.name} is ${formatPct(themeInfo.weight * 100)} of the portfolio (${themeInfo.tickers.join(", ")}). The limit for one theme is 40%. Trim about ${formatUsd(themeInfo.trimDollars)} across this theme to get back under 40%.`,
      });
    }

    const signalFlags = flags.filter((flag) => flag.code !== "nodata");
    let status = "green";
    if (signalFlags.length > 0) {
      status = signalFlags.reduce((worst, flag) => (
        STATUS_RANK[flag.level] < STATUS_RANK[worst] ? flag.level : worst
      ), "green");
    } else if (row.price == null) {
      status = "nodata";
    }

    const why = [];
    for (const flag of flags) {
      if (flag.code === "nodata") continue;
      why.push(flag.why);
    }
    if (priceCurrent && stopKnown && !flags.some((flag) => flag.code === "stop")) {
      why.push(stopSentence({
        price: row.price,
        stop: row.stop,
        high22: row.high22,
        atr22: row.atr22,
        costBasis: row.costBasis,
        pnlDollars: pnl.dollars,
        pnlPct: pnl.pct,
        breached: false,
      }));
    }
    if (priceCurrent && row.price != null && row.stop == null) {
      why.push("The trailing stop is not calculated yet. It appears after the next nightly price refresh.");
    }
    if (priceCurrent && row.price != null && flags.filter((flag) => flag.code !== "nodata").length === 0 && row.stop != null) {
      why.unshift("All clear. None of the sell checks are firing.");
    }
    if (flags.some((flag) => flag.code === "nodata")) {
      why.unshift(flags.find((flag) => flag.code === "nodata").why);
    }

    return {
      ...row,
      weight,
      distancePct,
      pnlDollars: pnl.dollars,
      pnlPct: pnl.pct,
      extensionPct,
      positionTrim,
      flags: flags.filter((flag) => flag.code !== "nodata"),
      freshness,
      status,
      statusLabel: STATUS_LABEL[status],
      why,
    };
  });

  rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.ticker.localeCompare(b.ticker));

  const counts = { red: 0, amber: 0, info: 0, green: 0, nodata: 0, stale: 0 };
  for (const row of rows) counts[row.status] += 1;

  const barDates = [...new Set(rows.map((row) => row.barDate).filter(Boolean))];

  return {
    today: todayIso,
    totalMarketValue,
    counts,
    themes,
    rows,
    asOf: barDates.length === 1 ? barDates[0] : null,
    asOfMixed: barDates.length > 1,
  };
}
