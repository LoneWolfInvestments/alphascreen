import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { previewSample } from "../lib/previewSample";

// ready is false until we know whether a session is stored.
// Wait for that before reading the portfolio, or the first request goes out
// as the anon key and comes back empty.
export function useOwnerSession() {
  const [state, setState] = useState({ ready: false, session: null });

  useEffect(() => {
    if (previewSample()) {
      setState({ ready: true, session: null });
      return undefined;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ ready: true, session: data.session ?? null });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setState({ ready: true, session: next ?? null });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
