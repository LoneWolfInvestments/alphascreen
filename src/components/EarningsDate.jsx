import React from "react";
import { formatDay, isEarningsSoon, nyToday, tradingDaysUntil } from "../lib/sellSignals";

export default function EarningsDate({ date, today }) {
  const asOf = today || nyToday();
  if (!date) return <span>—</span>;
  const soon = isEarningsSoon(date, asOf);
  const days = tradingDaysUntil(asOf, date);
  const label = !soon
    ? null
    : days === 0
      ? "Reports today — skip new buys"
      : `In ${days} trading day${days === 1 ? "" : "s"} — skip new buys`;

  return (
    <span className={soon ? "earn-soon" : undefined}>
      {formatDay(date)}
      {label && <span className="badge earn-badge">{label}</span>}
    </span>
  );
}
