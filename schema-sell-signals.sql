-- schema-sell-signals.sql
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
-- Run it AFTER schema.sql, schema-v2.sql, and schema-rls-lockdown.sql.
-- Safe to run more than once.
--
-- What it adds:
--   * Extra price columns the nightly job needs for the Sell Signals tab
--     (22-day high, ATR(22), trailing stop, days under the 50-day average,
--     and the trading day those numbers came from).
--   * A theme column on your portfolio, plus a one-time fill-in for the
--     current book when theme is still blank. You can change any theme later
--     in the Sell Signals tab. This does not add or remove holdings.
--   * A small earnings-date table. Anyone can read it (it is public market
--     data). Only you, or the nightly job, can write it.

-- Columns the indicator job has already been saving on existing projects.
-- A brand-new database needs them too. Existing columns are left alone.
alter table public.quotes add column if not exists atr numeric;
alter table public.quotes add column if not exists adx numeric;
alter table public.quotes add column if not exists sma_50 numeric;
alter table public.quotes add column if not exists sma_200 numeric;
alter table public.quotes add column if not exists wma_200 numeric;
alter table public.quotes add column if not exists donchian_upper numeric;
alter table public.quotes add column if not exists donchian_lower numeric;
alter table public.quotes add column if not exists donchian_middle numeric;

alter table public.quotes add column if not exists atr_22 numeric;
alter table public.quotes add column if not exists high_22 numeric;
alter table public.quotes add column if not exists chandelier_stop numeric;
alter table public.quotes add column if not exists below_sma50_streak integer;
alter table public.quotes add column if not exists bar_date date;

alter table public.portfolio add column if not exists shares numeric default 0;
alter table public.portfolio add column if not exists cost_basis numeric default 0;
alter table public.portfolio add column if not exists theme text;

-- Defaults match src/lib/sellSignals.js DEFAULT_THEMES.
-- Only fills a theme when the cell is empty. Your edits are kept.
update public.portfolio
set theme = case ticker
  when 'CCJ' then 'Uranium'
  when 'DNN' then 'Uranium'
  when 'NXE' then 'Uranium'
  when 'NVDA' then 'Semis/AI'
  when 'MU' then 'Semis/AI'
  when 'AAPL' then 'Big Tech'
  when 'MSFT' then 'Big Tech'
  when 'NOW' then 'Software'
  when 'LLY' then 'Healthcare'
  when 'ASTS' then 'Space'
  else theme
end
where ticker in ('CCJ', 'DNN', 'NXE', 'NVDA', 'MU', 'AAPL', 'MSFT', 'NOW', 'LLY', 'ASTS')
  and coalesce(trim(theme), '') = '';

create table if not exists public.earnings_calendar (
  symbol text primary key,
  next_earnings_date date,
  updated_at timestamptz not null default now()
);

alter table public.earnings_calendar enable row level security;
alter table public.earnings_calendar force row level security;

grant select on public.earnings_calendar to anon, authenticated;
grant insert, update, delete on public.earnings_calendar to authenticated;
grant all on public.earnings_calendar to service_role;

drop policy if exists "public read earnings_calendar" on public.earnings_calendar;
drop policy if exists "owner insert earnings_calendar" on public.earnings_calendar;
drop policy if exists "owner update earnings_calendar" on public.earnings_calendar;
drop policy if exists "owner delete earnings_calendar" on public.earnings_calendar;

create policy "public read earnings_calendar"
  on public.earnings_calendar
  for select
  to anon, authenticated
  using (true);

create policy "owner insert earnings_calendar"
  on public.earnings_calendar
  for insert
  to authenticated
  with check (public.is_owner());

create policy "owner update earnings_calendar"
  on public.earnings_calendar
  for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "owner delete earnings_calendar"
  on public.earnings_calendar
  for delete
  to authenticated
  using (public.is_owner());

notify pgrst, 'reload schema';
