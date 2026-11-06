// Manual long-trade notes. One entry and one exit. Nothing is sent to a broker,
// and nothing here changes the portfolio holdings.

export const SINGLE_FILL_LIMIT = "Each note is one entry and one exit. Partial sells are not calculated. Record a partial as its own closed note if you need the dollars.";

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function day(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function validateJournalEntry(input = {}) {
  const errors = [];
  const ticker = String(input.ticker || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) errors.push("Ticker is required.");
  const status = input.status === "closed" ? "closed" : input.status === "open" ? "open" : null;
  if (!status) errors.push("Status must be open or closed.");
  const shares = num(input.shares);
  const entry = num(input.entry_price);
  const exit = num(input.exit_price);
  const stop = num(input.planned_stop);
  const target = num(input.planned_target);
  const risk = num(input.planned_risk_usd);
  const cost = num(input.assumed_cost_usd);
  const opened = day(input.opened_on);
  const closed = day(input.closed_on);
  if (shares == null || shares <= 0) errors.push("Shares must be a positive number.");
  if (entry == null || entry <= 0) errors.push("Entry price must be a positive dollar amount.");
  if (stop != null && entry != null && stop >= entry) errors.push("Planned stop has to be below the entry.");
  if (target != null && entry != null && target <= entry) errors.push("Target has to be above the entry.");
  if (risk != null && risk < 0) errors.push("Planned risk cannot be negative.");
  if (cost != null && cost < 0) errors.push("Assumed cost cannot be negative.");
  if (input.opened_on && !opened) errors.push("Open date must be YYYY-MM-DD.");
  if (input.closed_on && !closed) errors.push("Close date must be YYYY-MM-DD.");
  if (opened && closed && closed < opened) errors.push("Close date cannot be before the open date.");
  if (status === "closed") {
    if (exit == null || exit <= 0) errors.push("A closed note needs an exit price.");
    if (!closed) errors.push("A closed note needs a close date.");
  }
  return { ok: errors.length === 0, errors, ticker, status, shares, entry, exit, stop, target, risk, cost, opened, closed };
}

export function planSnapshot(input) {
  const parsed = validateJournalEntry({ ...input, status: input.status || "open", closed_on: input.closed_on, exit_price: input.exit_price });
  return [
    `Ticker ${parsed.ticker || "?"}`,
    `Shares ${parsed.shares ?? "?"}`,
    `Entry ${parsed.entry ?? "?"}`,
    `Stop ${parsed.stop ?? "none"}`,
    `Target ${parsed.target ?? "none"}`,
    `Planned risk USD ${parsed.risk ?? "none"}`,
    `Thesis ${(input.thesis || "").trim() || "none"}`,
  ].join(". ");
}

// Gross is price difference times shares. Assumed cost is subtracted only when
// you typed one. A blank cost is not treated as zero dollars of fees in the label.
export function realisedResult(entry) {
  const shares = num(entry?.shares);
  const entryPrice = num(entry?.entry_price);
  const exitPrice = num(entry?.exit_price);
  const cost = num(entry?.assumed_cost_usd);
  if (entry?.status !== "closed" || shares == null || shares <= 0 || entryPrice == null || exitPrice == null) {
    return { gross: null, net: null, costKnown: cost != null, assumption: "Not closed, so there is no realised result." };
  }
  const gross = (exitPrice - entryPrice) * shares;
  if (cost == null) {
    return {
      gross,
      net: null,
      costKnown: false,
      assumption: "No cost was entered. The price result ignores fees and slippage.",
    };
  }
  return {
    gross,
    net: gross - cost,
    costKnown: true,
    assumption: "Net subtracts only the cost you typed. It is not a broker statement.",
  };
}

export function monthKey(iso) {
  const day = String(iso || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(day) ? day : null;
}

export function monthlyReview(entries) {
  const buckets = new Map();
  let openCount = 0;
  for (const entry of entries || []) {
    if (entry?.status !== "closed") {
      openCount += 1;
      continue;
    }
    const key = monthKey(entry.closed_on);
    if (!key) continue;
    const bucket = buckets.get(key) || {
      month: key,
      closed: 0,
      grossKnown: 0,
      gross: 0,
      netKnown: 0,
      net: 0,
      followed: 0,
      notFollowed: 0,
      notMarked: 0,
    };
    bucket.closed += 1;
    const result = realisedResult(entry);
    if (result.gross != null) {
      bucket.grossKnown += 1;
      bucket.gross += result.gross;
    }
    if (result.net != null) {
      bucket.netKnown += 1;
      bucket.net += result.net;
    }
    if (entry.process_followed === true) bucket.followed += 1;
    else if (entry.process_followed === false) bucket.notFollowed += 1;
    else bucket.notMarked += 1;
    buckets.set(key, bucket);
  }
  const months = [...buckets.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  return {
    months,
    openCount,
    note: "Process followed is the box you checked. It is not inferred from profit or loss.",
  };
}
