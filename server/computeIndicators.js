import { ADX, ATR, BollingerBands, MACD, RSI, SMA, WMA } from "technicalindicators";
import { priorChannel } from "../src/lib/swingSetups.js";

const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const BBANDS_PERIOD = 20;
const BBANDS_STDDEV = 2;
const ATR_PERIOD = 14;
const ADX_PERIOD = 14;
const SMA_SHORT_PERIOD = 50;
const SMA_LONG_PERIOD = 200;

function latest(values) {
  return values && values.length ? values[values.length - 1] : null;
}

// Classic snapshot fields kept on `quotes`. The 20-day channel excludes today
// so a bar cannot break out of a high it just set itself.
export function computeIndicators(bars) {
  const series = Array.isArray(bars) ? bars : [];
  const closes = series.map((bar) => bar.close);
  const highs = series.map((bar) => (Number.isFinite(bar.high) ? bar.high : bar.close));
  const lows = series.map((bar) => (Number.isFinite(bar.low) ? bar.low : bar.close));

  const rsiValues = closes.length > RSI_PERIOD
    ? RSI.calculate({ period: RSI_PERIOD, values: closes })
    : [];
  const macdValues = closes.length > MACD_SLOW
    ? MACD.calculate({
      fastPeriod: MACD_FAST,
      slowPeriod: MACD_SLOW,
      signalPeriod: MACD_SIGNAL,
      values: closes,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    })
    : [];
  const bbandsValues = closes.length >= BBANDS_PERIOD
    ? BollingerBands.calculate({ period: BBANDS_PERIOD, values: closes, stdDev: BBANDS_STDDEV })
    : [];
  const atrValues = closes.length > ATR_PERIOD
    ? ATR.calculate({ period: ATR_PERIOD, high: highs, low: lows, close: closes })
    : [];
  const adxValues = closes.length > ADX_PERIOD
    ? ADX.calculate({ period: ADX_PERIOD, close: closes, high: highs, low: lows })
    : [];
  const sma50Values = closes.length >= SMA_SHORT_PERIOD
    ? SMA.calculate({ period: SMA_SHORT_PERIOD, values: closes })
    : [];
  const sma200Values = closes.length >= SMA_LONG_PERIOD
    ? SMA.calculate({ period: SMA_LONG_PERIOD, values: closes })
    : [];
  const wma200Values = closes.length >= SMA_LONG_PERIOD
    ? WMA.calculate({ period: SMA_LONG_PERIOD, values: closes })
    : [];

  const latestMacd = latest(macdValues);
  const latestBbands = latest(bbandsValues);
  const channel = priorChannel(series, 20);
  const middle = channel.high != null && channel.low != null ? (channel.high + channel.low) / 2 : null;

  return {
    rsi: latest(rsiValues) ?? null,
    macd: latestMacd?.MACD ?? null,
    macd_signal: latestMacd?.signal ?? null,
    bb_upper: latestBbands?.upper ?? null,
    bb_middle: latestBbands?.middle ?? null,
    bb_lower: latestBbands?.lower ?? null,
    atr: latest(atrValues) ?? null,
    adx: latest(adxValues)?.adx ?? null,
    sma_50: latest(sma50Values) ?? null,
    sma_200: latest(sma200Values) ?? null,
    wma_200: latest(wma200Values) ?? null,
    donchian_upper: channel.high,
    donchian_lower: channel.low,
    donchian_middle: middle,
  };
}
