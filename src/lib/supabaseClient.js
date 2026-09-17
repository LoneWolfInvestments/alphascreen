// src/lib/supabaseClient.js
// Client-side Supabase connection using the anon (public, read-only) key.
// Safe to expose in the browser — the schema's RLS policies restrict this key to SELECT only.
// Vite exposes env vars prefixed VITE_ via import.meta.env.

import { createClient } from "@supabase/supabase-js";

// Falls back to CONFIG_SUPABASE_URL if that's the name it ended up saved under in Vercel
// (Vercel's dashboard sometimes pushes non-secret-looking values into a "Config" naming
// instead of allowing the VITE_ public prefix directly).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.CONFIG_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.CONFIG_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
