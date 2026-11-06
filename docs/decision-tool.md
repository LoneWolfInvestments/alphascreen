# How the screens fit together

The top bar has four items.

- Today lists names you do not hold. A fresh Breakout or Pullback is a research candidate, not a confirmed buy. If company figures are missing or stale, the name stays visible with that warning. Earnings inside five sessions are marked avoid-new-entry. The order is relative strength versus SPY.
- My holdings is the book you already own: planned downside at the trailing exit stop, exit checks, the position-size calculator, the holdings editor, and the private journal.
- Setups is the price evidence: trend gate, relative strength, the entry trigger, and the 2×ATR(14) entry stop.
- More holds company fundamentals, the market-stress history, the setup study, MAG7, notes, and data status.

Old links still open the same work. `?tab=sell` opens exits. `?tab=size` opens the calculator. `?tab=technical` opens Setups. `?tab=fundamental`, `?tab=study`, `?tab=stress`, and `?tab=mag7` open the matching section under More.

Prices are the daily close. A new download of the same session is not a new session. The market light stays blank until its nightly job has saved a row. This app does not place orders.

## Journal and job history

After the site update is live, run these two files in the Supabase SQL editor, in this order. Paste each whole file. Do not run a job by hand.

1. `schema-trade-journal.sql`
2. `schema-job-runs.sql`

The journal is one entry and one exit per note. It does not change the holdings table. Job history starts empty. Empty means no run has been recorded yet, which is not the same as a failed run.
