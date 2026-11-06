// Tab names in the address bar, including the older names, and where they open.

export const VIEWS = Object.freeze(["signals", "mag7", "book", "more"]);

const ALIASES = {
  signals: { view: "signals" },
  today: { view: "signals" },
  opportunities: { view: "signals" },
  overview: { view: "signals" },
  mag7: { view: "mag7" },
  book: { view: "book", section: "risk" },
  holdings: { view: "book", section: "risk" },
  sell: { view: "book", section: "exits" },
  size: { view: "book", section: "size" },
  portfolio: { view: "book", section: "holdings" },
  journal: { view: "book", section: "journal" },
  setups: { view: "more", section: "setups" },
  technical: { view: "more", section: "setups" },
  more: { view: "more", section: "status" },
  stress: { view: "more", section: "stress" },
  vix: { view: "more", section: "stress" },
  fundamental: { view: "more", section: "fundamentals" },
  study: { view: "more", section: "study" },
  reallocation: { view: "more", section: "log" },
  positioning: { view: "more", section: "log" },
};

export function resolveRoute(search) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const key = params.get("tab") || "signals";
  const alias = ALIASES[key] || { view: "signals" };
  const view = VIEWS.includes(alias.view) ? alias.view : "signals";
  return {
    view,
    section: params.get("section") || alias.section || null,
    symbol: params.get("symbol") ? String(params.get("symbol")).toUpperCase() : null,
  };
}
