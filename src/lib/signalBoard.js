// Combines separate reads without averaging them into one vote.
// A stale input drops out of the action. A real disagreement stays visible.

import { TIMING_NOTE, freshnessSentence } from "./sessionClock.js";

export { TIMING_NOTE };

export const CATEGORIES = Object.freeze([
  "Earnings soon — skip new buy",
  "Exit rule hit",
  "New buy candidate",
  "Held — setup up, risk flag open",
  "Add to existing position",
  "Review position",
  "Business and price disagree",
  "Not current",
  "Neutral",
  "Partial",
  "Not enough saved data",
]);

const TONE = Object.freeze({
  "Earnings soon — skip new buy": "#f0b955",
  "Exit rule hit": "#f0555a",
  "New buy candidate": "#3ecf8e",
  "Held — setup up, risk flag open": "#f0b955",
  "Add to existing position": "#4f8dfd",
  "Review position": "#f0555a",
  "Business and price disagree": "#f0b955",
  "Not current": "#f0b955",
  Neutral: "#8b93a7",
  Partial: "#8b93a7",
  "Not enough saved data": "#8b93a7",
});

export function categoryTone(category) {
  return TONE[category] || "#8b93a7";
}

function pack(category, priority, headline, extra) {
  return { category, priority, headline, tone: categoryTone(category), ...extra };
}

export function decideAction({
  business,
  ownership,
  analyst,
  technical,
  sell,
  held,
  earningsSoon,
  regime,
} = {}) {
  const businessSignal = business?.signal || null;
  const technicalSignal = technical?.sig || null;
  const priceState = technical?.freshness?.state || "missing";
  const businessCoverage = business?.coverage || "missing";
  const reasons = [];
  if (business?.summary) reasons.push(business.summary);
  if (technical?.reasons?.length) reasons.push(technical.reasons[0]);
  if (ownership?.text) reasons.push(ownership.text);
  if (analyst?.text) reasons.push(analyst.text);
  if (technical?.stop != null && sell?.stop != null) {
    reasons.push("The setup stop and the Sell tab trailing stop are different rules. They are not averaged and they are not two votes.");
  }
  if (regime?.state === "fresh" && (regime.regime === "red" || regime.regime === "amber")) {
    const word = regime.regime === "red" ? "stressed" : "mixed";
    reasons.push(`Market backdrop for ${regime.asOf} is ${word}. That is the index, not this stock. It does not cancel the setup and it does not confirm it.`);
  }

  const shared = {
    reasons,
    businessScore: business?.score ?? null,
    businessSignal,
    technicalSignal,
    technicalLabel: technical?.displayLabel || technical?.label || null,
    priceState,
    businessCoverage,
  };

  const disagree = (businessSignal === "Buy" && technicalSignal === "Sell")
    || (businessSignal === "Caution" && technicalSignal === "Buy");
  const priceBlocked = priceState === "stale" || priceState === "delayed" || priceState === "ahead"
    || (priceState === "missing" && technical?.label);
  const businessBlocked = businessCoverage === "stale";

  if (held && sell?.status === "red") {
    const also = disagree
      ? " The company figures and the price trend also point different ways. That disagreement stays; the exit rule does not erase it."
      : " That exit rule is separate from whatever the entry setup says.";
    return pack("Exit rule hit", 1, `The trailing stop on the Sell tab is through the last close.${also}`, shared);
  }
  if (earningsSoon && !held && businessSignal === "Buy" && technicalSignal === "Buy") {
    return pack("Earnings soon — skip new buy", 0, "The business and the setup both point up, but the report is inside 5 trading days, so it stays off the new-buy list.", shared);
  }
  if (disagree) {
    const holding = held ? " You hold it, so read both before doing anything." : " You do not hold it.";
    return pack("Business and price disagree", 6, `The company figures and the price trend point different ways. That is a real disagreement, not a broken calculation.${holding}`, shared);
  }
  if (held && technicalSignal === "Sell") {
    return pack("Review position", 5, "You hold it and the price trend is down. The business read does not contradict that.", shared);
  }
  if (held && businessSignal === "Caution") {
    return pack("Review position", 5, "You hold it and the company figures look weak. That is not the same thing as the trailing stop.", shared);
  }
  if (!held && businessSignal === "Buy" && technicalSignal === "Buy") {
    return pack("New buy candidate", 2, "The business read and the entry setup both point up. Ownership, analyst opinions, RSI, and the market light are not extra votes.", shared);
  }
  if (held && businessSignal === "Buy" && technicalSignal === "Buy" && sell?.status === "amber") {
    return pack("Held — setup up, risk flag open", 3, "The entry setup is still there, and the Sell tab has a trim, size, or earnings decision. Those are different checks.", shared);
  }
  if (held && businessSignal === "Buy" && technicalSignal === "Buy") {
    return pack("Add to existing position", 4, "You already hold it, and the business read and the entry setup both point up.", shared);
  }
  if (priceBlocked || businessBlocked) {
    const sentence = priceBlocked
      ? (freshnessSentence(technical?.freshness, "prices") || "The saved price is not from the latest completed session.")
      : "The company snapshot is too old to score, so there is no combined action.";
    return pack("Not current", 7, sentence, shared);
  }
  if (businessSignal && technicalSignal) {
    return pack("Neutral", 8, "Neither side is an entry or a warning strong enough to sort this name higher.", shared);
  }
  if (businessSignal || technicalSignal || business?.hasFigures || technical?.label) {
    return pack("Partial", 9, "One side has a saved read and the other does not. The missing side is left blank instead of filled in.", shared);
  }
  return pack("Not enough saved data", 10, "Nothing saved yet for a business read or a setup.", shared);
}

export function agreementLabel({ business, technical } = {}) {
  const businessSignal = business?.signal || null;
  const technicalSignal = technical?.sig || null;
  const priceState = technical?.freshness?.state;
  if (priceState && priceState !== "fresh") return { label: "Price not current", tone: "#f0b955" };
  if (business?.coverage === "stale") return { label: "Fundamentals not current", tone: "#f0b955" };
  if (!businessSignal && !technicalSignal) return { label: "No current read", tone: "#8b93a7" };
  if (!businessSignal || !technicalSignal) return { label: "Partial", tone: "#8b93a7" };
  if (businessSignal === "Buy" && technicalSignal === "Buy") return { label: "Business and setup both up", tone: "#3ecf8e" };
  if (businessSignal === "Caution" && technicalSignal === "Sell") return { label: "Both look weak", tone: "#f0555a" };
  if ((businessSignal === "Buy" && technicalSignal === "Sell") || (businessSignal === "Caution" && technicalSignal === "Buy")) {
    return { label: "Business and price disagree", tone: "#f0b955" };
  }
  return { label: "Mixed", tone: "#8b93a7" };
}
