// One nightly read of Cboe's public daily index history files.
// cdn.cboe.com redirects to cdn-api.cboe.com; fetch follows that.
// Terms: https://www.cboe.com/en/terms/ — one personal, non-commercial
// download is allowed. Storing, displaying, or building a product from the
// files needs Cboe's consent, except fair use. This job keeps only the latest
// close (plus the ratio and the regime sentence), not the history file.

import { alignCboeCloses, parseCboeDailyCsv } from "../src/lib/marketStress.js";

export const CBOE_FILES = [
  {
    key: "vix",
    column: "CLOSE",
    url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
  },
  {
    key: "vix3m",
    column: "CLOSE",
    url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv",
  },
  {
    key: "skew",
    column: "SKEW",
    url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/SKEW_History.csv",
  },
];

export const CBOE_PAUSE_MS = 750;

const USER_AGENT = "AlphaScreen personal dashboard (one nightly read of the public daily history file)";

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSeries(fetchImpl, file) {
  const res = await fetchImpl(file.url, {
    redirect: "follow",
    headers: {
      Accept: "text/csv,text/plain",
      "User-Agent": USER_AGENT,
    },
  });
  if (!res?.ok) {
    throw new Error(`Cboe returned ${res?.status || "no response"} for ${file.key}`);
  }
  const text = await res.text();
  const rows = parseCboeDailyCsv(text, file.column);
  if (!rows.length) throw new Error(`Cboe ${file.key} file had no data rows`);
  return rows;
}

export async function fetchCboeSnapshot(fetchImpl = globalThis.fetch, { pauseMs = CBOE_PAUSE_MS } = {}) {
  const series = {};
  for (let index = 0; index < CBOE_FILES.length; index += 1) {
    if (index > 0) await sleep(pauseMs);
    const file = CBOE_FILES[index];
    series[file.key] = await fetchSeries(fetchImpl, file);
  }
  return alignCboeCloses(series);
}
