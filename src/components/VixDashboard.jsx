// src/components/VixDashboard.jsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

export default function VixDashboard() {
  const [vix, setVix] = useState("");
  const [ma, setMa] = useState("");
  const [saved, setSaved] = useState(null);
  const [fetchingLive, setFetchingLive] = useState(false);
  const [liveError, setLiveError] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("vix_snapshot").select("*").maybeSingle();
    if (data) {
      setSaved(data);
      setVix(data.vix ?? "");
      setMa(data.ma30 ?? "");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = async () => {
    const v = parseFloat(vix);
    const m = parseFloat(ma);
    if (isNaN(v) || isNaN(m)) return;
    await supabase.from("vix_snapshot").upsert({ id: true, vix: v, ma30: m, updated_at: new Date().toISOString() });
    setSaved({ vix: v, ma30: m });
  };

  const fetchLive = async () => {
    setFetchingLive(true);
    setLiveError(null);
    try {
      const quoteRes = await fetch("/api/quote?symbol=VIX&endpoint=quote");
      const quoteData = await quoteRes.json();
      if (quoteData.error || quoteData.status === "error") {
        throw new Error(quoteData.error || quoteData.message || "VIX not available on this plan");
      }
      const currentVix = parseFloat(quoteData.close);

      const seriesRes = await fetch("/api/quote?symbol=VIX&endpoint=time_series&outputsize=30");
      const seriesData = await seriesRes.json();
      if (seriesData.error || seriesData.status === "error" || !seriesData.values) {
        throw new Error(seriesData.error || seriesData.message || "VIX history not available on this plan");
      }
      const closes = seriesData.values.map((v) => parseFloat(v.close));
      const avg30 = closes.reduce((a, b) => a + b, 0) / closes.length;

      setVix(currentVix.toFixed(2));
      setMa(avg30.toFixed(2));
      await supabase.from("vix_snapshot").upsert({
        id: true, vix: currentVix, ma30: avg30, updated_at: new Date().toISOString(),
      });
      setSaved({ vix: currentVix, ma30: avg30 });
    } catch (err) {
      setLiveError(err.message + " — your Twelve Data plan may not include index data. Manual entry below still works fine.");
    } finally {
      setFetchingLive(false);
    }
  };

  const deviation = saved ? ((saved.vix - saved.ma30) / saved.ma30) * 100 : null;
  let zone = "Neutral", zoneColor = "#f0b955";
  if (deviation != null) {
    if (deviation > 20) { zone = "Elevated Fear — mean-reversion zone"; zoneColor = "#3ecf8e"; }
    else if (deviation < -20) { zone = "Complacency — caution zone"; zoneColor = "#f0555a"; }
  }

  return (
    <div className="panel">
      <h2>VIX Signal (JPMorgan 30-Day MA Deviation Framework)</h2>

      <div style={{ marginBottom: 12 }}>
        <button className="action secondary" onClick={fetchLive} disabled={fetchingLive}>
          {fetchingLive ? "Fetching..." : "Fetch live VIX"}
        </button>
        {liveError && <div style={{ color: "#f0555a", fontSize: 12, marginTop: 8 }}>{liveError}</div>}
      </div>

      <div className="add-form">
        <div className="field">
          <label>Current VIX</label>
          <input type="number" step="0.01" value={vix} onChange={(e) => setVix(e.target.value)} />
        </div>
        <div className="field">
          <label>30-Day MA of VIX</label>
          <input type="number" step="0.01" value={ma} onChange={(e) => setMa(e.target.value)} />
        </div>
        <button className="action" onClick={update}>Update</button>
      </div>

      {saved && (
        <>
          <div className="grid-3" style={{ marginTop: 16 }}>
            <div className="stat-box"><div className="label">Current VIX</div><div className="value">{Number(saved.vix).toFixed(2)}</div></div>
            <div className="stat-box"><div className="label">30-Day MA</div><div className="value">{Number(saved.ma30).toFixed(2)}</div></div>
            <div className="stat-box"><div className="label">Deviation</div><div className="value">{deviation.toFixed(1)}%</div></div>
          </div>
          <div style={{ marginTop: 16 }}>
            <span className="badge" style={{ background: zoneColor + "26", color: zoneColor }}>{zone}</span>
          </div>
        </>
      )}
      {!saved && <div className="empty">No VIX data yet — try "Fetch live VIX" or enter values manually above.</div>}
      <p className="disclaimer">
        Deviation = (VIX − 30d MA) ÷ 30d MA. Rough zones: above +20% = elevated fear (historically favors mean-reversion entries);
        below −20% = complacency (historically a caution zone). This mirrors the shape of JPMorgan's published framework —
        treat exact thresholds as approximate, not house-calibrated. "Fetch live VIX" tries Twelve Data's index endpoint;
        if your plan doesn't include it, manual entry still works.
      </p>
    </div>
  );
}

