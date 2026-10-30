// Best-effort limit for one running serverless instance.
// Vercel does not share memory across instances, so this is a backstop
// for a leaked session, not a perfect global counter. Sign-in is the real gate.
const buckets = new Map();

export function rateLimit(key, limit, windowMs, now = Date.now()) {
  const previous = buckets.get(key) || [];
  const recent = previous.filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
