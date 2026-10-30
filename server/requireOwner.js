import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "./rateLimit.js";

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(req) {
  const header = req.headers?.authorization ?? req.headers?.["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return "";
  const token = header.slice("Bearer ".length).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

// Confirms the Supabase session belongs to an email in allowed_owners.
// Writes the error response and returns null when the check fails.
// `limit` / `windowMs` turn on the in-memory backstop for this route.
export async function requireOwner(req, res, options = {}) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Sign in required" });
    return null;
  }

  const supabase = serviceClient();
  if (!supabase) {
    res.status(500).json({ error: "Server auth is not configured" });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email || !data.user.email_confirmed_at) {
    res.status(401).json({ error: "Sign in required" });
    return null;
  }

  const { data: owner, error: ownerError } = await supabase
    .from("allowed_owners")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (ownerError) {
    res.status(500).json({
      error: "Owner check failed. Run schema-rls-lockdown.sql in the Supabase SQL editor if you have not yet.",
    });
    return null;
  }
  if (!owner) {
    res.status(403).json({ error: "This account is not allowed to use AlphaScreen." });
    return null;
  }

  if (options.limit) {
    const key = `${options.bucket || "api"}:${email}`;
    const allowed = rateLimit(key, options.limit, options.windowMs);
    if (!allowed) {
      res.status(429).json({ error: "Too many requests. Wait a bit and try again." });
      return null;
    }
  }

  return { email, supabase };
}
