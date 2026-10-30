import { ATR, SMA } from "technicalindicators";

const ATR_PERIOD = 22;
const HIGH_LOOKBACK = 22;
const CHANDELIER_MULT = 3;
const SMA_PERIOD = 50;

// Derived from the same daily bars the indicator job already downloads.
// No extra Twelve Data call.
export function computeSellLevels({ closes, highs, lows }) {
  const safeCloses = Array.isArray(closes) ? closes : [];
  const safeHighs = Array.isArray(highs) ? highs : [];
  const safeLows = Array.isArray(lows) ? lows : [];

  const atrValues = safeCloses.length >= ATR_PERIOD + 1
    ? ATR.calculate({ period: ATR_PERIOD, high: safeHighs, low: safeLows, close: safeCloses })
    : [];
  const smaValues = safeCloses.length >= SMA_PERIOD
    ? SMA.calculate({ period: SMA_PERIOD, values: safeCloses })
    : [];

  const atr22 = atrValues.length ? atrValues[atrValues.length - 1] : null;
  const high22 = safeHighs.length >= HIGH_LOOKBACK
    ? Math.max(...safeHighs.slice(-HIGH_LOOKBACK))
    : null;
  const chandelier = high22 != null && atr22 != null && Number.isFinite(atr22)
    ? high22 - CHANDELIER_MULT * atr22
    : null;

  let streak = 0;
  if (smaValues.length > 0) {
    for (let i = safeCloses.length - 1; i >= SMA_PERIOD - 1; i -= 1) {
      const sma = smaValues[i - (SMA_PERIOD - 1)];
      if (!Number.isFinite(safeCloses[i]) || !Number.isFinite(sma)) break;
      if (safeCloses[i] < sma) streak += 1;
      else break;
    }
  }

  return {
    atr_22: atr22 != null && Number.isFinite(atr22) ? atr22 : null,
    high_22: Number.isFinite(high22) ? high22 : null,
    chandelier_stop: Number.isFinite(chandelier) ? chandelier : null,
    below_sma50_streak: streak,
  };
}

export function withoutSellColumns(row) {
  const {
    atr_22: _atr,
    high_22: _high,
    chandelier_stop: _stop,
    below_sma50_streak: _streak,
    bar_date: _barDate,
    ...rest
  } = row;
  return rest;
}

export function isMissingSellColumnError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /atr_22|high_22|chandelier_stop|below_sma50_streak|bar_date/.test(message);
}
