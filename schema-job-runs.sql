-- Job history. Run this once in Supabase → SQL Editor → New query.
-- Paste this whole file and run it. Safe to run again.
-- It does not start a job and does not change prices.
-- Run it after schema-rls-lockdown.sql so is_owner() already exists.
-- The nightly jobs write a short, secret-free summary. Only the signed-in
-- owner can read it. The public site cannot.

create table if not exists public.job_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('ok', 'partial', 'failed')),
  summary text,
  detail text
);

create index if not exists job_runs_started_idx
  on public.job_runs (started_at desc);

alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;

revoke all on table public.job_runs from anon, authenticated;
grant select on table public.job_runs to authenticated;
grant all on table public.job_runs to service_role;

do $$
declare
  existing record;
begin
  for existing in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'job_runs'
  loop
    execute format('drop policy %I on public.job_runs', existing.policyname);
  end loop;
end $$;

create policy "owner read job runs"
  on public.job_runs
  for select
  to authenticated
  using (public.is_owner());

notify pgrst, 'reload schema';
