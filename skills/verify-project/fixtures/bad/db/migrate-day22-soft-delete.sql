-- 坏样本：migrate 加了 is_deleted 列，但 schema.sql 里没有同步
ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.league_standings
  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '';
