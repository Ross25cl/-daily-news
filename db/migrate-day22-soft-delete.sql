-- ============================================================
-- 每日体坛速览 · 结构增补（migrate-day22-soft-delete.sql）
-- Day 22｜第 4 周 · 余力加练：软删除（is_deleted）
--
-- 为什么要有这个文件：
--   Day 22 的 DELETE 接口原本是**真删除**，删掉就没了、无法找回。
--   余力加练要求改成**软删除**：不真删数据，只在记录上打一个 is_deleted 标记，
--   查询时跳过被标记的行；删错了把标记改回 false，数据就回来了。
--   → 给 matches 与 news_items 各加一列 is_deleted BOOLEAN NOT NULL DEFAULT false。
--
-- 与 migrate-day22.sql 的关系：
--   那个文件加的是 note 列（PATCH 可改「备注」），本文件加的是 is_deleted 列。
--   两个文件都幂等，可重复执行，先后顺序无关。
--
-- 为什么用 NOT NULL DEFAULT false 而不是可空：
--   可空 → 查询过滤得写「is_deleted IS NOT TRUE」，三值逻辑容易漏；
--   NOT NULL DEFAULT false → 过滤条件永远是干净的一句「is_deleted = false」，
--   且**存量行不需要回填**（加列时默认值直接生效）。
--
-- 为什么先不建索引：
--   matches / news_items 目前是几十行量级，全表扫描比走索引还快；
--   等数据量上来（或分页变慢）再加部分索引：
--     CREATE INDEX ... ON matches (match_time) WHERE is_deleted = false;
--   —— 现在加只是给自己看，不是给查询用。
--
-- 执行（项目根目录，CLI）：
--   tcb db execute -e ross-d2gimwy406e0d6812 --sql "ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false"
--   tcb db execute -e ross-d2gimwy406e0d6812 --sql "ALTER TABLE public.news_items ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false"
--
-- 注意（踩过的坑）：本文件的 SQL 含括号，**在 PowerShell 里把整段文本传给 --sql 会被
--   cmd 截断**（见 skills/tiyu-daily-sync §六）→ 用 node 直传 argv 的方式执行，
--   或把两条 ALTER 分开、逐条在 Git Bash 里执行。
--
-- 可重复执行：ADD COLUMN IF NOT EXISTS 幂等，重复跑不报错。
-- ============================================================

-- ---------- 1. matches 加软删除标记 ----------
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.matches.is_deleted IS
  '软删除标记（Day 22 余力加练）：true = 已删除。接口查询一律带 is_deleted = false 过滤，故删掉的行「查不到但仍活着」，把标记改回 false 即恢复。';

-- ---------- 2. news_items 加软删除标记 ----------
ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.news_items.is_deleted IS
  '软删除标记（Day 22 余力加练）：true = 已删除，列表与按 id 查询都跳过。收藏线另有一条配套：同一 source_url 再次收藏时会被「复活」（标记改回 false），否则会出现「说有这条、列表里却看不到」。';

-- ---------- 3. 自检：两行都应出现 is_deleted / boolean / false ----------
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  column_name  = 'is_deleted'
  AND  table_name  IN ('matches', 'news_items')
ORDER  BY table_name;

-- ---------- 4. 存量数据核对：两行都应为 0（刚加的列，还没人删过东西） ----------
SELECT 'matches'    AS table_name, count(*) AS deleted_rows FROM public.matches    WHERE is_deleted
UNION ALL
SELECT 'news_items' AS table_name, count(*) AS deleted_rows FROM public.news_items WHERE is_deleted;
