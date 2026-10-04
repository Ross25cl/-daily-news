-- ============================================================
-- 每日体坛速览 · 数据库结构（schema.sql）
-- Day 16｜第 3 周 · 板块① 数据模型设计 + 板块② 建表
--
-- 依据：api-contract.md 第 3 节「数据表设计草案」与第 2 节各接口返回字段
-- 引擎：CloudBase 云开发 PostgreSQL 17（库 postgres-emxo9nse / schema public）
-- 执行：控制台「数据库 → SQL 编辑器」，或 CLI：
--       tcb db execute -e <envId> --sql "$(cat db/schema.sql)"
--
-- 命名约定（重要）
--   数据库列名 = snake_case：与现有 data/news.json、data/matches.json 完全一致，
--                             迁移时字段名一个字都不用改。
--   接口输出   = camelCase：见 api-contract 0.1；两套风格在 Day 18 的接口层做映射。
--
-- 可重复执行：脚本先 DROP 再 CREATE，重复跑不会报「表已存在」。
--            注意 DROP 会清掉这 10 张表的数据，跑完请接着执行 seed.sql。
-- ============================================================

-- ---------- 0. 干净重建 ----------
-- 先删子表、再删父表（leagues 被四张 league_* 表引用，放最后删）
DROP TABLE IF EXISTS public.league_brackets  CASCADE;
DROP TABLE IF EXISTS public.league_players   CASCADE;
DROP TABLE IF EXISTS public.league_standings CASCADE;
DROP TABLE IF EXISTS public.league_schedule  CASCADE;
DROP TABLE IF EXISTS public.matches          CASCADE;
DROP TABLE IF EXISTS public.news_items       CASCADE;
DROP TABLE IF EXISTS public.hot_items        CASCADE;
DROP TABLE IF EXISTS public.push_log         CASCADE;
DROP TABLE IF EXISTS public.subscribers      CASCADE;
DROP TABLE IF EXISTS public.leagues          CASCADE;


-- ============================================================
-- 1. leagues · 联赛维度表
--    来源：data/{nba,cba,ucl,epl}.json 的公共头部字段
--    被 league_schedule / league_standings / league_players / league_brackets 引用
-- ============================================================
CREATE TABLE public.leagues (
  id          TEXT        PRIMARY KEY,                 -- 联赛标识：nba / cba / ucl / epl
  name        TEXT        NOT NULL,                    -- 显示名：NBA / CBA / 欧冠 / 英超
  sport       TEXT        NOT NULL,                    -- basketball / football，决定排行表用哪套列
  emoji       TEXT,                                    -- 板块图标
  description TEXT,                                    -- 一句话描述
  tabs        JSONB       NOT NULL DEFAULT '[]'::jsonb,-- Tab 顺序，前端子标签由此驱动
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),      -- 该联赛数据最后更新时间
  CONSTRAINT leagues_sport_check CHECK (sport IN ('basketball', 'football'))
);

COMMENT ON TABLE  public.leagues            IS '联赛维度表：四个联赛各一行，供 league_* 四张表外键引用';
COMMENT ON COLUMN public.leagues.id         IS '联赛英文标识，接口 /api/leagues/:id 的路径参数';
COMMENT ON COLUMN public.leagues.sport      IS '运动类别，篮球/足球的排行与球员字段不同，用它区分';
COMMENT ON COLUMN public.leagues.tabs       IS 'JSONB 数组存子标签顺序，如 ["schedule","standings",...]';


-- ============================================================
-- 2. hot_items · 首页三平台热搜
--    来源：data/hot.json → 接口 GET /api/hot
-- ============================================================
CREATE TABLE public.hot_items (
  id            TEXT        PRIMARY KEY,               -- 条目唯一标识
  platform      TEXT        NOT NULL,                  -- hupu / tencent / cctv5
  platform_name TEXT        NOT NULL,                  -- 平台显示名：虎扑 / 腾讯体育 / 央视体育
  platform_desc TEXT,                                  -- 平台一句话描述
  rank          INTEGER     NOT NULL,                  -- 榜内排名，从 1 开始
  title         TEXT        NOT NULL,                  -- 条目标题
  heat          BIGINT      NOT NULL DEFAULT 0,        -- 热度值（前端格式化为「万」）
  url           TEXT        NOT NULL,                  -- 原文链接
  tag           TEXT,                                  -- 联赛/项目标签，可为空
  is_video      BOOLEAN     NOT NULL DEFAULT FALSE,    -- 是否视频条目（仅腾讯体育）
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),    -- 抓取时间
  CONSTRAINT hot_items_platform_check CHECK (platform IN ('hupu', 'tencent', 'cctv5')),
  CONSTRAINT hot_items_rank_check     CHECK (rank >= 1),
  CONSTRAINT hot_items_heat_check     CHECK (heat >= 0),
  CONSTRAINT hot_items_rank_uniq      UNIQUE (platform, rank)   -- 同一平台内名次不重复
);

