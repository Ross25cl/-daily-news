-- 坏样本 schema
CREATE TABLE IF NOT EXISTS public.news_items (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hot_items (
  rank INT AUTO_INCREMENT,          -- 坏样本：MySQL 方言
  platform TEXT NOT NULL,
  title TEXT NOT NULL
);
