// Secret-free job notes. A missing table does not fail the job.
// Never-run stays unknown: this file does not invent a success row.

const SECRET = /token=[^&\s]+|apikey=[^&\s]+|bearer\s+\S+|service_role|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi;

export function sanitizeJobText(value) {
  return String(value || "").replace(SECRET, "[redacted]").slice(0, 500);
}

export function jobStatusFromBody(code, body) {
  const failed = (Array.isArray(body?.failed) ? body.failed.length : 0)
    + (Array.isArray(body?.failedWindows) ? body.failedWindows.length : 0);
  if (code >= 400) return "failed";
  if (failed > 0) return "partial";
  return "ok";
}

export async function noteJob(supabase, { name, status, summary, detail }) {
  if (!supabase || !name) return { logged: false };
  try {
    const finished = new Date().toISOString();
    const { error } = await supabase.from("job_runs").insert({
      job_name: String(name).slice(0, 80),
      status: status === "partial" || status === "failed" ? status : "ok",
      summary: sanitizeJobText(summary),
      detail: sanitizeJobText(detail),
      finished_at: finished,
    });
    if (error) return { logged: false };
    const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("job_runs").delete().lt("started_at", cutoff);
    return { logged: true };
  } catch {
    return { logged: false };
  }
}

export async function sendJob(res, code, body, supabase, name) {
  const failed = Array.isArray(body?.failed) ? body.failed : [];
  await noteJob(supabase, {
    name,
    status: jobStatusFromBody(code, body),
    summary: body?.message || body?.error || `${name} finished`,
    detail: failed.map((item) => `${item.ticker || item.symbol || ""} ${item.error || ""}`).join("; "),
  });
  return res.status(code).json(body);
}