COMMENT ON TABLE  public.hot_items           IS '三平台热搜榜条目，一次抓取一行';
COMMENT ON COLUMN public.hot_items.platform  IS '平台归属，接口 platform 参数按它筛选';
COMMENT ON COLUMN public.hot_items.rank      IS '榜内名次，与 platform 组成唯一键';
COMMENT ON COLUMN public.hot_items.heat      IS '热度基数较大，用 BIGINT 防止溢出';
COMMENT ON COLUMN public.hot_items.is_video  IS '布尔标记，只有腾讯体育会出现 true';


-- ============================================================
-- 3. news_items · 资讯条目
--    来源：data/news.json → 接口 GET /api/news、GET /api/news/:id
-- ============================================================
CREATE TABLE public.news_items (
  id          TEXT        PRIMARY KEY,                 -- 业务规则：YYYYMMDD-n01
  title       TEXT        NOT NULL,                    -- ≤30 字
  summary     TEXT        NOT NULL,                    -- ≤60 字，含背景/影响/后续之一
  section     TEXT        NOT NULL,                    -- 头条 / 转会伤病 / 热议 / 明日看点
  league      TEXT        NOT NULL,                    -- NBA / 英超 / 中超 / 欧冠 / 电竞 / 综合
  source_name TEXT        NOT NULL,                    -- 来源名称
  source_url  TEXT        NOT NULL,                    -- 可访问 URL
  digest_date DATE        NOT NULL,                    -- 归属日期 YYYY-MM-DD
  status      TEXT        NOT NULL DEFAULT 'published',-- draft / published，接口只返回 published
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),      -- ISO 8601
  CONSTRAINT news_items_section_check CHECK (section IN ('头条', '转会伤病', '热议', '明日看点')),
  CONSTRAINT news_items_status_check  CHECK (status IN ('draft', 'published')),
  CONSTRAINT news_items_title_len     CHECK (char_length(title)   <= 30),  -- 契约 2.2 字数规范
  CONSTRAINT news_items_summary_len   CHECK (char_length(summary) <= 60)
);

COMMENT ON TABLE  public.news_items             IS '资讯条目，一条新闻一行；首页四板块与资讯列表/详情共用';
COMMENT ON COLUMN public.news_items.id          IS '带日期的业务主键，形如 20260929-n01，可直接进 URL';
COMMENT ON COLUMN public.news_items.section     IS '四板块归属，CHECK 限定四种取值防止拼写漂移';
COMMENT ON COLUMN public.news_items.digest_date IS '归属日期，首页「今日速览」按它过滤；用 DATE 便于按天比较';
COMMENT ON COLUMN public.news_items.status      IS 'draft 草稿不入接口，published 才对外';


-- ============================================================
-- 4. matches · 赛程比分（综合页）
--    来源：data/matches.json → 接口 GET /api/matches
-- ============================================================
CREATE TABLE public.matches (
  id          TEXT        PRIMARY KEY,                 -- 业务规则：YYYYMMDD-<联赛>-01
  league      TEXT        NOT NULL,                    -- NBA / 英超 / CBA / 欧冠
  home_team   TEXT        NOT NULL,                    -- 主队
  away_team   TEXT        NOT NULL,                    -- 客队
  match_time  TIMESTAMP   NOT NULL,                    -- 开赛时间（北京时间，无时区）
  status      TEXT        NOT NULL,                    -- 未开始 / 进行中 / 已结束 / 延期 / 取消
  home_score  INTEGER,                                 -- 主队得分，未结束可为空
  away_score  INTEGER,                                 -- 客队得分，未结束可为空
  round       TEXT,                                    -- 轮次，如「季前赛」
  venue       TEXT,                                    -- 场地
  data_source TEXT        NOT NULL,                    -- 比分来源（核对溯源用）
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),      -- 比分更正须同步更新
  CONSTRAINT matches_status_check CHECK (status IN ('未开始', '进行中', '已结束', '延期', '取消')),
  CONSTRAINT matches_score_check  CHECK (
    (home_score IS NULL OR home_score >= 0) AND (away_score IS NULL OR away_score >= 0)
  ),
  -- 已结束的比赛必须有比分：防止「状态说打完了、比分为空」的脏数据
  CONSTRAINT matches_finished_need_score CHECK (
    status <> '已结束' OR (home_score IS NOT NULL AND away_score IS NOT NULL)
  )
);

