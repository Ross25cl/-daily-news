-- ============================================================
-- migrate-day22-league-season.sql
-- Day 22 追加：给联赛四张表补「赛季 / 分区」维度，并放宽会误伤真实数据的唯一键。
--
-- 为什么必须加这两列：
--   联赛页（league.html / data/{lg}.json）的 Tab 是按赛季切换的——
--   NBA 有 25-26（已完整）与 26-27（进行中）两个赛季，排行还分东部/西部。
--   Day 16 建表时只按「单赛季 + 单一榜单」设计，没留这两列，
--   于是：① 两个赛季的赛程会混在一起；② 东西部同名次（都从 rank=1 起）
--   会被旧唯一键 UNIQUE (league_id, rank) 直接拒掉。
--
-- 可重复执行：ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS，
--   整段重跑不会报错、不会重复改。
-- ============================================================

BEGIN;

-- ---------- 1. league_schedule：加 season ----------
ALTER TABLE public.league_schedule
  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.league_schedule.season IS
  '赛季标识，如 25-26 / 26-27；Day 22 新增。前端按赛季切换赛程，缺它两季会混在一张列表里';

-- ---------- 2. league_standings：加 season + zone，并放宽唯一键 ----------
ALTER TABLE public.league_standings
  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '';
ALTER TABLE public.league_standings
  ADD COLUMN IF NOT EXISTS zone TEXT;

COMMENT ON COLUMN public.league_standings.season IS '赛季标识，如 25-26；Day 22 新增';
COMMENT ON COLUMN public.league_standings.zone   IS
  '分区：篮球「东部 / 西部」，足球留空（NULL）。Day 22 新增——NBA 东西部名次各自从 1 开始';

-- 旧唯一键 (league_id, rank) 会把「NBA 东部第 1 与西部第 1」判为冲突，必须放宽到含 season+zone
ALTER TABLE public.league_standings
  DROP CONSTRAINT IF EXISTS league_standings_rank_uniq;
ALTER TABLE public.league_standings
  ADD CONSTRAINT league_standings_rank_uniq
  UNIQUE (league_id, season, zone, rank);

-- ---------- 3. league_players：加 season，并把唯一键放宽到含 season ----------
ALTER TABLE public.league_players
  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.league_players.season IS '赛季标识，如 25-26；Day 22 新增';

-- league_data.sql（Day 21）已把该约束放宽为 (league_id, board, rank, player_name)；
-- 这里再并入 season，避免「同一球员在两个赛季都是第 3 名」被判重。
ALTER TABLE public.league_players
  DROP CONSTRAINT IF EXISTS league_players_rank_uniq;
ALTER TABLE public.league_players
  ADD CONSTRAINT league_players_rank_uniq
  UNIQUE (league_id, season, board, rank, player_name);

-- ---------- 4. league_brackets：kind 增加 'playoffs' ----------
-- NBA 的「季后赛对阵」是独立一套数据（15 个系列赛，比分级 4-3 这种），
-- 既不是 bracket（晋级树）也不是 race（争冠形势），需要自己的 kind。
ALTER TABLE public.league_brackets
  DROP CONSTRAINT IF EXISTS league_brackets_kind_check;
ALTER TABLE public.league_brackets
  ADD CONSTRAINT league_brackets_kind_check
  CHECK (kind IN ('bracket', 'race', 'playoffs'));

COMMENT ON COLUMN public.league_brackets.kind IS
  'bracket=晋级图 / race=争冠形势 / playoffs=季后赛对阵（Day 22 新增）';

-- ---------- 5. 回填：给已有行补赛季 ----------
-- 库里现存的行都是 26-27 赛季的数据（seed 示例与 league_data.sql 都是 26-27），
-- 空串一律回填成 '26-27'。用 '' 而不是 NULL 作「未知」哨兵，是为了能进 UNIQUE 约束。
UPDATE public.league_schedule SET season = '26-27' WHERE season = '';
UPDATE public.league_standings SET season = '26-27' WHERE season = '';
UPDATE public.league_players  SET season = '26-27' WHERE season = '';

-- ---------- 6. 自检 ----------
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  ((table_name = 'league_schedule' AND column_name = 'season')
     OR (table_name = 'league_standings' AND column_name IN ('season', 'zone'))
     OR (table_name = 'league_players'  AND column_name = 'season'))
ORDER BY table_name, column_name;

COMMIT;
