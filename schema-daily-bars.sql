-- schema-daily-bars.sql
-- Run this once in Supabase → SQL Editor → New query → paste the whole file → Run.
-- Run it after schema.sql, schema-v2.sql, schema-rls-lockdown.sql, and schema-sell-signals.sql.
-- Safe to run more than once.
--
-- What you get:
--   * A daily_bars table that keeps each trading day's open, high, low, close,
--     and volume. The nightly job fills it from the price download it already
--     makes, plus one extra download for SPY. Nothing here needs a new account
--     or a new API key.
--   * A few extra columns on quotes so the Technical Analysis tab can show a
--     plain-English setup (Breakout, Pullback, Uptrend with nothing to enter,
--     or Avoid) instead of the old plus/minus score.
--
-- Who can see it:
--   * Anyone with the public site can read these rows. They are market data.
--   * The browser cannot write them. Only the nightly job can, using the
--     service-role key that stays on the server.

create table if not exists public.daily_bars (
  symbol text not null,
  bar_date date not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric not null,
  volume bigint,
  updated_at timestamptz not null default now(),
  primary key (symbol, bar_date)
);

create index if not exists daily_bars_symbol_date_idx
  on public.daily_bars (symbol, bar_date desc);

alter table public.daily_bars enable row level security;
alter table public.daily_bars force row level security;

revoke all on table public.daily_bars from anon, authenticated;
grant select on table public.daily_bars to anon, authenticated;
grant all on table public.daily_bars to service_role;

drop policy if exists "public read daily_bars" on public.daily_bars;
create policy "public read daily_bars"
  on public.daily_bars
  for select
  to anon, authenticated
  using (true);

alter table public.quotes add column if not exists sma_20 numeric;
alter table public.quotes add column if not exists setup_label text;
alter table public.quotes add column if not exists setup_reason text;
alter table public.quotes add column if not exists rs_3m numeric;
alter table public.quotes add column if not exists rs_6m numeric;
alter table public.quotes add column if not exists rs_12m numeric;
alter table public.quotes add column if not exists rs_composite numeric;
alter table public.quotes add column if not exists days_since_breakout integer;
alter table public.quotes add column if not exists suggested_stop numeric;
alter table public.quotes add column if not exists risk_pct numeric;
alter table public.quotes add column if not exists breakout_volume_ok boolean;

notify pgrst, 'reload schema';
