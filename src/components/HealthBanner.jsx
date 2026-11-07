import React from "react";

export function HealthBanner({ health }) {
  if (!health) return null;
  return (
    <div>
      <ul className="plain-list">
        {health.lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="sync-note">These are end-of-day saves. A newer download of the same session is not a new session. Gaps stay visible. This is not a certificate that everything is current.</p>
    </div>
  );
}
