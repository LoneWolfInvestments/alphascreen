# How the screens fit together

The top bar has four items.

- Signals is the first screen. Each name leads with an overall label: Buy candidate, Hold / Wait, Sell / Exit review, Avoid / Not ready, or Data check. Fundamentals, technicals, and supporting context are Positive, Negative, Mixed, or Unknown. They are not added into a score. A buy candidate needs positive company figures and a fresh breakout or pullback, and earnings must not be inside five sessions. Unknown company figures do not count as positive. Sell / Exit review is only for a holding whose trailing exit stop is through. An unheld weak trend is Avoid, not a short.
- MAG7 is its own tab. It ranks AAPL, MSFT, GOOGL, AMZN, META, and NVDA. Tesla is not added.
- My holdings is the book you already own: planned downside, exit checks, the position-size calculator, the holdings editor, and the private journal.
- More holds company fundamentals (where you add or remove names), setups, the setup study, market-stress history, notes, and data status.

Old links still open. `?tab=sell` opens exits. `?tab=size` opens the calculator. `?tab=technical` and `?tab=setups` open Setups under More. `?tab=mag7` opens the MAG7 tab.

Prices are the daily close. A new download of the same session is not a new session. The market light stays blank until its nightly job has saved a row. This app does not place orders.

## Journal and job history

After the site update is live, run these two files in the Supabase SQL editor, in this order. Paste each whole file. Do not run a job by hand.

1. `schema-trade-journal.sql`
2. `schema-job-runs.sql`

The journal is one entry and one exit per note. It does not change the holdings table. Job history starts empty. Empty means no run has been recorded yet, which is not the same as a failed run.
