// Whether the holdings figures are allowed to look like a result.

export function holdingsAccess({ ready = false, signedIn = false, pending = false, error = null, count = 0 } = {}) {
  if (!ready || pending) return { status: "loading" };
  if (!signedIn) return { status: "private" };
  if (error) return { status: "error" };
  if (!count) return { status: "empty" };
  return { status: "ready" };
}
