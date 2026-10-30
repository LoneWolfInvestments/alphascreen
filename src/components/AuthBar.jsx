import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOwnerSession } from "../hooks/useOwnerSession";
import { previewSample } from "../lib/previewSample";

export default function AuthBar() {
  const { ready, session } = useOwnerSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const sendLink = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setSending(true);
    setStatus("");
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    setStatus(error ? error.message : "Check your email for a sign-in link, then open it in this browser.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setStatus("");
  };

  if (previewSample()) {
    return (
      <div className="auth-bar">
        <span className="auth-note">Sample preview. This is not your portfolio.</span>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="auth-bar">
        <span className="auth-note">Checking sign-in...</span>
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="auth-bar">
        <span className="auth-note">Signed in as {session.user.email}</span>
        <button type="button" className="action secondary" onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="auth-bar">
      <input
        id="owner-email"
        type="email"
        autoComplete="email"
        aria-label="Owner email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") sendLink(); }}
        placeholder="Owner email"
      />
      <button type="button" className="action" onClick={sendLink} disabled={sending}>
        {sending ? "Sending..." : "Email me a link"}
      </button>
      {status
        ? <span className="auth-note">{status}</span>
        : <span className="auth-note">Sign in to see your portfolio and sell signals.</span>}
    </div>
  );
}
