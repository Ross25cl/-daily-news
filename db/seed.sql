-- ============================================================
-- 每日体坛速览 · 种子数据（seed.sql）
-- Day 16｜第 3 周 · 板块③ 种子脚本
--
-- 数据来源：仓库现有 data/*.json，行数与内容一一对应，可复现。
-- 执行顺序：先 schema.sql 建表，再本脚本灌数据。
-- 可重复执行：先 TRUNCATE 再 INSERT，重复跑不会报错、也不会产生重复行。
-- ============================================================

-- ---------- 0. 清空十张表（含外键，一起截断） ----------
TRUNCATE TABLE
  public.league_brackets,
  public.league_players,
  public.league_standings,
  public.league_schedule,
  public.matches,
  public.news_items,
  public.hot_items,
  public.push_log,
  public.subscribers,
  public.leagues
  RESTART IDENTITY CASCADE;

-- ---------- 1. leagues · 4 个联赛（维度表，值域由业务决定） ----------
INSERT INTO public.leagues (id, name, sport, emoji, description, tabs, updated_at) VALUES
  ('nba', 'NBA', 'basketball', '🏀', '美职篮 · 假数据示例（MVP 结构预览，接真实数据时字段名不变）', '["schedule", "standings", "playoffs", "bracket", "players"]'::jsonb, '2026-09-28T21:30:00+08:00'),
  ('cba', 'CBA', 'basketball', '🏀', '中国男子篮球职业联赛 · 假数据示例（MVP 结构预览，接真实数据时字段名不变）', '["schedule", "standings", "playoffs", "bracket", "players"]'::jsonb, '2026-09-28T21:30:00+08:00'),
  ('ucl', '欧冠', 'football', '⚽', '欧洲冠军联赛 · 假数据示例（MVP 结构预览，接真实数据时字段名不变）', '["schedule", "standings", "knockout", "bracket", "players"]'::jsonb, '2026-09-28T21:30:00+08:00'),
  ('epl', '英超', 'football', '⚽', '英格兰足球超级联赛 · 假数据示例（MVP 结构预览，接真实数据时字段名不变）', '["schedule", "standings", "race", "scorers", "players"]'::jsonb, '2026-09-28T21:30:00+08:00');

-- ---------- 2. hot_items · 24 条（3 平台 × 8） ----------
INSERT INTO public.hot_items (id, platform, platform_name, platform_desc, rank, title, heat, url, tag, is_video, fetched_at) VALUES
  ('hupu-1', 'hupu', '虎扑', '步行街热帖榜', 1, '湖人加时险胜凯尔特人，赛后更衣室视频曝光', 1523000, 'https://example.com/hupu-1', 'NBA', FALSE, '2026-09-25T22:30:00+08:00'),
  ('hupu-2', 'hupu', '虎扑', '步行街热帖榜', 2, '武磊替补登场制造绝杀，西班牙人球迷区炸了', 986000, 'https://example.com/hupu-2', '英超', FALSE, '2026-09-25T22:30:00+08:00'),
  ('hupu-3', 'hupu', '虎扑', '步行街热帖榜', 3, 'CBA 新赛季揭幕战定档，卫冕冠军领戒指仪式曝光', 752000, 'https://example.com/hupu-3', 'CBA', FALSE, '2026-09-25T22:30:00+08:00'),
  ('hupu-4', 'hupu', '虎扑', '步行街热帖榜', 4, '辣评：这届国家队防线问题到底出在哪', 634000, 'https://example.com/hupu-4', '中超', FALSE, '2026-09-25T22:30:00+08:00'),
  ('hupu-5', 'hupu', '虎扑', '步行街热帖榜', 5, '转会流言汇总：三名国脚冬窗动向一览', 521000, 'https://example.com/hupu-5', '英超', FALSE, '2026-09-25T22:30:00+08:00'),
  ('hupu-6', 'hupu', '虎扑', '步行街热帖榜', 6, '球迷热议：主教练赛后发布会回应换人争议', 438000, 'https://example.com/hupu-6', '中超', FALSE, '2026-09-25T22:30:00+08:00'),
  ('hupu-7', 'hupu', '虎扑', '步行街热帖榜', 7, '电竞分部全球总决赛半决赛观赛团招募中', 356000, 'https://example.com/hupu-7', '电竞', FALSE, '2026-09-25T22:30:00+08:00'),
  ('hupu-8', 'hupu', '虎扑', '步行街热帖榜', 8, '今日步行街票选：本周最佳进球你来定', 287000, 'https://example.com/hupu-8', '综合', FALSE, '2026-09-25T22:30:00+08:00'),
  ('tencent-1', 'tencent', '腾讯体育', '视频热榜', 1, '五佳球：欧洲赛场本周神仙球合集', 2104000, 'https://example.com/tx-1', '欧冠', TRUE, '2026-09-25T22:30:00+08:00'),
  ('tencent-2', 'tencent', '腾讯体育', '视频热榜', 2, '前瞻：NBA 揭幕周重点场次全解读', 1682000, 'https://example.com/tx-2', 'NBA', TRUE, '2026-09-25T22:30:00+08:00'),
  ('tencent-3', 'tencent', '腾讯体育', '视频热榜', 3, '集锦：英超第 6 轮十粒精彩进球', 1395000, 'https://example.com/tx-3', '英超', TRUE, '2026-09-25T22:30:00+08:00'),
  ('tencent-4', 'tencent', '腾讯体育', '视频热榜', 4, '专访：国乒主力谈新周期备战计划', 986000, 'https://example.com/tx-4', '综合', FALSE, '2026-09-25T22:30:00+08:00'),
  ('tencent-5', 'tencent', '腾讯体育', '视频热榜', 5, '战术板：三中卫体系为何再度流行', 812000, 'https://example.com/tx-5', '英超', TRUE, '2026-09-25T22:30:00+08:00'),
  ('tencent-6', 'tencent', '腾讯体育', '视频热榜', 6, '纪录片预告：中超三十年幕后故事', 674000, 'https://example.com/tx-6', '中超', TRUE, '2026-09-25T22:30:00+08:00'),
  ('tencent-7', 'tencent', '腾讯体育', '视频热榜', 7, '回放：欧冠小组赛抽签全程实录', 548000, 'https://example.com/tx-7', '欧冠', TRUE, '2026-09-25T22:30:00+08:00'),
  ('tencent-8', 'tencent', '腾讯体育', '视频热榜', 8, '盘点：新赛季五支值得关注的青年军', 421000, 'https://example.com/tx-8', 'CBA', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-1', 'cctv5', '央视体育', '官方权威发布', 1, '国家队公布新一期集训名单', 1892000, 'https://example.com/cctv-1', '综合', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-2', 'cctv5', '央视体育', '官方权威发布', 2, '中超第 27 轮赛程正式确定', 1243000, 'https://example.com/cctv-2', '中超', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-3', 'cctv5', '央视体育', '官方权威发布', 3, '世锦赛：中国队夺得两金一银', 1108000, 'https://example.com/cctv-3', '综合', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-4', 'cctv5', '央视体育', '官方权威发布', 4, '亚冠联赛抽签结果揭晓', 892000, 'https://example.com/cctv-4', '欧冠', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-5', 'cctv5', '央视体育', '官方权威发布', 5, '全国青少年足球联赛启动报名', 715000, 'https://example.com/cctv-5', '中超', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-6', 'cctv5', '央视体育', '官方权威发布', 6, 'CBA 全明星周末落户厦门', 586000, 'https://example.com/cctv-6', 'CBA', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-7', 'cctv5', '央视体育', '官方权威发布', 7, '马拉松赛季开跑：本周赛事日历', 463000, 'https://example.com/cctv-7', '综合', FALSE, '2026-09-25T22:30:00+08:00'),
  ('cctv5-8', 'cctv5', '央视体育', '官方权威发布', 8, '反兴奋剂教育讲座走进各训练基地', 352000, 'https://example.com/cctv-8', '综合', FALSE, '2026-09-25T22:30:00+08:00');

-- ---------- 3. news_items · 8 条 ----------
INSERT INTO public.news_items (id, title, summary, section, league, source_name, source_url, digest_date, status, created_at) VALUES
  ('20260929-n01', '【示例】湖人客场112比108击败凯尔特人', '【示例】湖人带走客场胜利稳住西部前六席位，后续将回到主场迎战勇士。', '头条', 'NBA', '示例来源·NBA官网', 'https://example.com/nba-lakers-celtics', '2026-09-29', 'published', '2026-09-29T09:30:00+08:00'),
  ('20260929-n02', '【示例】阿森纳逆转利物浦暂时领跑英超', '【示例】阿森纳两球落后连扳三城，此役影响争冠格局，下轮将客战曼城。', '头条', '英超', '示例来源·英超官网', 'https://example.com/epl-arsenal-liverpool', '2026-09-29', 'published', '2026-09-29T09:35:00+08:00'),
  ('20260929-n03', '【示例】湖人确认新援因伤缺阵两周', '【示例】主力前锋腿筋拉伤缺阵两周，影响轮换深度，两周后复查评估。', '转会伤病', 'NBA', '示例来源·NBA官网', 'https://example.com/nba-lakers-injury', '2026-09-29', 'published', '2026-09-29T09:40:00+08:00'),
  ('20260929-n04', '【示例】利物浦接近签下葡超中场', '【示例】转会费约四千万欧，背景是中场伤情告急，体检通过后官宣。', '转会伤病', '英超', '示例来源·英超官网', 'https://example.com/epl-liverpool-transfer', '2026-09-29', 'published', '2026-09-29T09:45:00+08:00'),
  ('20260929-n05', '【示例】中超争冠组周末开打', '【示例】积分榜前二仅差两分，周末直接对话影响冠军归属， CCTV5 直播。', '明日看点', '中超', '示例来源·中超官网', 'https://example.com/csl-title-race', '2026-09-29', 'published', '2026-09-29T09:50:00+08:00'),
  ('20260929-n06', '【示例】欧冠小组赛下周重燃战火', '【示例】多场强强对话定出线形势，看点是状态火热的射手对决，值得熬夜。', '明日看点', '欧冠', '示例来源·欧冠官网', 'https://example.com/ucl-group-stage', '2026-09-29', 'published', '2026-09-29T09:55:00+08:00'),
  ('20260929-n07', '【示例】电竞全球总决赛周末半决赛', '【示例】LPL 两队会师半决赛，胜者进决赛，赛制五局三胜，周末开打。', '明日看点', '电竞', '示例来源·赛事官方', 'https://example.com/esports-worlds-semi', '2026-09-29', 'published', '2026-09-29T10:00:00+08:00'),
  ('20260929-n08', '【示例】草稿条目：这条不应出现在页面上', '【示例】本条为 draft 状态，用于验证页面只显示已发布条目。', '热议', '综合', '示例来源·内部', 'https://example.com/draft-only', '2026-09-29', 'draft', '2026-09-29T10:05:00+08:00');

-- ---------- 4. matches · 9 场 ----------
INSERT INTO public.matches (id, league, home_team, away_team, match_time, status, home_score, away_score, round, venue, data_source, updated_at) VALUES
  ('20260924-nba-01', 'NBA', '凯尔特人', '湖人', '2026-09-24 07:30', '已结束', 108, 112, '季前赛', 'TD Garden', 'NBA官网（示例）', '2026-09-24T11:00:00+08:00'),
  ('20260925-epl-01', '英超', '阿森纳', '利物浦', '2026-09-25 10:00', '已结束', 3, 2, '英超第 6 轮', '酋长球场', '英超官网（示例）', '2026-09-25T12:00:00+08:00'),
  ('20260925-nba-02', 'NBA', '勇士', '太阳', '2026-09-25 14:30', '进行中', 58, 52, '季前赛', 'Chase Center', 'NBA官网（示例）', '2026-09-25T15:10:00+08:00'),
  ('20260925-epl-02', '英超', '切尔西', '曼城', '2026-09-25 20:00', '未开始', NULL, NULL, '英超第 6 轮', '斯坦福桥', '英超官网（示例）', '2026-09-25T09:00:00+08:00'),
  ('20261001-nba-01', 'NBA', '湖人', '勇士', '2026-10-01 09:00', '已结束', 118, 112, '季前赛', 'Crypto.com Arena', 'NBA官网（示例）', '2026-10-01T11:30:00+08:00'),
  ('20261001-nba-02', 'NBA', '凯尔特人', '热火', '2026-10-01 10:30', '进行中', 64, 58, '季前赛', 'TD Garden', 'NBA官网（示例）', '2026-10-01T11:45:00+08:00'),
  ('20261001-cba-01', 'CBA', '辽宁本钢', '广东宏远', '2026-10-01 19:35', '未开始', NULL, NULL, '常规赛第 1 轮', '沈阳奥体中心', 'CBA 官网（示例）', '2026-10-01T12:00:00+08:00'),
  ('20261001-epl-01', '英超', '曼联', '阿森纳', '2026-10-01 22:00', '未开始', NULL, NULL, '英超第 7 轮', '老特拉福德', '英超官网（示例）', '2026-10-01T12:10:00+08:00'),
  ('20261001-ucl-01', '欧冠', '皇家马德里', '拜仁慕尼黑', '2026-10-01 03:00', '已结束', 2, 2, '小组赛第 2 轮', '伯纳乌', '欧足联官网（示例）', '2026-10-01T05:20:00+08:00');

-- ---------- 5. league_schedule · 4 联赛 × 5 场 ----------
INSERT INTO public.league_schedule (id, league_id, match_date, match_time, status, home_team, away_team, home_score, away_score, round, venue) VALUES
  ('nba-20260928-01', 'nba', '2026-09-28', '07:30', '已结束', '凯尔特人', '尼克斯', 112, 108, '季前赛', 'TD 花园'),
  ('nba-20260928-02', 'nba', '2026-09-28', '10:00', '进行中', '勇士', '太阳', 58, 52, '季前赛', '大通中心'),
  ('nba-20260929-01', 'nba', '2026-09-29', '08:00', '未开始', '雷霆', '独行侠', NULL, NULL, '季前赛', 'Paycom 中心'),
  ('nba-20260929-02', 'nba', '2026-09-29', '10:30', '未开始', '湖人', '掘金', NULL, NULL, '季前赛', 'Crypto.com 球馆'),
  ('nba-20260929-03', 'nba', '2026-09-29', '11:00', '未开始', '热火', '骑士', NULL, NULL, '季前赛', '卡西亚中心'),
  ('cba-20260928-01', 'cba', '2026-09-28', '19:35', '已结束', '辽宁', '广东', 105, 98, '常规赛第 4 轮', '辽宁体育馆'),
  ('cba-20260928-02', 'cba', '2026-09-28', '20:00', '进行中', '浙江', '北京', 72, 68, '常规赛第 4 轮', '杭州奥体中心'),
  ('cba-20260929-01', 'cba', '2026-09-29', '19:35', '未开始', '新疆', '广厦', NULL, NULL, '常规赛第 4 轮', '乌鲁木齐奥体中心'),
  ('cba-20260929-02', 'cba', '2026-09-29', '19:35', '未开始', '上海', '深圳', NULL, NULL, '常规赛第 4 轮', '上海体育馆'),
  ('cba-20260929-03', 'cba', '2026-09-29', '20:00', '未开始', '山西', '青岛', NULL, NULL, '常规赛第 4 轮', '山西体育中心'),
  ('ucl-20260928-01', 'ucl', '2026-09-28', '03:00', '已结束', '皇家马德里', '曼城', 3, 1, '联赛阶段第 3 轮', '伯纳乌'),
  ('ucl-20260928-02', 'ucl', '2026-09-28', '03:00', '已结束', '拜仁慕尼黑', '阿森纳', 2, 2, '联赛阶段第 3 轮', '安联球场'),
  ('ucl-20260929-01', 'ucl', '2026-09-29', '03:00', '未开始', '巴塞罗那', '国际米兰', NULL, NULL, '联赛阶段第 3 轮', '奥林匹克球场'),
  ('ucl-20260929-02', 'ucl', '2026-09-29', '03:00', '未开始', '利物浦', '巴黎圣日耳曼', NULL, NULL, '联赛阶段第 3 轮', '安菲尔德'),
  ('ucl-20260930-01', 'ucl', '2026-09-30', '03:00', '未开始', '多特蒙德', '尤文图斯', NULL, NULL, '联赛阶段第 3 轮', '西格纳伊度纳公园'),
  ('epl-20260927-01', 'epl', '2026-09-27', '22:00', '已结束', '阿森纳', '利物浦', 3, 2, '英超第 7 轮', '酋长球场'),
  ('epl-20260927-02', 'epl', '2026-09-27', '19:30', '已结束', '切尔西', '曼城', 1, 1, '英超第 7 轮', '斯坦福桥'),
  ('epl-20260928-01', 'epl', '2026-09-28', '21:00', '进行中', '纽卡斯尔', '阿斯顿维拉', 1, 0, '英超第 7 轮', '圣詹姆斯公园'),
  ('epl-20260928-02', 'epl', '2026-09-28', '23:30', '未开始', '曼联', '热刺', NULL, NULL, '英超第 7 轮', '老特拉福德'),
  ('epl-20260929-01', 'epl', '2026-09-29', '03:00', '未开始', '埃弗顿', '水晶宫', NULL, NULL, '英超第 7 轮', '古迪逊公园');
  -- 共 20 行

-- ---------- 6. league_standings · 4 联赛 × 5 支队伍 ----------
INSERT INTO public.league_standings (id, league_id, rank, team_name, played, wins, draws, losses, goals_for, goals_against, points, points_diff, win_rate) VALUES
  ('nba-standings-1', 'nba', 1, '凯尔特人', NULL, 3, NULL, 0, NULL, NULL, NULL, '+24', '100%'),
  ('nba-standings-2', 'nba', 2, '雷霆', NULL, 2, NULL, 1, NULL, NULL, NULL, '+15', '67%'),
  ('nba-standings-3', 'nba', 3, '湖人', NULL, 2, NULL, 1, NULL, NULL, NULL, '+6', '67%'),
  ('nba-standings-4', 'nba', 4, '勇士', NULL, 1, NULL, 2, NULL, NULL, NULL, '-4', '33%'),
  ('nba-standings-5', 'nba', 5, '尼克斯', NULL, 0, NULL, 3, NULL, NULL, NULL, '-18', '0%'),
  ('cba-standings-1', 'cba', 1, '辽宁', NULL, 4, NULL, 0, NULL, NULL, NULL, '+38', '100%'),
  ('cba-standings-2', 'cba', 2, '广厦', NULL, 3, NULL, 1, NULL, NULL, NULL, '+21', '75%'),
  ('cba-standings-3', 'cba', 3, '广东', NULL, 3, NULL, 1, NULL, NULL, NULL, '+12', '75%'),
  ('cba-standings-4', 'cba', 4, '浙江', NULL, 2, NULL, 2, NULL, NULL, NULL, '-3', '50%'),
  ('cba-standings-5', 'cba', 5, '北京', NULL, 1, NULL, 3, NULL, NULL, NULL, '-15', '25%'),
  ('ucl-standings-1', 'ucl', 1, '皇家马德里', 3, 2, 1, 0, 8, 3, 7, NULL, NULL),
  ('ucl-standings-2', 'ucl', 2, '拜仁慕尼黑', 3, 2, 1, 0, 9, 5, 7, NULL, NULL),
  ('ucl-standings-3', 'ucl', 3, '曼城', 3, 1, 2, 0, 5, 4, 5, NULL, NULL),
  ('ucl-standings-4', 'ucl', 4, '阿森纳', 3, 1, 1, 1, 6, 5, 4, NULL, NULL),
  ('ucl-standings-5', 'ucl', 5, '国际米兰', 3, 0, 1, 2, 2, 6, 1, NULL, NULL),
  ('epl-standings-1', 'epl', 1, '阿森纳', 7, 5, 1, 1, 16, 8, 16, NULL, NULL),
  ('epl-standings-2', 'epl', 2, '利物浦', 7, 5, 0, 2, 15, 9, 15, NULL, NULL),
  ('epl-standings-3', 'epl', 3, '曼城', 7, 4, 2, 1, 14, 8, 14, NULL, NULL),
  ('epl-standings-4', 'epl', 4, '切尔西', 7, 4, 1, 2, 13, 9, 13, NULL, NULL),
  ('epl-standings-5', 'epl', 5, '曼联', 7, 3, 1, 3, 10, 11, 10, NULL, NULL);
  -- 共 20 行

-- ---------- 7. league_players · 球员数据榜 + 英超射手榜 ----------
INSERT INTO public.league_players (id, league_id, board, rank, player_name, team_name, points, rebounds, assists, apps, goals, rating) VALUES
  ('nba-player-1', 'nba', 'players', 1, '卢卡·东契奇', '湖人', 34.2, 8.9, 9.1, NULL, NULL, NULL),
  ('nba-player-2', 'nba', 'players', 2, '谢伊·吉尔杰斯-亚历山大', '雷霆', 32.7, 5.0, 6.4, NULL, NULL, NULL),
  ('nba-player-3', 'nba', 'players', 3, '扬尼斯·阿德托昆博', '雄鹿', 31.1, 11.8, 6.2, NULL, NULL, NULL),
  ('nba-player-4', 'nba', 'players', 4, '杰森·塔图姆', '凯尔特人', 28.4, 8.1, 5.3, NULL, NULL, NULL),
  ('nba-player-5', 'nba', 'players', 5, '安东尼·爱德华兹', '森林狼', 27.6, 5.7, 4.5, NULL, NULL, NULL),
  ('cba-player-1', 'cba', 'players', 1, '胡明轩', '广东', 26.8, 4.2, 6.5, NULL, NULL, NULL),
  ('cba-player-2', 'cba', 'players', 2, '赵继伟', '辽宁', 18.4, 3.8, 9.2, NULL, NULL, NULL),
  ('cba-player-3', 'cba', 'players', 3, '孙铭徽', '广厦', 21.6, 4.6, 8.1, NULL, NULL, NULL),
  ('cba-player-4', 'cba', 'players', 4, '周琦', '北京', 19.2, 11.4, 2.3, NULL, NULL, NULL),
  ('cba-player-5', 'cba', 'players', 5, '张镇麟', '辽宁', 20.5, 6.8, 3.9, NULL, NULL, NULL),
  ('ucl-player-1', 'ucl', 'players', 1, '裘德·贝林厄姆', '皇家马德里', NULL, NULL, 4, 6, 5, 8.3),
  ('ucl-player-2', 'ucl', 'players', 2, '基利安·姆巴佩', '皇家马德里', NULL, NULL, 1, 6, 6, 8.1),
  ('ucl-player-3', 'ucl', 'players', 3, '拉明·亚马尔', '巴塞罗那', NULL, NULL, 5, 6, 3, 8.2),
  ('ucl-player-4', 'ucl', 'players', 4, '哈里·凯恩', '拜仁慕尼黑', NULL, NULL, 3, 6, 4, 8.0),
  ('ucl-player-5', 'ucl', 'players', 5, '埃尔林·哈兰德', '曼城', NULL, NULL, 0, 6, 5, 7.9),
  ('epl-player-1', 'epl', 'players', 1, '穆罕默德·萨拉赫', '利物浦', NULL, NULL, 4, 7, 6, 8.2),
  ('epl-player-2', 'epl', 'players', 2, '布卡约·萨卡', '阿森纳', NULL, NULL, 3, 7, 5, 7.9),
  ('epl-player-3', 'epl', 'players', 3, '科尔·帕尔默', '切尔西', NULL, NULL, 2, 7, 5, 7.8),
  ('epl-player-4', 'epl', 'players', 4, '德克兰·赖斯', '阿森纳', NULL, NULL, 2, 7, 1, 7.6),
  ('epl-player-5', 'epl', 'players', 5, '埃尔林·哈兰德', '曼城', NULL, NULL, 2, 7, 8, 8.0),
  ('epl-scorer-1', 'epl', 'scorers', 1, '埃尔林·哈兰德', '曼城', NULL, NULL, 2, NULL, 8, NULL),
  ('epl-scorer-2', 'epl', 'scorers', 2, '穆罕默德·萨拉赫', '利物浦', NULL, NULL, 4, NULL, 6, NULL),
  ('epl-scorer-3', 'epl', 'scorers', 3, '布卡约·萨卡', '阿森纳', NULL, NULL, 3, NULL, 5, NULL),
  ('epl-scorer-4', 'epl', 'scorers', 4, '科尔·帕尔默', '切尔西', NULL, NULL, 2, NULL, 5, NULL),
  ('epl-scorer-5', 'epl', 'scorers', 5, '亚历山大·伊萨克', '纽卡斯尔', NULL, NULL, 1, NULL, 4, NULL);
  -- 共 25 行（含英超 5 条射手榜）

-- ---------- 8. league_brackets · 3 张晋级图 + 1 份争冠形势 + 1 个历史赛季 ----------
INSERT INTO public.league_brackets (id, league_id, season, kind, payload_json, updated_at) VALUES
  ('nba-25-26-bracket', 'nba', '25-26', 'bracket', '{"season": "25-26", "seasons": ["25-26", "24-25", "23-24"], "note": "结构约定：halves[].rounds[].matches[]；a/b 可写具体队伍 {seed,name,abbr,color} 或引用 {\"winnerOf\":\"上一场id\"}；scoreA/scoreB 为系列赛大比分；轮次数与每轮场数不限——赛制变化只改数据不改渲染器", "halves": [{"name": "东部", "rounds": [{"name": "首轮", "format": "BO7", "matches": [{"id": "nba-e1", "a": {"seed": 1, "name": "活塞", "abbr": "DET", "color": "#1d428a"}, "b": {"seed": 8, "name": "魔术", "abbr": "ORL", "color": "#0077c0"}, "scoreA": 4, "scoreB": 3, "winner": "a", "status": "已结束"}, {"id": "nba-e2", "a": {"seed": 4, "name": "骑士", "abbr": "CLE", "color": "#860038"}, "b": {"seed": 5, "name": "猛龙", "abbr": "TOR", "color": "#ce1141"}, "scoreA": 4, "scoreB": 3, "winner": "a", "status": "已结束"}, {"id": "nba-e3", "a": {"seed": 3, "name": "尼克斯", "abbr": "NYK", "color": "#f58426"}, "b": {"seed": 6, "name": "老鹰", "abbr": "ATL", "color": "#e03a3e"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}, {"id": "nba-e4", "a": {"seed": 2, "name": "凯尔特人", "abbr": "BOS", "color": "#007a33"}, "b": {"seed": 7, "name": "76人", "abbr": "PHI", "color": "#006bb6"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}]}, {"name": "半决赛", "format": "BO7", "matches": [{"id": "nba-e5", "a": {"winnerOf": "nba-e1"}, "b": {"winnerOf": "nba-e2"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}, {"id": "nba-e6", "a": {"winnerOf": "nba-e3"}, "b": {"winnerOf": "nba-e4"}, "scoreA": 4, "scoreB": 0, "winner": "a", "status": "已结束"}]}, {"name": "东部决赛", "format": "BO7", "matches": [{"id": "nba-e7", "a": {"winnerOf": "nba-e5"}, "b": {"winnerOf": "nba-e6"}, "scoreA": 0, "scoreB": 4, "winner": "b", "status": "已结束"}]}]}, {"name": "西部", "rounds": [{"name": "首轮", "format": "BO7", "matches": [{"id": "nba-w1", "a": {"seed": 1, "name": "雷霆", "abbr": "OKC", "color": "#007ac1"}, "b": {"seed": 8, "name": "太阳", "abbr": "PHX", "color": "#e56020"}, "scoreA": 4, "scoreB": 0, "winner": "a", "status": "已结束"}, {"id": "nba-w2", "a": {"seed": 4, "name": "湖人", "abbr": "LAL", "color": "#552583"}, "b": {"seed": 5, "name": "火箭", "abbr": "HOU", "color": "#ce1141"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}, {"id": "nba-w3", "a": {"seed": 3, "name": "掘金", "abbr": "DEN", "color": "#0e2240"}, "b": {"seed": 6, "name": "森林狼", "abbr": "MIN", "color": "#33455e"}, "scoreA": 2, "scoreB": 4, "winner": "b", "status": "已结束"}, {"id": "nba-w4", "a": {"seed": 2, "name": "马刺", "abbr": "SAS", "color": "#6f7683"}, "b": {"seed": 7, "name": "开拓者", "abbr": "POR", "color": "#e03a3e"}, "scoreA": 4, "scoreB": 1, "winner": "a", "status": "已结束"}]}, {"name": "半决赛", "format": "BO7", "matches": [{"id": "nba-w5", "a": {"winnerOf": "nba-w1"}, "b": {"winnerOf": "nba-w3"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}, {"id": "nba-w6", "a": {"winnerOf": "nba-w2"}, "b": {"winnerOf": "nba-w4"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}]}, {"name": "西部决赛", "format": "BO7", "matches": [{"id": "nba-w7", "a": {"winnerOf": "nba-w5"}, "b": {"winnerOf": "nba-w6"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}]}]}], "final": {"name": "总决赛", "format": "BO7", "a": {"winnerOf": "nba-e7"}, "b": {"winnerOf": "nba-w7"}, "scoreA": 4, "scoreB": 1, "winner": "a", "status": "已结束"}}'::jsonb, '2026-09-28T21:30:00+08:00'),
  ('cba-25-26-bracket', 'cba', '25-26', 'bracket', '{"season": "25-26", "seasons": ["25-26", "24-25"], "note": "CBA 近季赛制为 12 队季后赛：首轮（12 进 8，BO3）→ 1/4 决赛（BO5）→ 半决赛（BO7）→ 总决赛（BO7）；前 4 名种子在 1/4 决赛登场。结构与 NBA 同构（halves[].rounds[].matches[]），轮次数不限、赛制变化只改数据", "halves": [{"name": "上半区", "rounds": [{"name": "首轮", "format": "BO3", "matches": [{"id": "cba-u1", "a": {"seed": 5, "name": "浙江", "abbr": "ZHE", "color": "#d97706"}, "b": {"seed": 12, "name": "同曦", "abbr": "TXK", "color": "#7c3aed"}, "scoreA": 2, "scoreB": 1, "winner": "a", "status": "已结束"}, {"id": "cba-u2", "a": {"seed": 8, "name": "广东", "abbr": "GDB", "color": "#d0202f"}, "b": {"seed": 9, "name": "青岛", "abbr": "QDG", "color": "#005bac"}, "scoreA": 2, "scoreB": 0, "winner": "a", "status": "已结束"}]}, {"name": "1/4 决赛", "format": "BO5", "matches": [{"id": "cba-u3", "a": {"seed": 1, "name": "辽宁", "abbr": "LNB", "color": "#1b4a9b"}, "b": {"winnerOf": "cba-u2"}, "scoreA": 3, "scoreB": 1, "winner": "a", "status": "已结束"}, {"id": "cba-u4", "a": {"seed": 4, "name": "北京", "abbr": "BJG", "color": "#00639d"}, "b": {"winnerOf": "cba-u1"}, "scoreA": 2, "scoreB": 3, "winner": "b", "status": "已结束"}]}, {"name": "半决赛", "format": "BO7", "matches": [{"id": "cba-u5", "a": {"winnerOf": "cba-u3"}, "b": {"winnerOf": "cba-u4"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}]}]}, {"name": "下半区", "rounds": [{"name": "首轮", "format": "BO3", "matches": [{"id": "cba-d1", "a": {"seed": 6, "name": "上海", "abbr": "SHG", "color": "#1e50a2"}, "b": {"seed": 11, "name": "深圳", "abbr": "SZL", "color": "#0e7c3a"}, "scoreA": 2, "scoreB": 0, "winner": "a", "status": "已结束"}, {"id": "cba-d2", "a": {"seed": 7, "name": "新疆", "abbr": "XJG", "color": "#c41230"}, "b": {"seed": 10, "name": "南京", "abbr": "NJJ", "color": "#4338ca"}, "scoreA": 1, "scoreB": 2, "winner": "b", "status": "已结束"}]}, {"name": "1/4 决赛", "format": "BO5", "matches": [{"id": "cba-d3", "a": {"seed": 2, "name": "广厦", "abbr": "ZJS", "color": "#e60012"}, "b": {"winnerOf": "cba-d2"}, "scoreA": 3, "scoreB": 0, "winner": "a", "status": "已结束"}, {"id": "cba-d4", "a": {"seed": 3, "name": "山西", "abbr": "SHX", "color": "#b91c1c"}, "b": {"winnerOf": "cba-d1"}, "scoreA": 2, "scoreB": 2, "winner": null, "status": "进行中"}]}, {"name": "半决赛", "format": "BO7", "matches": [{"id": "cba-d5", "a": {"winnerOf": "cba-d3"}, "b": {"winnerOf": "cba-d4"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}]}]}], "final": {"name": "总决赛", "format": "BO7", "a": {"winnerOf": "cba-u5"}, "b": {"winnerOf": "cba-d5"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}}'::jsonb, '2026-09-28T21:30:00+08:00'),
  ('ucl-25-26-bracket', 'ucl', '25-26', 'bracket', '{"season": "25-26", "seasons": ["25-26", "24-25"], "note": "本示例为「赛季进行中」快照：16 强有未开始/进行中场次，8 强起出现待定席位（胜者待定）；两回合总比分制，决赛单场。节点可扩展：halves[].rounds[].matches[] 数量不限", "leagueStage": {"title": "联赛阶段（瑞士轮）已结束", "direct": ["利物浦", "阿森纳", "巴塞罗那", "拜仁慕尼黑", "曼城", "皇家马德里", "国际米兰", "巴黎圣日耳曼"], "playoffWinners": ["热刺", "勒沃库森", "本菲卡", "尤文图斯", "切尔西", "那不勒斯", "多特蒙德", "马德里竞技"], "note": "36 队联赛阶段前 8 名直通 16 强；9-24 名经淘汰赛附加赛决出另外 8 席（本区数据驱动，赛制再变只改 JSON）"}, "halves": [{"name": "上半区", "rounds": [{"name": "16 强", "format": "两回合", "matches": [{"id": "ucl-r1", "a": {"seed": 1, "name": "利物浦", "abbr": "LIV", "color": "#c8102e"}, "b": {"name": "巴黎圣日耳曼", "abbr": "PSG", "color": "#004170"}, "scoreA": 3, "scoreB": 1, "winner": "a", "status": "已结束"}, {"id": "ucl-r2", "a": {"seed": 2, "name": "阿森纳", "abbr": "ARS", "color": "#ef0107"}, "b": {"name": "勒沃库森", "abbr": "B04", "color": "#e32221"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}, {"id": "ucl-r3", "a": {"seed": 3, "name": "巴塞罗那", "abbr": "BAR", "color": "#a50044"}, "b": {"name": "本菲卡", "abbr": "SLB", "color": "#e00027"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}, {"id": "ucl-r4", "a": {"seed": 4, "name": "国际米兰", "abbr": "INT", "color": "#0068a8"}, "b": {"name": "热刺", "abbr": "TOT", "color": "#132257"}, "scoreA": 2, "scoreB": 2, "winner": null, "status": "进行中"}]}, {"name": "8 强", "format": "两回合", "matches": [{"id": "ucl-q1", "a": {"winnerOf": "ucl-r1"}, "b": {"winnerOf": "ucl-r2"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}, {"id": "ucl-q2", "a": {"winnerOf": "ucl-r3"}, "b": {"winnerOf": "ucl-r4"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}]}, {"name": "4 强", "format": "两回合", "matches": [{"id": "ucl-s1", "a": {"winnerOf": "ucl-q1"}, "b": {"winnerOf": "ucl-q2"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}]}]}, {"name": "下半区", "rounds": [{"name": "16 强", "format": "两回合", "matches": [{"id": "ucl-r5", "a": {"seed": 5, "name": "拜仁慕尼黑", "abbr": "BAY", "color": "#dc052d"}, "b": {"name": "切尔西", "abbr": "CHE", "color": "#034694"}, "scoreA": 2, "scoreB": 0, "winner": "a", "status": "已结束"}, {"id": "ucl-r6", "a": {"seed": 6, "name": "曼城", "abbr": "MCI", "color": "#6cabdd"}, "b": {"name": "那不勒斯", "abbr": "NAP", "color": "#12a0d7"}, "scoreA": 5, "scoreB": 1, "winner": "a", "status": "已结束"}, {"id": "ucl-r7", "a": {"seed": 7, "name": "皇家马德里", "abbr": "RMA", "color": "#b8860b"}, "b": {"name": "尤文图斯", "abbr": "JUV", "color": "#5b5b5b"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}, {"id": "ucl-r8", "a": {"seed": 8, "name": "多特蒙德", "abbr": "BVB", "color": "#c7a600"}, "b": {"name": "马德里竞技", "abbr": "ATM", "color": "#cb3524"}, "scoreA": 1, "scoreB": 2, "winner": null, "status": "进行中"}]}, {"name": "8 强", "format": "两回合", "matches": [{"id": "ucl-q3", "a": {"winnerOf": "ucl-r5"}, "b": {"winnerOf": "ucl-r6"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}, {"id": "ucl-q4", "a": {"winnerOf": "ucl-r7"}, "b": {"winnerOf": "ucl-r8"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}]}, {"name": "4 强", "format": "两回合", "matches": [{"id": "ucl-s2", "a": {"winnerOf": "ucl-q3"}, "b": {"winnerOf": "ucl-q4"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}]}]}], "final": {"name": "决赛", "format": "单场决胜", "venue": "普斯卡什竞技场 · 布达佩斯", "a": {"winnerOf": "ucl-s1"}, "b": {"winnerOf": "ucl-s2"}, "scoreA": null, "scoreB": null, "winner": null, "status": "未开始"}}'::jsonb, '2026-09-28T21:30:00+08:00'),
  ('epl-25-26-race', 'epl', '25-26', 'race', '{"season": "25-26", "seasons": ["25-26"], "note": "英超为联赛制、无季后赛——晋级图不适用，本标签改为「争冠形势」：分区与球队数量由数据驱动，可按需增减节点", "asOf": "截至第 7 轮", "zones": [{"id": "title", "name": "争冠集团", "color": "#d4a017", "desc": "冠军大概率在本区产生，前 3 名分差仅 2 分", "teams": [{"rank": 1, "name": "阿森纳", "abbr": "ARS", "color": "#ef0107", "played": 7, "points": 16, "form": ["W", "W", "D", "W", "L"], "trend": "up", "gap": "领先第 2 名 1 分"}, {"rank": 2, "name": "利物浦", "abbr": "LIV", "color": "#c8102e", "played": 7, "points": 15, "form": ["W", "L", "W", "W", "W"], "trend": "flat", "gap": "落后榜首 1 分"}, {"rank": 3, "name": "曼城", "abbr": "MCI", "color": "#6cabdd", "played": 7, "points": 14, "form": ["D", "W", "W", "D", "W"], "trend": "up", "gap": "落后榜首 2 分"}]}, {"id": "ucl", "name": "欧冠区", "color": "#3b82f6", "desc": "第 4 名：最后一个直通正赛名额，距争冠集团 3 分", "teams": [{"rank": 4, "name": "切尔西", "abbr": "CHE", "color": "#034694", "played": 7, "points": 13, "form": ["W", "D", "L", "W", "D"], "trend": "flat", "gap": "距第 3 名 1 分"}]}, {"id": "uel", "name": "欧战区（5-7 名）", "color": "#0e9488", "desc": "欧联杯与欧协联资格争夺，分差均在 1 分之内", "teams": [{"rank": 5, "name": "热刺", "abbr": "TOT", "color": "#132257", "played": 7, "points": 11, "form": ["L", "W", "W", "D", "W"], "trend": "up", "gap": "距欧冠区 2 分"}, {"rank": 6, "name": "曼联", "abbr": "MUN", "color": "#da291c", "played": 7, "points": 10, "form": ["D", "L", "W", "W", "L"], "trend": "down", "gap": "距第 5 名 1 分"}, {"rank": 7, "name": "纽卡斯尔", "abbr": "NEW", "color": "#414a52", "played": 7, "points": 9, "form": ["W", "D", "L", "W", "D"], "trend": "flat", "gap": "距第 6 名 1 分"}]}, {"id": "mid", "name": "中游（8-14 名）", "color": "#9ca3af", "desc": "积分胶着：欧战渐远、降级尚远，一波连胜就能改写座次", "teams": [{"rank": 8, "name": "阿斯顿维拉", "abbr": "AVL", "color": "#670e36", "played": 7, "points": 8, "form": ["D", "D", "W", "L", "D"], "trend": "flat", "gap": "距欧战区 1 分"}, {"rank": 9, "name": "布莱顿", "abbr": "BHA", "color": "#0057b8", "played": 7, "points": 8, "form": ["W", "L", "D", "D", "W"], "trend": "up", "gap": "与第 8 名同分"}, {"rank": 10, "name": "水晶宫", "abbr": "CRY", "color": "#1b458f", "played": 7, "points": 7, "form": ["D", "W", "L", "D", "L"], "trend": "down", "gap": "距第 9 名 1 分"}, {"rank": 11, "name": "诺丁汉森林", "abbr": "NFO", "color": "#dd0000", "played": 7, "points": 6, "form": ["D", "W", "L", "D", "W"], "trend": "up", "gap": "距第 10 名 1 分"}, {"rank": 12, "name": "西汉姆联", "abbr": "WHU", "color": "#7a263a", "played": 7, "points": 6, "form": ["L", "D", "W", "L", "D"], "trend": "down", "gap": "与第 11 名同分"}, {"rank": 13, "name": "埃弗顿", "abbr": "EVE", "color": "#003399", "played": 7, "points": 6, "form": ["D", "D", "D", "W", "L"], "trend": "flat", "gap": "与第 12 名同分"}, {"rank": 14, "name": "富勒姆", "abbr": "FUL", "color": "#262626", "played": 7, "points": 5, "form": ["W", "L", "L", "D", "L"], "trend": "down", "gap": "距第 13 名 1 分"}]}, {"id": "drop", "name": "保级边缘（15-17 名）", "color": "#d97706", "desc": "距降级区一步之遥：圣诞赛程前拿不到分就会滑进降级区", "teams": [{"rank": 15, "name": "伯恩茅斯", "abbr": "BOU", "color": "#da291c", "played": 7, "points": 5, "form": ["L", "W", "L", "L", "D"], "trend": "down", "gap": "与第 14 名同分"}, {"rank": 16, "name": "桑德兰", "abbr": "SUN", "color": "#eb172b", "played": 7, "points": 4, "form": ["D", "L", "W", "L", "L"], "trend": "down", "gap": "距第 15 名 1 分"}, {"rank": 17, "name": "莱斯特城", "abbr": "LEI", "color": "#003090", "played": 7, "points": 4, "form": ["L", "D", "L", "D", "L"], "trend": "down", "gap": "与第 16 名同分"}]}, {"id": "releg", "name": "降级区（18-20 名）", "color": "#dc2626", "desc": "赛季结束后降入英冠，与身前的保级线一步之遥", "teams": [{"rank": 18, "name": "布伦特福德", "abbr": "BRE", "color": "#e30613", "played": 7, "points": 3, "form": ["L", "L", "D", "W", "L"], "trend": "down", "gap": "距安全线 1 分"}, {"rank": 19, "name": "伯恩利", "abbr": "BUR", "color": "#6c1d45", "played": 7, "points": 2, "form": ["L", "D", "L", "L", "D"], "trend": "flat", "gap": "距安全线 2 分"}, {"rank": 20, "name": "狼队", "abbr": "WOL", "color": "#b3850d", "played": 7, "points": 1, "form": ["L", "L", "L", "D", "L"], "trend": "down", "gap": "距安全线 3 分"}]}]}'::jsonb, '2026-09-28T21:30:00+08:00'),
  ('nba-24-25-bracket', 'nba', '24-25', 'bracket', '{"season": "24-25", "seasons": ["25-26", "24-25", "23-24"], "note": "历史赛季示例（24-25）：用于演示前端 seasons 下拉切换，非真实赛果", "halves": [{"name": "东部", "rounds": [{"name": "首轮", "format": "BO7", "matches": [{"id": "nba-e1", "a": {"seed": 1, "name": "活塞", "abbr": "DET", "color": "#1d428a"}, "b": {"seed": 8, "name": "魔术", "abbr": "ORL", "color": "#0077c0"}, "scoreA": 4, "scoreB": 3, "winner": "a", "status": "已结束"}, {"id": "nba-e2", "a": {"seed": 4, "name": "骑士", "abbr": "CLE", "color": "#860038"}, "b": {"seed": 5, "name": "猛龙", "abbr": "TOR", "color": "#ce1141"}, "scoreA": 4, "scoreB": 3, "winner": "a", "status": "已结束"}, {"id": "nba-e3", "a": {"seed": 3, "name": "尼克斯", "abbr": "NYK", "color": "#f58426"}, "b": {"seed": 6, "name": "老鹰", "abbr": "ATL", "color": "#e03a3e"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}, {"id": "nba-e4", "a": {"seed": 2, "name": "凯尔特人", "abbr": "BOS", "color": "#007a33"}, "b": {"seed": 7, "name": "76人", "abbr": "PHI", "color": "#006bb6"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}]}, {"name": "半决赛", "format": "BO7", "matches": [{"id": "nba-e5", "a": {"winnerOf": "nba-e1"}, "b": {"winnerOf": "nba-e2"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}, {"id": "nba-e6", "a": {"winnerOf": "nba-e3"}, "b": {"winnerOf": "nba-e4"}, "scoreA": 4, "scoreB": 0, "winner": "a", "status": "已结束"}]}, {"name": "东部决赛", "format": "BO7", "matches": [{"id": "nba-e7", "a": {"winnerOf": "nba-e5"}, "b": {"winnerOf": "nba-e6"}, "scoreA": 0, "scoreB": 4, "winner": "b", "status": "已结束"}]}]}, {"name": "西部", "rounds": [{"name": "首轮", "format": "BO7", "matches": [{"id": "nba-w1", "a": {"seed": 1, "name": "雷霆", "abbr": "OKC", "color": "#007ac1"}, "b": {"seed": 8, "name": "太阳", "abbr": "PHX", "color": "#e56020"}, "scoreA": 4, "scoreB": 0, "winner": "a", "status": "已结束"}, {"id": "nba-w2", "a": {"seed": 4, "name": "湖人", "abbr": "LAL", "color": "#552583"}, "b": {"seed": 5, "name": "火箭", "abbr": "HOU", "color": "#ce1141"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}, {"id": "nba-w3", "a": {"seed": 3, "name": "掘金", "abbr": "DEN", "color": "#0e2240"}, "b": {"seed": 6, "name": "森林狼", "abbr": "MIN", "color": "#33455e"}, "scoreA": 2, "scoreB": 4, "winner": "b", "status": "已结束"}, {"id": "nba-w4", "a": {"seed": 2, "name": "马刺", "abbr": "SAS", "color": "#6f7683"}, "b": {"seed": 7, "name": "开拓者", "abbr": "POR", "color": "#e03a3e"}, "scoreA": 4, "scoreB": 1, "winner": "a", "status": "已结束"}]}, {"name": "半决赛", "format": "BO7", "matches": [{"id": "nba-w5", "a": {"winnerOf": "nba-w1"}, "b": {"winnerOf": "nba-w3"}, "scoreA": 4, "scoreB": 2, "winner": "a", "status": "已结束"}, {"id": "nba-w6", "a": {"winnerOf": "nba-w2"}, "b": {"winnerOf": "nba-w4"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}]}, {"name": "西部决赛", "format": "BO7", "matches": [{"id": "nba-w7", "a": {"winnerOf": "nba-w5"}, "b": {"winnerOf": "nba-w6"}, "scoreA": 3, "scoreB": 4, "winner": "b", "status": "已结束"}]}]}], "final": {"name": "总决赛", "format": "BO7", "a": {"winnerOf": "nba-e7"}, "b": {"winnerOf": "nba-w7"}, "scoreA": 4, "scoreB": 1, "winner": "a", "status": "已结束"}}'::jsonb, '2026-09-28T21:30:00+08:00');
  -- 共 5 行

-- ---------- 9. push_log · 推送流水示例 5 条 ----------
INSERT INTO public.push_log (id, digest_date, sent_at, recipient_count, status, failure_note) VALUES
  ('2026-09-25-am', '2026-09-25', '2026-09-25 07:05:00+08:00', 18, '成功', NULL),
  ('2026-09-26-am', '2026-09-26', '2026-09-26 07:05:00+08:00', 24, '成功', NULL),
  ('2026-09-27-am', '2026-09-27', '2026-09-27 07:06:00+08:00', 29, '部分失败', '3 个邮箱被服务商退信（地址不存在）'),
  ('2026-09-28-am', '2026-09-28', '2026-09-28 07:05:00+08:00', 31, '成功', NULL),
  ('2026-09-29-am', '2026-09-29', '2026-09-29 07:05:00+08:00', 33, '成功', NULL);

-- ---------- 10. subscribers · 订阅者示例 5 条 ----------
INSERT INTO public.subscribers (id, email, status, subscribed_at, unsubscribe_token, last_sent_at) VALUES
  ('sub-001', 'reader01@example.com', 'active',       '2026-09-22 10:00:00+08:00', 'tok-2f8a1c4e9b', '2026-09-29 07:05:00+08:00'),
  ('sub-002', 'reader02@example.com', 'active',       '2026-09-23 21:12:00+08:00', 'tok-7c31de90aa', '2026-09-29 07:05:00+08:00'),
  ('sub-003', 'reader03@example.com', 'active',       '2026-09-24 08:40:00+08:00', 'tok-a04b6f2d13', '2026-09-29 07:05:00+08:00'),
  ('sub-004', 'reader04@example.com', 'unsubscribed', '2026-09-24 19:05:00+08:00', 'tok-1db8e7c540', '2026-09-26 07:05:00+08:00'),
  ('sub-005', 'reader05@example.com', 'active',       '2026-09-25 12:30:00+08:00', 'tok-93fe5a0b27', '2026-09-29 07:05:00+08:00');

-- ---------- 收尾自检：一次看清每张表行数 ----------
SELECT 'leagues' AS 表名, count(*) AS 行数 FROM public.leagues
UNION ALL SELECT 'hot_items',        count(*) FROM public.hot_items
UNION ALL SELECT 'news_items',       count(*) FROM public.news_items
UNION ALL SELECT 'matches',          count(*) FROM public.matches
UNION ALL SELECT 'league_schedule',  count(*) FROM public.league_schedule
UNION ALL SELECT 'league_standings', count(*) FROM public.league_standings
UNION ALL SELECT 'league_players',   count(*) FROM public.league_players
UNION ALL SELECT 'league_brackets',  count(*) FROM public.league_brackets
UNION ALL SELECT 'push_log',         count(*) FROM public.push_log
UNION ALL SELECT 'subscribers',      count(*) FROM public.subscribers
ORDER BY 1;
