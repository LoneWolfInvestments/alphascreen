-- Buy candidate record. Run this once in Supabase → SQL Editor → New query.
-- Paste this whole file and run it. Safe to run again.
-- It does not start a job, download prices, or read your holdings or journal.
-- The nightly record job writes these rows. The public site can read the
-- model record. Only the database service can write it. Your notes stay in
-- trade_journal and are not copied here.

create table if not exists public.model_signals (
  id bigint generated always as identity primary key,
  symbol text not null,
  signal_session date not null,
  observed_at timestamptz not null,
  origin text not null check (origin in ('first_observation', 'rearm')),
  policy_version text not null,
  policy_text text not null,
  setup_label text,
  signal_close numeric,
  initial_stop numeric,
  target_price numeric,
  fundamentals_state text,
  technicals_state text,
  supporting_state text,
  freshness text,
  fundamentals_coverage text,
  fundamentals_as_of timestamptz,
  fundamentals_period date,
  earnings_date date,
  earnings_as_of timestamptz,
  regime text,
  regime_state text,
  regime_as_of date,
  quote_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (symbol, signal_session)
);

create table if not exists public.model_signal_outcomes (
  signal_id bigint primary key references public.model_signals (id) on delete cascade,
  status text not null,
  reason text,
  entry_date date,
  entry_open numeric,
  exit_date date,
  exit_price numeric,
  r_multiple numeric,
  r_net numeric,
  path_5_status text,
  path_5 numeric,
  spy_5 numeric,
  excess_5 numeric,
  path_10_status text,
  path_10 numeric,
  spy_10 numeric,
  excess_10 numeric,
  path_20_status text,
  path_20 numeric,
  spy_20 numeric,
  excess_20 numeric,
  reviewed_session date,
  updated_at timestamptz not null default now()
);

create table if not exists public.model_signal_state (
  symbol text primary key,
  last_session date,
  last_qualified boolean,
  open_signal boolean,
  updated_at timestamptz
);

alter table public.model_signals enable row level security;
alter table public.model_signals force row level security;
alter table public.model_signal_outcomes enable row level security;
alter table public.model_signal_outcomes force row level security;
alter table public.model_signal_state enable row level security;
alter table public.model_signal_state force row level security;

revoke all on table public.model_signals from anon, authenticated;
revoke all on table public.model_signal_outcomes from anon, authenticated;
revoke all on table public.model_signal_state from anon, authenticated;
grant select on table public.model_signals to anon, authenticated;
grant select on table public.model_signal_outcomes to anon, authenticated;
grant all on table public.model_signals to service_role;
grant all on table public.model_signal_outcomes to service_role;
grant all on table public.model_signal_state to service_role;

do $$
declare
  existing record;
begin
  for existing in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('model_signals', 'model_signal_outcomes', 'model_signal_state')
  loop
    execute format('drop policy %I on public.%I', existing.policyname, existing.tablename);
  end loop;
end $$;

create policy "public read model signals"
  on public.model_signals
  for select
  to anon, authenticated
  using (true);

create policy "public read model signal outcomes"
  on public.model_signal_outcomes
  for select
  to anon, authenticated
  using (true);

create or replace function public.model_signals_keep_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.symbol is distinct from old.symbol
    or new.signal_session is distinct from old.signal_session
    or new.observed_at is distinct from old.observed_at
    or new.origin is distinct from old.origin
    or new.policy_version is distinct from old.policy_version
    or new.policy_text is distinct from old.policy_text
    or new.setup_label is distinct from old.setup_label
    or new.signal_close is distinct from old.signal_close
    or new.initial_stop is distinct from old.initial_stop
    or new.target_price is distinct from old.target_price
    or new.fundamentals_state is distinct from old.fundamentals_state
    or new.technicals_state is distinct from old.technicals_state
    or new.supporting_state is distinct from old.supporting_state
    or new.freshness is distinct from old.freshness
    or new.fundamentals_coverage is distinct from old.fundamentals_coverage
    or new.fundamentals_as_of is distinct from old.fundamentals_as_of
    or new.fundamentals_period is distinct from old.fundamentals_period
    or new.earnings_date is distinct from old.earnings_date
    or new.earnings_as_of is distinct from old.earnings_as_of
    or new.regime is distinct from old.regime
    or new.regime_state is distinct from old.regime_state
    or new.regime_as_of is distinct from old.regime_as_of
    or new.quote_updated_at is distinct from old.quote_updated_at
  then
    raise exception 'model signal snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists model_signals_immutable on public.model_signals;
create trigger model_signals_immutable
  before update on public.model_signals
  for each row
  execute function public.model_signals_keep_snapshot();

revoke all on function public.model_signals_keep_snapshot() from public;
grant execute on function public.model_signals_keep_snapshot() to service_role;

notify pgrst, 'reload schema';
