# Position size

The Position size tab is a calculator for a long stock or ETF. It runs in the browser. It does not read quotes, call an API, or place an order.

Type the numbers yourself. A price saved overnight is not copied in, because that close is not a live price.

## What you enter

- Portfolio value, in US dollars.
- Entry price, in US dollars.
- Stop price, in US dollars. It must be below the entry.
- Risk, as a percent of the portfolio. It starts at 1%. It must be above 0 and at most 100.
- Available cash, optional. Leave it blank if you are not applying a cash limit. Blank does not mean you have $0, and it does not mean the app knows what you can spend.
- Target price, optional. Use it only if you want a profit figure and a reward-to-risk ratio. It must be above the entry.

Dollars and prices use cents. `100` and `100.50` are accepted. `10.125` and `1e5` are not.

## What you get

- Risk budget: portfolio value times the risk percent.
- Whole shares, rounded down.
- Purchase cost: shares times the entry.
- Planned loss at the stop: shares times (entry minus stop). After rounding, this is at or under the risk budget.
- If you typed a target: potential profit, and reward/risk from those prices.

The share count is the smallest of three limits:

1. How many shares the risk budget can lose at that stop.
2. How many shares the cash you typed can buy, when you typed cash.
3. How many shares the whole portfolio could pay for. If you left cash blank, this cap still applies so the suggestion cannot cost more than the account. It is a ceiling, not a statement that the cash is available.

A result of 0 shares means one share does not fit the risk budget, the cash you typed, or the portfolio. The page says which one.

If the cost is over 25% of the portfolio, the page says so. That is the same single-name cap used elsewhere. The calculator does not silently cut the shares to 25%.

## What the loss figure is not

The planned loss assumes you sell at the stop you typed. A gap through the stop, slippage, or fees can lose more. The page does not send that order anywhere.
