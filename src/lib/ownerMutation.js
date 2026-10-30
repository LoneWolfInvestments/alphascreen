// Shows a plain message when a save is rejected. Returns true when it failed.
export async function ownerMutationFailed(resultPromise) {
  const { error } = await resultPromise;
  if (!error) return false;

  const denied = error.code === "42501" || /row-level security/i.test(error.message || "");
  const message = denied
    ? "Sign in with your owner email at the top of the page, then try again."
    : "Could not save that change. " + (error.message || "Unknown error");
  alert(message);
  return true;
}
