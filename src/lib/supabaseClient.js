// Browser connection. Uses the public anon key only.
// Signed-in requests also send the owner's session, which is what lets
// row-level security allow portfolio edits. The service-role key stays on the server.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Magic links put the session in the URL, so the link still works when
    // the email app opens it in a browser window.
    flowType: "implicit",
  },
});