COMMENT ON TABLE  public.matches             IS '赛程比分页的比赛记录，一场一行；日期切换靠 match_time';
COMMENT ON COLUMN public.matches.match_time  IS '用 TIMESTAMP 而非 TIMESTAMPTZ：契约 0.1 约定统一北京时间，不带时区';
COMMENT ON COLUMN public.matches.status      IS 'CHECK 锁定五种状态，与前端展示文案一一对应';
COMMENT ON COLUMN public.matches.data_source IS '比分来源，PRD 要求可溯源，故设为非空';


-- ============================================================
-- 5. league_schedule · 联赛页「赛程」Tab
--    来源：data/{lg}.json → schedule → 接口 GET /api/leagues/:id
-- ============================================================
CREATE TABLE public.league_schedule (
  id         TEXT        PRIMARY KEY,                  -- 如 nba-20260928-01
  league_id  TEXT        NOT NULL
             REFERENCES public.leagues(id) ON DELETE CASCADE,
  match_date DATE        NOT NULL,                     -- 比赛日期
  match_time TEXT,                                     -- 开赛时刻字符串，如 07:30
  status     TEXT        NOT NULL,                     -- 五种状态，同 matches
  home_team  TEXT        NOT NULL,
  away_team  TEXT        NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  round      TEXT,
  venue      TEXT,
  CONSTRAINT league_schedule_status_check CHECK (status IN ('未开始', '进行中', '已结束', '延期', '取消'))
);

COMMENT ON TABLE  public.league_schedule            IS '联赛板块页的赛程 Tab 数据，按 league_id 归属';
COMMENT ON COLUMN public.league_schedule.league_id  IS '外键指向 leagues.id，删联赛自动清赛程';
COMMENT ON COLUMN public.league_schedule.match_time IS '源头数据是 "07:30" 这种时刻串，与日期分列存，故用 TEXT';


-- ============================================================
-- 6. league_standings · 联赛页「排行 / 积分榜」Tab
--    篮球列：wins / losses / points_diff / win_rate
--    足球列：played / wins / draws / losses / goals_for / goals_against / points
-- ============================================================
CREATE TABLE public.league_standings (
  id            TEXT        PRIMARY KEY,               -- 如 nba-standings-1
  league_id     TEXT        NOT NULL
                REFERENCES public.leagues(id) ON DELETE CASCADE,
  rank          INTEGER     NOT NULL,                  -- 名次，从 1 开始
  team_name     TEXT        NOT NULL,
  played        INTEGER,                               -- 场次（足球）
  wins          INTEGER     NOT NULL DEFAULT 0,
  draws         INTEGER,                               -- 平局（足球）
  losses        INTEGER     NOT NULL DEFAULT 0,
  goals_for     INTEGER,                               -- 进球（足球）
  goals_against INTEGER,                               -- 失球（足球）
  points        INTEGER,                               -- 积分（足球）
  points_diff   TEXT,                                  -- 净胜分（篮球），带符号字符串如 +24
  win_rate      TEXT,                                  -- 胜率（篮球），如 100%
  CONSTRAINT league_standings_rank_check CHECK (rank >= 1),
  CONSTRAINT league_standings_rank_uniq  UNIQUE (league_id, rank)
);

COMMENT ON TABLE  public.league_standings             IS '联赛排行/积分榜，篮球与足球共用一张表、各取所需列';
COMMENT ON COLUMN public.league_standings.points_diff IS '篮球净胜分是带正负号的展示串（+24），故用 TEXT 而非数值';
COMMENT ON COLUMN public.league_standings.win_rate    IS '胜率含百分号，同样按展示串存 TEXT';
COMMENT ON COLUMN public.league_standings.points      IS '足球积分；篮球此列为空，靠 sport 区分读哪几列';


-- ============================================================
-- 7. league_players · 联赛页「球员数据 / 射手榜」Tab
--    篮球：points / rebounds / assists
--    足球：apps / goals / assists / rating
--    board 区分两套榜单（球员数据榜 / 射手榜）
-- ============================================================
CREATE TABLE public.league_players (
  id          TEXT        PRIMARY KEY,                 -- 如 nba-player-1
  league_id   TEXT        NOT NULL
              REFERENCES public.leagues(id) ON DELETE CASCADE,
  board       TEXT        NOT NULL DEFAULT 'players',  -- players=球员数据榜 / scorers=射手榜
  rank        INTEGER     NOT NULL,
  player_name TEXT        NOT NULL,
  team_name   TEXT        NOT NULL,
  points      NUMERIC(5,1),                            -- 场均得分（篮球）
  rebounds    NUMERIC(5,1),                            -- 场均篮板（篮球）
  assists     NUMERIC(5,1),                            -- 场均助攻（两用）
  apps        INTEGER,                                 -- 出场次数（足球）
  goals       INTEGER,                                 -- 进球（足球/射手榜）
  rating      NUMERIC(3,1),                            -- 评分（足球）
  CONSTRAINT league_players_board_check CHECK (board IN ('players', 'scorers')),
  CONSTRAINT league_players_rank_check  CHECK (rank >= 1),
  CONSTRAINT league_players_rank_uniq   UNIQUE (league_id, board, rank)
);

