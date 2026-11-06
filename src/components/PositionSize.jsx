import React, { useState } from "react";
import {
  RISK_NOT_GUARANTEED,
  formatUsdFromCents,
  readPositionForm,
  zeroShareMessage,
} from "../lib/positionSize";

const EMPTY = {
  portfolio: "",
  entry: "",
  stop: "",
  risk: "1",
  cash: "",
  target: "",
};

const FIELDS = [
  { key: "portfolio", label: "Portfolio value (USD)", hint: "The whole account, in dollars." },
  { key: "entry", label: "Entry price (USD)", hint: "The price you plan to pay. Not filled from the quote table." },
  { key: "stop", label: "Stop price (USD)", hint: "Must be below the entry. Long stock or ETF only." },
  { key: "risk", label: "Risk (% of portfolio)", hint: "Starts at 1%. Above 0 and at most 100." },
  { key: "cash", label: "Available cash (USD, optional)", hint: "Leave blank if you do not want a cash cap. Blank is not the same as $0." },
  { key: "target", label: "Target price (USD, optional)", hint: "Only for a profit and reward/risk figure. Must be above the entry." },
];

function Field({ id, label, hint, value, error, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-hint`} className="sync-note">{hint}</p>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="stat-box">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note ? <div className="sync-note">{note}</div> : null}
    </div>
  );
}

export function PositionSizeView({ values, onChange, onClear }) {
  const form = readPositionForm(values);
  const errorFor = (field) => form.errors.find((item) => item.field === field)?.message || "";
  const result = form.result;

  return (
    <div className="panel">
      <h2>Position size</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        Long stock or ETF only. Every amount is US dollars. You type the prices. Saved quotes are not copied in, because a stored close is not a live price. The math stays in this browser. Nothing is sent and no order is placed.
      </p>
      <div className="size-form">
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            id={`size-${field.key}`}
            label={field.label}
            hint={field.hint}
            value={values[field.key]}
            error={errorFor(field.key)}
            onChange={(next) => onChange(field.key, next)}
          />
        ))}
      </div>
      <button type="button" className="action secondary" onClick={onClear}>Clear</button>

      <div aria-live="polite">
        {form.status === "blank" || form.status === "incomplete" ? (
          <p className="sync-note">Enter portfolio value, entry, and stop. Risk is already 1% and you can change it.</p>
        ) : null}
        {form.status === "invalid" ? (
          <p className="field-error">Fix the fields above. No share count is shown until the inputs are valid.</p>
        ) : null}
        {form.status === "ready" && result ? (
          <>
            <div className="grid-3" style={{ marginTop: 16 }}>
              <Stat label="Risk budget (USD)" value={formatUsdFromCents(result.riskBudgetCents)} note="Portfolio times the risk percent." />
              <Stat label="Whole shares" value={String(result.shares)} note={result.shares === 0 ? "Rounded down to zero." : "Rounded down."} />
              <Stat label="Purchase cost (USD)" value={formatUsdFromCents(result.costCents)} note={result.positionWeight == null ? "" : `${(result.positionWeight * 100).toFixed(1)}% of the portfolio.`} />
              <Stat label="Planned loss at stop (USD)" value={formatUsdFromCents(result.plannedLossCents)} note="Shares times (entry minus stop)." />
              <Stat
                label="Potential profit (USD)"
                value={result.profitCents == null ? "—" : formatUsdFromCents(result.profitCents)}
                note={result.profitCents == null ? "No target entered." : "If the target is hit. Not a forecast."}
              />
              <Stat
                label="Reward / risk"
                value={result.rewardRisk == null ? "—" : `${result.rewardRisk.toFixed(2)} to 1`}
                note={result.rewardRisk == null ? "No target entered." : "From the prices, before fees."}
              />
            </div>
            {result.zeroReason ? <p className="sample-banner">{zeroShareMessage(result.zeroReason)}</p> : null}
            {result.warnings.map((warning) => <p key={warning} className="sync-note">{warning}</p>)}
          </>
        ) : null}
      </div>
      <p className="disclaimer">{RISK_NOT_GUARANTEED}</p>
    </div>
  );
}

export default function PositionSize() {
  const [values, setValues] = useState(EMPTY);
  const onChange = (key, next) => setValues((current) => ({ ...current, [key]: next }));
  return <PositionSizeView values={values} onChange={onChange} onClear={() => setValues(EMPTY)} />;
}
