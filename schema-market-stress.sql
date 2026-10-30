-- schema-market-stress.sql
-- Run this once in Supabase → SQL Editor → New query.
-- Paste this whole file (the contents, not the file name) and press Run.
-- Run it after schema.sql, schema-v2.sql, schema-rls-lockdown.sql,
-- schema-sell-signals.sql, and schema-daily-bars.sql.
-- Safe to run more than once. It does not add an API key or a new setting.
--
-- What you get:
--   * A market_stress table with one row per trading day. The nightly job
--     fills it from Cboe's public daily files plus the SPY and watchlist
--     prices already stored in daily_bars. The Market Stress tab reads it.
--     You do not type these numbers.
--
-- Who can see it:
--   * Anyone with the public site can read these rows. They are market data.
--   * The browser cannot write them. Only the nightly job can, using the
--     service-role key that stays on the server.

create table if not exists public.market_stress (
  as_of date primary key,
  vix numeric,
  vix3m numeric,
  vix_ratio numeric,
  skew numeric,
  spy_close numeric,
  spy_sma200 numeric,
  spy_above_sma200 boolean,
  spy_sma200_rising boolean,
  spy_bar_date date,
  breadth_above integer,
  breadth_total integer,
  breadth_pct numeric,
  regime text not null check (regime in ('green', 'amber', 'red')),
  reason text not null,
  updated_at timestamptz not null default now()
);

alter table public.market_stress enable row level security;
alter table public.market_stress force row level security;

revoke all on table public.market_stress from anon, authenticated;
grant select on table public.market_stress to anon, authenticated;
grant all on table public.market_stress to service_role;

drop policy if exists "public read market_stress" on public.market_stress;
create policy "public read market_stress"
  on public.market_stress
  for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Optional cleanup. Leave this commented. Running the file above does not
-- delete anything.
--
-- The old Positioning grid and the manual VIX box are gone from the app.
-- Their tables are still in the database so the old rows stay put.
-- Only if you later decide you do not want those rows, paste the two
-- statements below into a new query and run those. Do not uncomment them
-- inside this file.
--
-- drop table if exists public.positioning;
-- drop table if exists public.vix_snapshot;
-- ---------------------------------------------------------------------------