COMMENT ON TABLE  public.league_players            IS '联赛球员数据与射手榜，board 列区分两套榜单';
COMMENT ON COLUMN public.league_players.board      IS '同一联赛有两套榜单（英超既有球员数据也有射手榜），必须区分';
COMMENT ON COLUMN public.league_players.points     IS '场均数据带一位小数，NUMERIC(5,1) 精确存储不用浮点';
COMMENT ON COLUMN public.league_players.rating     IS '评分范围 0-10，NUMERIC(3,1) 足够且不丢精度';


-- ============================================================
-- 8. league_brackets · 晋级图 / 争冠形势
--    结构嵌套深（halves→rounds→matches），整体存 JSONB，不拆关系表
--    kind 区分：bracket=晋级图（NBA/CBA/欧冠）/ race=争冠形势（英超）
-- ============================================================
CREATE TABLE public.league_brackets (
  id           TEXT        PRIMARY KEY,                -- 如 nba-25-26-bracket
  league_id    TEXT        NOT NULL
               REFERENCES public.leagues(id) ON DELETE CASCADE,
  season       TEXT        NOT NULL,                   -- 赛季，如 25-26
  kind         TEXT        NOT NULL DEFAULT 'bracket',
  payload_json JSONB       NOT NULL,                   -- 整棵结构树原样存
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_brackets_kind_check CHECK (kind IN ('bracket', 'race')),
  CONSTRAINT league_brackets_uniq       UNIQUE (league_id, season, kind)
);

COMMENT ON TABLE  public.league_brackets              IS '晋级图与争冠形势：嵌套结构整体存 JSONB，按联赛+赛季+类型唯一';
COMMENT ON COLUMN public.league_brackets.payload_json IS 'halves→rounds→matches 三层嵌套，拆表得不偿失，JSONB 一次取回';
COMMENT ON COLUMN public.league_brackets.season       IS '支持多赛季切换（前端 seasons 下拉）';


-- ============================================================
-- 9. push_log · 每日推送记录（订阅线，第 4 周用）
-- ============================================================
CREATE TABLE public.push_log (
  id              TEXT        PRIMARY KEY,             -- 如 2026-09-29-am
  digest_date     DATE        NOT NULL,                -- 推送的速览日期
  sent_at         TIMESTAMPTZ,                         -- 实际发出时间
  recipient_count INTEGER     NOT NULL DEFAULT 0,      -- 收件人数
  status          TEXT        NOT NULL,                -- 成功 / 部分失败 / 失败
  failure_note    TEXT,                                -- 失败原因，成功时为空
  CONSTRAINT push_log_recipient_check CHECK (recipient_count >= 0)
);

COMMENT ON TABLE  public.push_log           IS '每日推送流水，一天可多条（如早报/晚报）';
COMMENT ON COLUMN public.push_log.failure_note IS '失败或部分失败时记录原因，便于事后追';


-- ============================================================
-- 10. subscribers · 订阅者（订阅线，第 4 周用）
-- ============================================================
CREATE TABLE public.subscribers (
  id                TEXT        PRIMARY KEY,           -- 订阅者唯一标识
  email             TEXT        NOT NULL,              -- 邮箱
  status            TEXT        NOT NULL DEFAULT 'active',
  subscribed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribe_token TEXT        NOT NULL,              -- 退订令牌，进 URL
  last_sent_at      TIMESTAMPTZ,                       -- 最近一次送达时间
  CONSTRAINT subscribers_status_check CHECK (status IN ('active', 'unsubscribed')),
  CONSTRAINT subscribers_email_uniq   UNIQUE (email),
  CONSTRAINT subscribers_token_uniq   UNIQUE (unsubscribe_token)
);

COMMENT ON TABLE  public.subscribers                   IS '订阅者名单，第 4 周订阅功能使用';
COMMENT ON COLUMN public.subscribers.email             IS '唯一约束防止同一邮箱重复订阅（对应 409 CONFLICT）';
COMMENT ON COLUMN public.subscribers.unsubscribe_token IS '退订令牌唯一，/api/unsubscribe?token= 凭它退订';


-- ---------- 完工自检：列出本次建的表 ----------
SELECT table_name
FROM   information_schema.tables
WHERE  table_schema = 'public'
ORDER  BY table_name;
