import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { earningsDateFor, useEarningsMap } from "../hooks/useEarningsMap";
import { isEarningsSoon, nyToday } from "../lib/sellSignals";
import { sampleHoldings, sampleScreenerRows } from "../lib/sellSignalsSample";
import { buildSwingSample } from "../lib/swingSample";
import { assignRelativeStrengthRanks, viewRowFromQuote } from "../lib/swingSetups";
import { readBusinessFundamentals } from "../lib/businessFundamentals";
import { buildResearchQueue } from "../lib/researchQueue";
import { presentRegime } from "../lib/marketStress";
import { summarizeHealth } from "../lib/dataHealth";
import { sessionsBehind } from "../lib/sessionClock";
import { HealthBanner } from "./HealthBanner";
import { sampleMarketStressRows } from "../lib/marketStressSample";

const SAMPLE_CLOCK = new Date("2026-10-30T17:00:00Z");

function QueueList({ title, rows, empty }) {
  if (!rows.length) return <p className="sync-note">{empty}</p>;
  return (
    <section>
      <h3>{title} ({rows.length})</h3>
      {rows.map((row) => (
        <article key={`${title}-${row.ticker}`} className="sell-row info">
          <div className="sell-top">
            <strong className="sell-ticker">{row.ticker}</strong>
            <span className="badge setup-thin">{row.status}</span>
            {row.avoidNewEntry ? <span className="badge earn-badge">Avoid new entry — earnings</span> : null}
            <span className="sync-note">{row.rsRank == null ? "No relative-strength rank" : `Relative strength rank ${row.rsRank}`}</span>
          </div>
          <p>{row.trigger}</p>
          <p>{row.why}</p>
          <p>{row.invalidation}</p>
          <p>{row.company}</p>
          {row.barDate ? <p className="sync-note">Price session {row.barDate}.</p> : null}
        </article>
      ))}
    </section>
  );
}

