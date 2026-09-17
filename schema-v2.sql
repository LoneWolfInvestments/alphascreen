-- schema-v2.sql
-- Run this in Supabase's SQL Editor (New Query), same as schema.sql earlier.
-- Adds the tables needed for the Fundamental Screener, Portfolio, Positioning,
-- Reallocation Log, and VIX Dashboard tabs.

create table if not exists fundamental_scores (
  ticker text primary key,
  insider numeric default 0,
  politician numeric default 0,
  options_flow numeric default 0,
  sentiment numeric default 0,
  notes text,
  updated_at timestamptz default now()
);

create table if not exists portfolio (
  ticker text primary key,
  sector text,
  weight numeric default 0,
  conviction integer default 3,
  updated_at timestamptz default now()
);

create table if not exists positioning (
  id bigint generated always as identity primary key,
  asset text not null,
  cot_net numeric default 0,
  cta text default 'Neutral',
  gex numeric default 0,
  created_at timestamptz default now()
);

create table if not exists reallocation_log (
  id bigint generated always as identity primary key,
  action text not null,
  rationale text,
  created_at timestamptz default now()
);

create table if not exists vix_snapshot (
  id boolean primary key default true check (id), -- singleton row trick: only ever one row
  vix numeric,
  ma30 numeric,
  updated_at timestamptz default now()
);

-- Row-level security. This is a single-user personal tool, so we allow the public
-- anon key (already exposed in your browser bundle) to read AND write these tables —
-- there's no login system here. Anyone with your site's URL could technically write
-- to these tables. That's an acceptable trade-off for a personal research tool, but
-- worth knowing: don't put anything sensitive in ticker/notes/rationale fields, and
-- if you ever want this properly locked down, that requires adding Supabase Auth
-- (a login step) — a separate, bigger project.

alter table fundamental_scores enable row level security;
alter table portfolio enable row level security;
alter table positioning enable row level security;
alter table reallocation_log enable row level security;
alter table vix_snapshot enable row level security;

create policy "public all fundamental_scores" on fundamental_scores for all using (true) with check (true);
create policy "public all portfolio" on portfolio for all using (true) with check (true);
create policy "public all positioning" on positioning for all using (true) with check (true);
create policy "public all reallocation_log" on reallocation_log for all using (true) with check (true);
create policy "public all vix_snapshot" on vix_snapshot for all using (true) with check (true);
