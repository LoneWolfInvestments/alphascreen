-- schema-rls-lockdown.sql
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
--
-- Before you run it:
--   1. Deploy the app update first, so the "Email me a link" box is on the site.
--   2. Change you@example.com below to the email you will use to sign in.
--
-- What this does:
--   * portfolio and reallocation_log: only that owner can read or write them.
--   * Market data (quotes, watchlist, scores, positioning, VIX, MAG7):
--     anyone can read, only the owner (or the server cron) can write.
--   * Cron keeps working. It uses the service-role key, which skips these rules.
--
-- If you see "relation does not exist", run schema.sql, then schema-v2.sql,
-- then run this file again.

-- ---------------------------------------------------------------------------
-- Who is allowed to sign in
-- ---------------------------------------------------------------------------

create table if not exists public.allowed_owners (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint allowed_owners_email_lowercase check (email = lower(email) and position('@' in email) > 1)
);

alter table public.allowed_owners enable row level security;
alter table public.allowed_owners force row level security;
revoke all on table public.allowed_owners from anon, authenticated;
grant select on table public.allowed_owners to service_role;

-- The placeholder is not a real inbox. This delete removes it on every run.
delete from public.allowed_owners where email = 'you@example.com';

-- >>> EDIT THE EMAIL ON THE NEXT LINE, then run the whole file. <<<
insert into public.allowed_owners (email)
values (lower(trim('you@example.com')))
on conflict (email) do nothing;

-- True only when the signed-in user's email is in allowed_owners.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_owners
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- Helper used only while this script runs. Dropped at the bottom.
create or replace function public._alphascreen_drop_policies(target_table text)
returns void
language plpgsql
as $$
declare
  existing record;
begin
  for existing in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = target_table
  loop
    execute format('drop policy %I on public.%I', existing.policyname, target_table);
  end loop;
end;
$$;

revoke all on function public._alphascreen_drop_policies(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private: portfolio (shares, cost basis) and the reallocation notes
-- ---------------------------------------------------------------------------

alter table public.portfolio enable row level security;
alter table public.portfolio force row level security;
select public._alphascreen_drop_policies('portfolio');
create policy "owner all portfolio"
  on public.portfolio
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

alter table public.reallocation_log enable row level security;
alter table public.reallocation_log force row level security;
select public._alphascreen_drop_policies('reallocation_log');
create policy "owner all reallocation_log"
  on public.reallocation_log
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Market data: readable by the public anon key, writable by the owner.
-- Cron writes with the service-role key and does not need these policies.
-- ---------------------------------------------------------------------------

alter table public.fundamental_scores enable row level security;
alter table public.fundamental_scores force row level security;
select public._alphascreen_drop_policies('fundamental_scores');
create policy "public read fundamental_scores"
  on public.fundamental_scores
  for select
  to anon, authenticated
  using (true);
create policy "owner insert fundamental_scores"
  on public.fundamental_scores
  for insert
  to authenticated
  with check (public.is_owner());
create policy "owner update fundamental_scores"
  on public.fundamental_scores
  for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());
create policy "owner delete fundamental_scores"
  on public.fundamental_scores
  for delete
  to authenticated
  using (public.is_owner());

alter table public.positioning enable row level security;
alter table public.positioning force row level security;
select public._alphascreen_drop_policies('positioning');
create policy "public read positioning"
  on public.positioning
  for select
  to anon, authenticated
  using (true);
create policy "owner insert positioning"
  on public.positioning
  for insert
  to authenticated
  with check (public.is_owner());
create policy "owner update positioning"
  on public.positioning
  for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());
create policy "owner delete positioning"
  on public.positioning
  for delete
  to authenticated
  using (public.is_owner());

alter table public.vix_snapshot enable row level security;
alter table public.vix_snapshot force row level security;
select public._alphascreen_drop_policies('vix_snapshot');
create policy "public read vix_snapshot"
  on public.vix_snapshot
  for select
  to anon, authenticated
  using (true);
create policy "owner insert vix_snapshot"
  on public.vix_snapshot
  for insert
  to authenticated
  with check (public.is_owner());
create policy "owner update vix_snapshot"
  on public.vix_snapshot
  for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());
create policy "owner delete vix_snapshot"
  on public.vix_snapshot
  for delete
  to authenticated
  using (public.is_owner());

-- These three were already read-only. Re-apply that in case a later edit
-- added a wide-open policy.
alter table public.watchlist enable row level security;
alter table public.watchlist force row level security;
select public._alphascreen_drop_policies('watchlist');
create policy "public read watchlist"
  on public.watchlist
  for select
  to anon, authenticated
  using (true);

alter table public.quotes enable row level security;
alter table public.quotes force row level security;
select public._alphascreen_drop_policies('quotes');
create policy "public read quotes"
  on public.quotes
  for select
  to anon, authenticated
  using (true);

alter table public.quotes_history enable row level security;
alter table public.quotes_history force row level security;
select public._alphascreen_drop_policies('quotes_history');
create policy "public read quotes_history"
  on public.quotes_history
  for select
  to anon, authenticated
  using (true);

-- MAG7 was created outside the schema files. Skip it if it is not there yet.
do $$
begin
  if to_regclass('public.mag7_performance') is null then
    raise notice 'mag7_performance does not exist yet; skipping its policies';
    return;
  end if;

  execute 'alter table public.mag7_performance enable row level security';
  execute 'alter table public.mag7_performance force row level security';
  perform public._alphascreen_drop_policies('mag7_performance');
  execute $policy$
    create policy "public read mag7_performance"
      on public.mag7_performance
      for select
      to anon, authenticated
      using (true)
  $policy$;
end $$;

drop function public._alphascreen_drop_policies(text);

do $$
begin
  if exists (select 1 from public.allowed_owners where email = 'you@example.com')
     and not exists (select 1 from public.allowed_owners where email <> 'you@example.com') then
    raise warning 'Change you@example.com in schema-rls-lockdown.sql to your real email and run this file again. Until you do, sign-in will not unlock the portfolio.';
  end if;
end $$;

notify pgrst, 'reload schema';
