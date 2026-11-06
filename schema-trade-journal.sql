-- Trade journal. Run this once in Supabase → SQL Editor → New query.
-- Paste this whole file and run it. Safe to run again.
-- It does not change holdings, prices, or scheduled jobs.
-- Run it after schema-rls-lockdown.sql so is_owner() already exists.
-- Only the signed-in owner can read or write these notes. Each row belongs
-- to that sign-in. The public site cannot see them.

create table if not exists public.trade_journal (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid(),
  ticker text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_on date,
  closed_on date,
  shares numeric,
  entry_price numeric,
  exit_price numeric,
  thesis text,
  planned_stop numeric,
  planned_target numeric,
  planned_risk_usd numeric,
  assumed_cost_usd numeric,
  outcome_notes text,
  review_notes text,
  change_note text,
  plan_note text,
  process_followed boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trade_journal enable row level security;
alter table public.trade_journal force row level security;

revoke all on table public.trade_journal from anon, authenticated;
grant select, insert, update, delete on table public.trade_journal to authenticated;
grant all on table public.trade_journal to service_role;

do $$
declare
  existing record;
begin
  for existing in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'trade_journal'
  loop
    execute format('drop policy %I on public.trade_journal', existing.policyname);
  end loop;
end $$;

create policy "owner read own journal"
  on public.trade_journal
  for select
  to authenticated
  using (public.is_owner() and owner_id = auth.uid());

create policy "owner insert own journal"
  on public.trade_journal
  for insert
  to authenticated
  with check (public.is_owner() and owner_id = auth.uid());

create policy "owner update own journal"
  on public.trade_journal
  for update
  to authenticated
  using (public.is_owner() and owner_id = auth.uid())
  with check (public.is_owner() and owner_id = auth.uid());

create policy "owner delete own journal"
  on public.trade_journal
  for delete
  to authenticated
  using (public.is_owner() and owner_id = auth.uid());

notify pgrst, 'reload schema';
