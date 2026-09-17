-- schema.sql
-- Run this in the Supabase SQL editor (Project → SQL Editor → New Query)

-- The universe of symbols AlphaScreen should refresh on a schedule.
-- Manage this table directly (add/remove rows) instead of hardcoding symbols in code.
create table if not exists watchlist (
  symbol text primary key,
  added_at timestamptz default now(),
  active boolean default true
);

-- Cached quote + indicator snapshot per symbol, overwritten on each cron run.
-- One row per symbol — this is a "latest snapshot" table, not a time series.
create table if not exists quotes (
  symbol text primary key references watchlist(symbol) on delete cascade,
  price numeric,
  change numeric,
  percent_change numeric,
  volume bigint,
  rsi numeric,
  macd numeric,
  macd_signal numeric,
  bb_upper numeric,
  bb_middle numeric,
  bb_lower numeric,
  updated_at timestamptz default now()
);

-- Optional: keep historical snapshots instead of overwriting, if you want to backtest later
-- (this is the table to add once you get to the backtesting idea from earlier)
create table if not exists quotes_history (
  id bigint generated always as identity primary key,
  symbol text references watchlist(symbol) on delete cascade,
  price numeric,
  rsi numeric,
  macd numeric,
  recorded_at timestamptz default now()
);

-- Row-level security: allow public read (quotes are non-sensitive market data),
-- restrict writes to the service role (used only by your server-side cron function).
alter table watchlist enable row level security;
alter table quotes enable row level security;
alter table quotes_history enable row level security;

create policy "public read watchlist" on watchlist for select using (true);
create policy "public read quotes" on quotes for select using (true);
create policy "public read quotes_history" on quotes_history for select using (true);

-- Seed a starter watchlist — edit/add your own symbols
insert into watchlist (symbol) values
  ('AAPL'), ('MSFT'), ('NVDA'), ('AMZN'), ('GOOGL')
on conflict (symbol) do nothing;
