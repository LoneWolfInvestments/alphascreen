// Realistic preview rows for ?sample=1. The latest day uses the Cboe closes
// from 2026-10-29 (VIX 17.20, VIX3M 19.37, SKEW 151.03). SPY and breadth are
// illustrative. The banner on the tab says these are sample figures.

import { classifyRegime } from "./marketStress.js";

export const SAMPLE_AS_OF = "2026-10-29";

function weekdaysEnding(end, count) {
  const dates = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function phase(index) {
  if (index < 5) {
    const vix = 36 - index;
    return {
      vix,
      vix3m: 29.5,
      skew: 142,
      spyAboveSma200: false,
      spySma200Rising: false,
      breadthPct: 28,
      breadthTotal: 29,
      spyClose: 608 + index,
      spySma200: 641,
      breadthAbove: 8,
    };
  }
  if (index < 15) {
    const vix = 26 - (index - 5) * 0.4;
    return {
      vix: Math.round(vix * 10) / 10,
      vix3m: 28,
      skew: 134,
      spyAboveSma200: true,
      spySma200Rising: false,
      breadthPct: 48,
      breadthTotal: 29,
      spyClose: 650 + (index - 5),
      spySma200: 643,
      breadthAbove: 14,
    };
  }
  if (index < 28) {
    return {
      vix: Math.round((18.4 - (index - 15) * 0.12) * 10) / 10,
      vix3m: 19.4,
      skew: 136,
      spyAboveSma200: true,
      spySma200Rising: true,
      breadthPct: 64,
      breadthTotal: 28,
      spyClose: 668,
      spySma200: 640,
      breadthAbove: 18,
    };
  }
  if (index === 28) {
    return {
      vix: 16.91,
      vix3m: 19.22,
      skew: 148.74,
      spyAboveSma200: true,
      spySma200Rising: true,
      breadthPct: 64,
      breadthTotal: 28,
      spyClose: 671.2,
      spySma200: 640.8,
      breadthAbove: 18,
    };
  }
  return {
    vix: 17.2,
    vix3m: 19.37,
    skew: 151.03,
    spyAboveSma200: true,
    spySma200Rising: true,
    breadthPct: 61,
    breadthTotal: 28,
    spyClose: 672.4,
    spySma200: 641.2,
    breadthAbove: 17,
  };
}

export function sampleMarketStressRows() {
  return weekdaysEnding(SAMPLE_AS_OF, 30).map((asOf, index) => {
    const input = phase(index);
    const classified = classifyRegime(input);
    return {
      as_of: asOf,
      vix: input.vix,
      vix3m: input.vix3m,
      vix_ratio: classified.vixRatio,
      skew: input.skew,
      spy_close: input.spyClose,
      spy_sma200: input.spySma200,
      spy_above_sma200: input.spyAboveSma200,
      spy_sma200_rising: input.spySma200Rising,
      spy_bar_date: asOf,
      breadth_above: input.breadthAbove,
      breadth_total: input.breadthTotal,
      breadth_pct: input.breadthPct,
      regime: classified.regime,
      reason: classified.reason,
    };
  });
}
