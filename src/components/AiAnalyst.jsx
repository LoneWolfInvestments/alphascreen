// src/components/AiAnalyst.jsx
import React, { useState, useRef } from "react";

export default function AiAnalyst() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const logRef = useRef(null);

  const ask = async () => {
    const question = input.trim();
    if (!question) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ask-analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (data.error) {
        setMessages((m) => [...m, { role: "ai", text: "Error: " + data.error }]);
      } else {
        setMessages((m) => [...m, { role: "ai", text: data.text }]);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: "ai", text: "Error: could not reach the analyst." }]);
    } finally {
      setLoading(false);
      setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
    }
  };

  return (
    <div className="panel">
      <h2>AI Analyst</h2>
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>{m.text}</div>
        ))}
        {loading && <div className="chat-msg ai">Thinking...</div>}
      </div>
      <div className="add-form">
        <input
          style={{ flex: 1, minWidth: 240 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="e.g. Bear case for NVDA at current multiple?"
        />
        <button className="action" onClick={ask} disabled={loading}>Ask</button>
        <button className="action secondary" onClick={() => setMessages([])}>Clear</button>
      </div>
      <p className="disclaimer">Answers are generated on demand and aren't saved as trade recommendations — verify specific figures independently.</p>
    </div>
  );
}
