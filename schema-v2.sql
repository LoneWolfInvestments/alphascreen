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

-- Turn on row-level security with no policies yet. Until schema-rls-lockdown.sql
-- is applied, the anon key cannot read or write these tables (the service-role
-- key used by cron still can). Do not add policies with "using (true)" for writes.
-- That would let anyone holding the public anon key edit the portfolio.

alter table fundamental_scores enable row level security;
alter table portfolio enable row level security;
alter table positioning enable row level security;
alter table reallocation_log enable row level security;
alter table vix_snapshot enable row level security;
