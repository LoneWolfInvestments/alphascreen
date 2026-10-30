import { timingSafeEqual } from "node:crypto";

// Cron routes must reject everyone when CRON_SECRET is missing.
// A check written as `Bearer ${process.env.CRON_SECRET}` turns into the
// literal header "Bearer undefined" in that case, which is not a secret.
export function cronAuthorized(authHeader, secret) {
  if (typeof secret !== "string" || secret.length === 0 || secret === "undefined") {
    return false;
  }

  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (typeof header !== "string") return false;

  const expected = `Bearer ${secret}`;
  const received = Buffer.from(header);
  const wanted = Buffer.from(expected);
  if (received.length !== wanted.length) return false;
  return timingSafeEqual(received, wanted);
}

// Sends 401 and returns true when the caller is not Vercel Cron.
export function rejectIfCronUnauthorized(req, res) {
  const header = req.headers?.authorization ?? req.headers?.["authorization"];
  if (cronAuthorized(header, process.env.CRON_SECRET)) return false;
  res.status(401).json({ error: "Unauthorized" });
  return true;
}
