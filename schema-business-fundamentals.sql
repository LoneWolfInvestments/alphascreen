-- schema-business-fundamentals.sql
-- Run this once in Supabase → SQL Editor → New query → paste the whole file → Run.
-- Safe to run more than once. It only adds columns. It does not change rows,
-- turn on a job, or touch daily prices or the market-stress table.
--
-- What you get:
--   * Room on the fundamental screener for revenue growth, earnings growth,
--     a margin comparison, a statement date, and when that snapshot was downloaded.
--   * A place to remember when the ownership numbers were downloaded, separate
--     from the company figures.
--   * The weekly job fills the company columns the next time it runs. You do
--     not need to press anything else. Until then the page shows the P/E, EPS,
--     and margin it already has, and it does not invent a score.
--
-- Who can see it:
--   * Same rules as the rest of fundamental_scores. Anyone can read. Only you,
--     or the server job, can write. No new keys.

alter table public.fundamental_scores add column if not exists revenue_growth_yoy numeric;
alter table public.fundamental_scores add column if not exists revenue_growth_basis text;
alter table public.fundamental_scores add column if not exists earnings_growth_yoy numeric;
alter table public.fundamental_scores add column if not exists earnings_state text;
alter table public.fundamental_scores add column if not exists earnings_basis text;
alter table public.fundamental_scores add column if not exists margin_current numeric;
alter table public.fundamental_scores add column if not exists margin_prior numeric;
alter table public.fundamental_scores add column if not exists margin_basis text;
alter table public.fundamental_scores add column if not exists ps_ratio numeric;
alter table public.fundamental_scores add column if not exists fundamentals_period date;
alter table public.fundamental_scores add column if not exists fundamentals_as_of timestamptz;
alter table public.fundamental_scores add column if not exists fundamentals_source text;
alter table public.fundamental_scores add column if not exists analyst_period date;
alter table public.fundamental_scores add column if not exists ownership_fetched_at timestamptz;

notify pgrst, 'reload schema';
