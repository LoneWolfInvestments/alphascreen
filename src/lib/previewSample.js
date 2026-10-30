// Local preview only. Production builds replace DEV with false, so this
// never turns on for the live site.
export function previewSample() {
  return import.meta.env.DEV
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("sample") === "1";
}
