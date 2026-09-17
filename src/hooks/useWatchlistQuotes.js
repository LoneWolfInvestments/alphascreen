// src/hooks/useWatchlistQuotes.js
// Reads the pre-fetched, cron-refreshed watchlist from Supabase.
// This is the live-data replacement for AlphaScreen's old manual-entry table.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

export function useWatchlistQuotes() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("quotes")
      .select("*")
      .order("symbol", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setQuotes(data);
      if (data.length > 0) {
        setLastUpdated(
          data.reduce((latest, q) => (q.updated_at > latest ? q.updated_at : latest), data[0].updated_at)
        );
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchQuotes();

    const channel = supabase
      .channel("quotes-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, () => {
        fetchQuotes();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchQuotes]);

  return { quotes, loading, error, lastUpdated, refetch: fetchQuotes };
}