export default function Today() {
  const sample = previewSample();
  const { ready, session } = useOwnerSession();
  const earnings = useEarningsMap();
  const [quotes, setQuotes] = useState([]);
  const [fundamentals, setFundamentals] = useState([]);
  const [held, setHeld] = useState([]);
  const [heldNote, setHeldNote] = useState("");
  const [stress, setStress] = useState(null);
  const [loading, setLoading] = useState(!sample);

  const load = useCallback(async () => {
    if (sample) return;
    const [quoteResult, fundamentalResult, portfolioResult, stressResult] = await Promise.all([
      supabase.from("quotes").select("symbol, price, setup_label, setup_reason, suggested_stop, risk_pct, rs_3m, rs_6m, rs_12m, rs_composite, bar_date, updated_at"),
      supabase.from("fundamental_scores").select("*"),
      supabase.from("portfolio").select("ticker"),
      supabase.from("market_stress").select("*").order("as_of", { ascending: false }).limit(1),
    ]);
    setQuotes(quoteResult.data || []);
    setFundamentals(fundamentalResult.data || []);
    if (portfolioResult.error) {
      setHeld([]);
      setHeldNote("Sign in to hide names you already hold. Until then a holding can still appear here.");
    } else {
      setHeld(portfolioResult.data || []);
      setHeldNote("");
    }
    setStress(stressResult.error ? null : (stressResult.data || [])[0] || null);
    setLoading(false);
  }, [sample]);

  useEffect(() => {
    if (sample) return undefined;
    if (!ready) return undefined;
    load();
    return undefined;
  }, [load, ready, sample, session?.user?.id]);

  const today = sample ? "2026-10-30" : nyToday();
  const model = useMemo(() => {
    const now = sample ? SAMPLE_CLOCK : new Date();
    if (sample) {
      const swing = buildSwingSample();
      const heldNames = new Set(sampleHoldings().map((row) => row.ticker));
      const businessByTicker = new Map(sampleScreenerRows().map((row) => [row.ticker, readBusinessFundamentals(row, { now })]));
      const ranked = assignRelativeStrengthRanks(swing.rows.map((row) => ({ ...row, symbol: row.symbol })));
      const queueRows = ranked.map((row) => {
        const business = businessByTicker.get(row.symbol);
        const earn = earningsDateFor(earnings.bySymbol, row.symbol, null);
        return {
          ticker: row.symbol,
          held: heldNames.has(row.symbol),
          label: row.label,
          reason: row.reason,
          stop: row.stop,
          rsRank: row.rsRank,
          freshness: "fresh",
          barDate: swing.barDate,
          businessCoverage: business?.coverage || "missing",
          businessSignal: business?.signal || null,
          earningsSoon: isEarningsSoon(earn, today),
        };
      });
      const stressRow = sampleMarketStressRows().at(-1);
      return {
        queue: buildResearchQueue(queueRows),
        health: summarizeHealth({
          quotes: ranked.map((row) => ({ bar_date: swing.barDate })),
          fundamentals: [...businessByTicker.values()],
          stress: stressRow,
          jobRuns: null,
          now,
        }),
        regime: presentRegime(stressRow, now),
      };
    }
    const ranked = assignRelativeStrengthRanks((quotes || []).map(viewRowFromQuote).filter(Boolean));
    const businessByTicker = new Map((fundamentals || []).map((row) => [row.ticker, readBusinessFundamentals(row, { now })]));
    const heldNames = new Set((held || []).map((row) => row.ticker));
    const queueRows = ranked.map((row) => {
      const business = businessByTicker.get(row.symbol);
      const quote = (quotes || []).find((item) => item.symbol === row.symbol);
      const info = sessionsBehind(quote?.bar_date, now);
      const earn = earningsDateFor(earnings.bySymbol, row.symbol, null);
      return {
        ticker: row.symbol,
        held: heldNames.has(row.symbol),
        label: row.label,
        reason: row.reason,
        stop: row.stop,
        rsRank: row.rsRank,
        freshness: info.state,
        barDate: quote?.bar_date ? String(quote.bar_date).slice(0, 10) : null,
        businessCoverage: business?.coverage || "missing",
        businessSignal: business?.signal || null,
        earningsSoon: isEarningsSoon(earn, today),
      };
    });
    return {
      queue: buildResearchQueue(queueRows),
      health: summarizeHealth({
        quotes,
        fundamentals: [...businessByTicker.values()],
        stress,
        jobRuns: null,
        now,
      }),
      regime: presentRegime(stress, now),
    };
  }, [earnings.bySymbol, fundamentals, held, quotes, sample, stress, today]);

  if (!sample && !ready) return <div className="panel"><h2>Today</h2><p>Loading…</p></div>;
  if (loading && !sample) return <div className="panel"><h2>Today</h2><p>Loading…</p></div>;

  const { queue, regime } = model;
  return (
    <div>
      {sample ? <div className="sample-banner">Sample prices and sample company figures. Not your account.</div> : null}
      <HealthBanner health={model.health} />
      <div className="panel">
        <h2>Today</h2>
        <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
          Names you do not hold. A research candidate is a fresh Breakout or Pullback. It is not a confirmed buy. Company figures and the market light are context and can disagree. Relative strength only sets the order.
          {regime.state === "fresh" ? ` Market session ${regime.asOf} is ${regime.regime}. That does not confirm a name.` : " Market light is not a current reading."}
          {heldNote ? ` ${heldNote}` : ""}
        </p>
        <p className="sync-note">{queue.rankBasis}</p>
        <QueueList title="Research candidates" rows={queue.candidates} empty="No fresh Breakout or Pullback on an unheld name." />
        <QueueList title="Wait — trend open, no trigger" rows={queue.waiting} empty="No unheld name is in an uptrend without a trigger." />
        <QueueList title="Not current" rows={queue.notCurrent} empty="No stale setups on unheld names." />
      </div>
    </div>
  );
}
