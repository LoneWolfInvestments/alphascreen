// Business fundamentals from Finnhub's free basic-financials payload.
// The same /stock/metric response the weekly job already downloads.
// Ownership (13F) and analyst opinions are read separately and never scored.

export const SOURCE = "finnhub_basic_financials";
export const FETCH_STALE_DAYS = 45;
export const STATEMENT_STALE_DAYS = 200;
export const MARGIN_TREND_PP = 0.02;
export const EXTREME_GROWTH = 2;

export const BUSINESS_COLUMNS = Object.freeze([
  "revenue_growth_yoy",
  "revenue_growth_basis",
  "earnings_growth_yoy",
  "earnings_state",
  "earnings_basis",
  "margin_current",
  "margin_prior",
  "margin_basis",
  "ps_ratio",
  "fundamentals_period",
  "fundamentals_as_of",
  "fundamentals_source",
  "analyst_period",
]);

export const OWNERSHIP_COLUMNS = Object.freeze(["ownership_fetched_at"]);

const REVENUE_BASIS = Object.freeze({
  ttm_yoy: "Trailing 12 months versus the prior 12 months",
  quarterly_yoy: "Latest quarter versus the same quarter a year earlier",
});

const MARGIN_BASIS = Object.freeze({
  quarterly_yoy: "Latest quarter versus the quarter a year earlier",
  annual_yoy: "Latest fiscal year versus the year before",
  ttm_vs_fiscal_year: "Trailing 12 months versus the last fiscal year (the windows overlap)",
});

