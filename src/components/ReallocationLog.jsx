import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { ownerMutationFailed } from "../lib/ownerMutation";
import { useOwnerSession } from "../hooks/useOwnerSession";

export default function ReallocationLog() {
  const { ready, session } = useOwnerSession();
  const [log, setLog] = useState([]);
  const [logForm, setLogForm] = useState({ action: "", rationale: "" });

  const loadLog = useCallback(async () => {
    const { data } = await supabase.from("reallocation_log").select("*").order("created_at", { ascending: false });
    setLog(data || []);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    loadLog();
    const channel = supabase
      .channel("reallocation-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "reallocation_log" }, loadLog)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadLog, ready, session?.user?.id]);

  const addLog = async () => {
    if (!logForm.action.trim()) return;
    const failed = await ownerMutationFailed(
      supabase.from("reallocation_log").insert({ action: logForm.action.trim(), rationale: logForm.rationale.trim() })
    );
    if (failed) return;
    setLogForm({ action: "", rationale: "" });
  };

  const removeLog = async (id) => {
    await ownerMutationFailed(supabase.from("reallocation_log").delete().eq("id", id));
  };

  return (
    <div className="panel">
      <h2>Reallocation Log</h2>
      <p className="disclaimer" style={{ marginTop: 0, marginBottom: 12, borderTop: "none", paddingTop: 0 }}>
        A private note of what you changed and why. Only the signed-in owner can see it.
      </p>
      <div className="add-form">
        <div className="field" style={{ minWidth: 180 }}>
          <label>Action</label>
          <input value={logForm.action} onChange={(e) => setLogForm({ ...logForm, action: e.target.value })} placeholder="Trimmed AAPL 5%" />
        </div>
        <div className="field" style={{ minWidth: 260 }}>
          <label>Rationale</label>
          <input value={logForm.rationale} onChange={(e) => setLogForm({ ...logForm, rationale: e.target.value })} placeholder="Reason for the move" />
        </div>
        <button className="action" onClick={addLog}>Log</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Action</th><th>Rationale</th><th></th></tr>
          </thead>
          <tbody>
            {log.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleDateString()}</td>
                <td>{row.action}</td>
                <td>{row.rationale}</td>
                <td><button className="action danger" onClick={() => removeLog(row.id)}>x</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.length === 0 && (
          <div className="empty">
            {!ready
              ? "Loading..."
              : session
                ? "No reallocation entries yet."
                : "Sign in (top of the page) to see your reallocation log."}
          </div>
        )}
      </div>
    </div>
  );
}
