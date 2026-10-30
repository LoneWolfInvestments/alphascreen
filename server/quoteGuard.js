const SYMBOL = /^[A-Z0-9.]{1,12}$/;

export function normalizeSymbol(symbol) {
  if (typeof symbol !== "string") return null;
  const trimmed = symbol.trim().toUpperCase();
  if (!SYMBOL.test(trimmed)) return null;
  return trimmed;
}

// Live VIX uses 30 bars. Cap this so one call cannot ask for a huge history.
export function clampOutputSize(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  return Math.min(parsed, 60);
}

export function allowedInterval(value) {
  if (value == null || value === "") return "1day";
  return value === "1day" ? "1day" : null;
}