function finite(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function dayOnly(value) {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function daySpan(earlier, later) {
  const start = Date.parse(`${String(earlier).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(later).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

function fromPercent(value) {
  const parsed = finite(value);
  if (parsed == null) return null;
  return parsed / 100;
}

function sortedPoints(list) {
  const points = (Array.isArray(list) ? list : [])
    .map((point) => ({
      period: dayOnly(point?.period),
      value: finite(point?.v),
    }))
    .filter((point) => point.period && point.value != null);
  points.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const deduped = [];
  for (const point of points) {
    if (deduped.length && deduped[deduped.length - 1].period === point.period) deduped[deduped.length - 1] = point;
    else deduped.push(point);
  }
  return deduped;
}

function yearAgo(points) {
  if (!points || points.length < 2) return null;
  const latest = points[points.length - 1];
  const target = daySpan("1970-01-01", latest.period);
  if (target == null) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    if (point.period >= latest.period) continue;
    const gap = daySpan(point.period, latest.period);
    if (gap == null) continue;
    const distance = Math.abs(gap - 365);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  const gap = daySpan(best.period, latest.period);
  if (gap == null || gap < 300 || gap > 450) return null;
  return { latest, prior: best };
}

// Series margins are sometimes decimals (0.25) and the snapshot margin is
// percent (25). Convert only when the latest point agrees with the snapshot.
// If they disagree, return null instead of guessing.
function seriesFractions(pair, metricPercent) {
  if (!pair || !Number.isFinite(metricPercent) || metricPercent === 0) return null;
  const ratio = pair.latest.value / metricPercent;
  let divisor = null;
  if (ratio > 0.5 && ratio < 2) divisor = 100;
  else if (Math.abs(ratio) > 0.005 && Math.abs(ratio) < 0.02) divisor = 1;
  if (!divisor) return null;
  return {
    current: pair.latest.value / divisor,
    prior: pair.prior.value / divisor,
    period: pair.latest.period,
  };
}

function marginFromSeries(seriesList, metricPercent) {
  const converted = seriesFractions(yearAgo(sortedPoints(seriesList)), metricPercent);
  if (!converted || !Number.isFinite(converted.current) || !Number.isFinite(converted.prior)) return null;
  return converted;
}

function quarterGapsOk(points) {
  for (let index = 1; index < points.length; index += 1) {
    const gap = daySpan(points[index - 1].period, points[index].period);
    if (gap == null || gap < 70 || gap > 130) return false;
  }
  return true;
}

function earningsFromQuarters(points) {
  if (!points || points.length < 8) return null;
  const window = points.slice(-8);
  if (!quarterGapsOk(window)) return null;
  const prior = window.slice(0, 4).reduce((sum, point) => sum + point.value, 0);
  const recent = window.slice(4).reduce((sum, point) => sum + point.value, 0);
  if (recent <= 0) return { state: "non_positive", value: null, basis: null, period: window[7].period };
  if (prior <= 0) return { state: "turned_profitable", value: null, basis: null, period: window[7].period };
  const growth = recent / prior - 1;
  if (Math.abs(growth) > EXTREME_GROWTH) return { state: "unstable", value: null, basis: null, period: window[7].period };
  return { state: "available", value: growth, basis: "sum_of_quarters", period: window[7].period };
}

function publishedEarnings(eps, growthPercent) {
  if (eps == null) return { state: "missing", value: null, basis: null };
  if (eps <= 0) return { state: "non_positive", value: null, basis: null };
  const growth = fromPercent(growthPercent);
  if (growth == null) return { state: "missing", value: null, basis: null };
  if (Math.abs(growth) > EXTREME_GROWTH) return { state: "unstable", value: null, basis: null };
  return { state: "available", value: growth, basis: "published_ttm" };
}

export function isMissingColumnError(error, columns) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return (columns || []).some((column) => message.includes(column));
}

export function withoutColumns(row, columns) {
  const copy = { ...row };
  for (const column of columns || []) delete copy[column];
  return copy;
}

// Pure parse of one free /stock/metric payload. Sales per share is not used
// as a stand-in for revenue. 3-year and 5-year growth fields are not copied
// into the year-over-year slot.
export function factsFromFinnhubPayload(data, { fetchedAt } = {}) {
  const metric = data?.metric || {};
  const quarterly = data?.series?.quarterly || {};
  const annual = data?.series?.annual || {};
  const marginPercent = finite(metric.netProfitMarginTTM);

  let revenue = fromPercent(metric.revenueGrowthTTMYoy);
  let revenueBasis = revenue != null ? "ttm_yoy" : null;
  if (revenue == null) {
    revenue = fromPercent(metric.revenueGrowthQuarterlyYoy);
    revenueBasis = revenue != null ? "quarterly_yoy" : null;
  }

  const eps = finite(metric.epsInclExtraItemsTTM ?? metric.epsBasicExclExtraItemsTTM);
  let earnings = publishedEarnings(eps, metric.epsGrowthTTMYoy);
  let period = null;
  if (earnings.state === "missing" && eps != null && eps > 0) {
    const fromQuarters = earningsFromQuarters(sortedPoints(quarterly.eps));
    if (fromQuarters && fromQuarters.state !== "missing") {
      earnings = fromQuarters;
      period = fromQuarters.period || null;
    }
  }

  let margin = marginFromSeries(quarterly.netMargin, marginPercent);
  let marginBasis = margin ? "quarterly_yoy" : null;
  if (!margin) {
    margin = marginFromSeries(annual.netMargin, marginPercent);
    marginBasis = margin ? "annual_yoy" : null;
  }
  if (margin?.period) period = period || margin.period;
  if (!margin && marginPercent != null && finite(metric.netProfitMarginAnnual) != null) {
    margin = {
      current: marginPercent / 100,
      prior: finite(metric.netProfitMarginAnnual) / 100,
      period: null,
    };
    marginBasis = "ttm_vs_fiscal_year";
  }

  return {
    pe_ratio: finite(metric.peBasicExclExtraTTM),
    market_cap: finite(metric.marketCapitalization) != null ? finite(metric.marketCapitalization) * 1e6 : null,
    eps,
    profit_margin: marginPercent != null ? marginPercent / 100 : null,
    revenue_growth_yoy: revenue,
    revenue_growth_basis: revenueBasis,
    earnings_growth_yoy: earnings.state === "available" ? earnings.value : null,
    earnings_state: earnings.state,
    earnings_basis: earnings.basis,
    margin_current: margin ? margin.current : null,
    margin_prior: margin ? margin.prior : null,
    margin_basis: margin ? marginBasis : null,
    ps_ratio: finite(metric.psTTM),
    fundamentals_period: margin?.period || period,
    fundamentals_as_of: fetchedAt || null,
    fundamentals_source: SOURCE,
  };
}

export function analystPeriodFromRecommendation(payload) {
  const latest = Array.isArray(payload) ? payload[0] : null;
  return dayOnly(latest?.period);
}

function trendOf(current, prior) {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) {
    return { trend: "insufficient", change: null };
  }
  const change = current - prior;
  let trend = "stable";
  if (change >= MARGIN_TREND_PP) trend = "expanding";
  else if (change <= -MARGIN_TREND_PP) trend = "compressing";
  return { trend, change };
}

function valuationOf(pe, earningsState, earningsGrowth) {
  if (pe == null || pe <= 0) {
    if (earningsState === "non_positive" || earningsState === "turned_profitable") {
      return { state: "not_meaningful", peg: null };
    }
    return { state: "missing", peg: null };
  }
  let peg = null;
  if (earningsState === "available" && earningsGrowth > 0.01 && earningsGrowth < 0.8) {
    peg = pe / (earningsGrowth * 100);
  }
  let state = "typical";
  if (pe >= 50 || (peg != null && peg >= 2.5 && pe >= 25)) state = "rich";
  else if (pe < 18 && (peg == null || peg < 1.5)) state = "modest";
  return { state, peg: round(peg, 2) };
}

function growthPoints(value) {
  if (value >= 0.15) return 15;
  if (value >= 0.05) return 8;
  if (value >= 0) return 0;
  if (value >= -0.05) return -8;
  return -15;
}

function earningsPoints(state, value) {
  if (state === "available") {
    if (value >= 0.15) return 10;
    if (value >= 0) return 4;
    if (value >= -0.1) return -4;
    return -10;
  }
  if (state === "non_positive") return -10;
  return 0;
}

function marginPoints(trend, current) {
  if (trend === "expanding") return current >= 0 ? 10 : 4;
  if (trend === "stable") return current >= 0 ? 2 : -4;
  if (trend === "compressing") return -10;
  return 0;
}

export function formatGrowth(fraction) {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatPp(fraction) {
  if (!Number.isFinite(fraction)) return "—";
  const points = fraction * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pp`;
}

function percentLevel(fraction) {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(1)}%`;
}

function earningsText(state, value) {
  if (state === "available") return formatGrowth(value);
  if (state === "non_positive") return "Earnings are zero or negative, so a growth rate is not used.";
  if (state === "turned_profitable") return "Earnings just turned positive, so a growth rate is not used.";
  if (state === "unstable") return "The earnings growth figure is too extreme to use. That usually means a tiny comparison base.";
  return "Earnings growth is not in the saved snapshot.";
}

function marginText(trend, current, prior, change, basis) {
  if (trend === "insufficient") {
    if (Number.isFinite(current)) return `Margin level ${percentLevel(current)}. No earlier margin is saved, so there is no trend.`;
    return "No margin trend is saved.";
  }
  const word = trend === "expanding" ? "Expanding" : trend === "compressing" ? "Compressing" : "Stable";
  const level = current < 0 ? " The margin is still negative." : "";
  const how = MARGIN_BASIS[basis] ? ` ${MARGIN_BASIS[basis]}.` : "";
  return `${word}: ${percentLevel(current)} versus ${percentLevel(prior)} (${formatPp(change)}).${level}${how}`;
}

function valuationText(state, pe, ps, earningsState) {
  if (state === "not_meaningful") {
    const sales = Number.isFinite(ps) ? ` Price to sales is ${ps.toFixed(1)} and is not scored.` : "";
    return `P/E is not used because earnings are not positive.${sales}`;
  }
  if (state === "missing" || pe == null || pe <= 0) return "No usable P/E is saved.";
  const band = state === "rich" ? "high" : state === "modest" ? "lower" : "ordinary";
  const block = state === "rich" ? " A high P/E blocks a Buy read." : "";
  return `P/E ${pe.toFixed(1)} is ${band} on a rough band, not a price target.${block}`;
}

export function readBusinessFundamentals(row, { now = new Date() } = {}) {
  const empty = {
    score: null,
    signal: null,
    coverage: "missing",
    revenue: { value: null, basis: null, text: "Revenue growth is not in the saved snapshot." },
    earnings: { value: null, state: "missing", basis: null, text: earningsText("missing") },
    margin: { current: null, prior: null, change: null, trend: "insufficient", basis: null, text: marginText("insufficient") },
    valuation: { pe: null, ps: null, state: "missing", peg: null, text: valuationText("missing") },
    period: null,
    fetchedAt: null,
    source: null,
    summary: "No company fundamentals are saved yet. Institutional ownership is not a substitute.",
    hasFigures: false,
  };
  if (!row) return empty;

  const revenue = finite(row.revenue_growth_yoy);
  const revenueBasis = REVENUE_BASIS[row.revenue_growth_basis] ? row.revenue_growth_basis : null;
  const earningsState = ["available", "non_positive", "turned_profitable", "unstable", "missing"].includes(row.earnings_state)
    ? row.earnings_state
    : "missing";
  let earningsValue = earningsState === "available" ? finite(row.earnings_growth_yoy) : null;
  let resolvedEarningsState = earningsState === "available" && earningsValue == null ? "missing" : earningsState;
  if (resolvedEarningsState === "available" && Math.abs(earningsValue) > EXTREME_GROWTH) {
    resolvedEarningsState = "unstable";
    earningsValue = null;
  }
  const marginCurrent = finite(row.margin_current);
  const marginPrior = finite(row.margin_prior);
  const marginLevel = marginCurrent != null ? marginCurrent : finite(row.profit_margin);
  const margin = trendOf(marginCurrent, marginPrior);
  const pe = finite(row.pe_ratio);
  const ps = finite(row.ps_ratio);
  const valuation = valuationOf(pe != null && pe > 0 ? pe : null, resolvedEarningsState, earningsValue);
  const period = dayOnly(row.fundamentals_period);
  const fetchedAt = row.fundamentals_as_of || null;
  const fetchedDay = dayOnly(fetchedAt);
  const nowDay = dayOnly(now instanceof Date ? now.toISOString() : now);

  const hasFigures = revenue != null
    || resolvedEarningsState !== "missing"
    || marginCurrent != null
    || marginLevel != null
    || (pe != null && pe > 0)
    || fetchedAt != null;

  const revenueText = revenue == null
    ? "Revenue growth is not in the saved snapshot."
    : `${formatGrowth(revenue)}. ${REVENUE_BASIS[revenueBasis] || "Year-over-year figure from Finnhub."}`;

  let coverage = hasFigures ? "partial" : "missing";
  let staleReason = null;
  if (fetchedDay && nowDay) {
    const age = daySpan(fetchedDay, nowDay);
    if (age != null && age > FETCH_STALE_DAYS) {
      coverage = "stale";
      staleReason = "fetch";
    }
  }
  if (period && fetchedDay) {
    const statementAge = daySpan(period, fetchedDay);
    if (statementAge != null && (statementAge > STATEMENT_STALE_DAYS || statementAge < -7)) {
      coverage = "stale";
      staleReason = staleReason ? "both" : "statement";
    }
  }

  const trendUsable = margin.trend === "expanding" || margin.trend === "stable" || margin.trend === "compressing";
  const valuationUsable = valuation.state === "modest" || valuation.state === "typical" || valuation.state === "rich";
  const canScore = coverage !== "stale"
    && coverage !== "missing"
    && fetchedAt
    && period
    && revenue != null
    && (trendUsable || valuationUsable);

  let score = null;
  if (canScore) {
    score = 50
      + growthPoints(revenue)
      + earningsPoints(resolvedEarningsState, earningsValue)
      + (trendUsable ? marginPoints(margin.trend, marginCurrent) : 0)
      + (valuation.state === "modest" ? 3 : valuation.state === "rich" ? -8 : 0);
    score = Math.max(0, Math.min(100, Math.round(score)));
    coverage = "ready";
  }

  let signal = null;
  if (coverage === "ready" && score != null) {
    const buy = score >= 62
      && revenue >= 0.05
      && resolvedEarningsState === "available"
      && earningsValue >= 0
      && (margin.trend === "expanding" || margin.trend === "stable")
      && marginCurrent > 0
      && (valuation.state === "modest" || valuation.state === "typical");
    const caution = score <= 42 || (revenue < 0 && margin.trend === "compressing") || (resolvedEarningsState === "non_positive" && revenue < 0);
    signal = buy ? "Buy" : caution ? "Caution" : "Hold";
  }

  const bits = [];
  if (coverage === "stale") {
    bits.push(staleReason === "statement"
      ? `The newest statement date saved is ${period}, which is too old to score.`
      : "The company snapshot is more than 45 days since the last successful download, so it is not scored.");
  } else if (!fetchedAt && hasFigures) {
    bits.push("P/E, EPS, or margin may be saved, but the new company snapshot has not been downloaded yet, so there is no score.");
  } else if (!period && hasFigures) {
    bits.push("Finnhub did not include a statement date, so the figures are shown and not scored.");
  }
  if (signal === "Buy") bits.push(`Business score ${score}. Revenue, earnings, margins, and the rough P/E check all clear the bar.`);
  if (signal === "Hold") bits.push(`Business score ${score}. This is not a Buy. A missing piece, a high P/E, or mixed growth keeps it here.`);
  if (signal === "Caution") bits.push(`Business score ${score}. Revenue is shrinking, earnings are negative, or margins are compressing.`);
  if (revenue != null) bits.push(`Revenue growth ${formatGrowth(revenue)}.`);
  if (resolvedEarningsState !== "missing") bits.push(earningsText(resolvedEarningsState, earningsValue));

  const summary = bits.join(" ") || empty.summary;

  return {
    score,
    signal,
    coverage,
    staleReason,
    revenue: { value: revenue, basis: revenueBasis, text: revenueText },
    earnings: {
      value: earningsValue,
      state: resolvedEarningsState,
      basis: row.earnings_basis || null,
      text: earningsText(resolvedEarningsState, earningsValue),
    },
    margin: {
      current: marginCurrent != null ? marginCurrent : marginLevel,
      prior: marginPrior,
      change: margin.change,
      trend: margin.trend,
      basis: row.margin_basis || null,
      text: marginText(margin.trend, marginCurrent != null ? marginCurrent : marginLevel, marginPrior, margin.change, row.margin_basis),
    },
    valuation: {
      pe: pe != null && pe > 0 ? pe : null,
      ps,
      state: valuation.state,
      peg: valuation.peg,
      text: valuationText(valuation.state, pe != null && pe > 0 ? pe : null, ps, resolvedEarningsState),
    },
    period,
    fetchedAt,
    source: row.fundamentals_source || (fetchedAt ? SOURCE : null),
    summary,
    hasFigures,
  };
}

export function readOwnership(row) {
  if (!row || row.inst_net_breadth == null || !Number.isFinite(Number(row.inst_net_breadth))) {
    return {
      label: "No data",
      breadth: null,
      buyers: null,
      sellers: null,
      fetchedAt: row?.ownership_fetched_at || null,
      text: "No 13F ownership snapshot is saved. Ownership is not the business score.",
    };
  }
  const breadth = Number(row.inst_net_breadth);
  let label = "Flat";
  if (breadth > 5) label = "Accumulating";
  else if (breadth < -5) label = "Distributing";
  const buyers = row.inst_buyers ?? null;
  const sellers = row.inst_sellers ?? null;
  return {
    label,
    breadth,
    buyers,
    sellers,
    fetchedAt: row.ownership_fetched_at || null,
    text: `${label}: ${buyers ?? "—"} holders added and ${sellers ?? "—"} reduced (${breadth > 0 ? "+" : ""}${breadth.toFixed(1)}% of that count). This is a quarterly 13F filing and arrives weeks late. The filing quarter is not in the saved feed, so a newer download is not a newer quarter. It is not part of the business score.`,
  };
}

export function readAnalyst(row) {
  if (!row?.analyst_rating) return { rating: null, period: null, text: null };
  const period = dayOnly(row.analyst_period);
  return {
    rating: row.analyst_rating,
    period,
    text: `Analyst summary is ${row.analyst_rating}${period ? ` for ${period}` : ""}. That is an opinion, not a company filing, and it is not part of the score.`,
  };
}
