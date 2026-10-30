import { supabase } from "./supabaseClient";

// fetch() with the owner's Supabase access token, for /api/quote.
export async function ownerFetch(url, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return new Response(
      JSON.stringify({ error: "Sign in with your owner email (top of the page) first." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
