-- ============================================================
-- 每日体坛速览 · 结构增补（migrate-day22.sql）
-- Day 22｜第 4 周 · 板块① PATCH 实现 / 板块② DELETE 实现
--
-- 为什么要有这个文件：
--   Day 16 定稿的 10 张表里，matches 与 news_items 都**没有「备注」列**，
--   而 Day 22 的任务要求 PATCH 能改「备注」。所以本日给这两张表各加一列 note。
--   （这是本日唯一的结构改动。schema.sql 同步更新，新环境一次建表就带 note，
--     已建库的环境跑本文件补列 —— 两条路都通，不冲突。）
--
-- 执行（项目根目录，CLI）：
--   tcb db execute -e ross-d2gimwy406e0d6812 --sql "ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS note TEXT"
--   tcb db execute -e ross-d2gimwy406e0d6812 --sql "ALTER TABLE public.news_items ADD COLUMN IF NOT EXISTS note TEXT"
--
-- 注意：本文件的 SQL 含括号，**在 PowerShell 里直接把整段文本传给 --sql 会被
--   cmd 截断**（见 skills/tiyu-daily-sync §六）→ 用 node 直传 argv 的方式执行，
--   或把两条 ALTER 分开、逐条在 Git Bash 里执行。
--
-- 可重复执行：ADD COLUMN IF NOT EXISTS 幂等，重复跑不报错。
-- ============================================================

-- ---------- 1. matches 加备注 ----------
-- 用途：比分更正/延期原因等需要留痕的说明（PATCH 可改字段之一）
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS note TEXT;

COMMENT ON COLUMN public.matches.note IS
  '备注：比分更正缘由、延期/取消原因等留痕说明，Day 22 新增（PATCH 可改）';

-- ---------- 2. news_items 加备注 ----------
-- 用途：运营对该条资讯的补充说明（PATCH 可改字段之一）
ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS note TEXT;

COMMENT ON COLUMN public.news_items.note IS
  '备注：运营补充说明，Day 22 新增（PATCH 可改）';

-- ---------- 3. 自检 ----------
-- 两行都应该出现 note / text
SELECT table_name, column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  column_name  = 'note'
  AND  table_name  IN ('matches', 'news_items')
ORDER  BY table_name;
