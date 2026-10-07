/**
 * ============================================================
 * shared/hotItemsRepository.js — 数据访问层 · 热搜表（Day 19 建）
 * ------------------------------------------------------------
 * 负责表：public.hot_items（三平台热搜榜条目）
 * 服务接口：GET /api/hot（首页三平台热搜榜）
 *
 * 这一层只干一件事：**怎么查 hot_items**。
 *   - 知道表名、列名（白名单常量）
 *   - 知道「按平台取前 N 名」这个查法
 *   - 知道怎么把数据库行（snake_case）翻译成接口字段（camelCase）
 * 它不知道 HTTP、不认识 req/res、不知道 status code ——
 * 那些是接口层的事。
 *
 * 重构前这些代码在 cloudfunctions/api/index.js 里（内联的 queryTable +
 * handleHot 里一段行映射），Day 19 原样搬到这里，行为一字未改。
 * Day 20 只加了一个 latestFetchedAt()（接口的 meta.updatedAt 要显示真实抓取时间）。
 * ============================================================
 */

const pg = require('./pg');

// 表名（字面量常量，不来自用户输入）
const TABLE = 'hot_items';

// 查询列（与契约 2.1 输出字段一一对应）
const COLUMNS = 'rank,title,heat,url,tag,is_video';

// 「数据是什么时候抓的」那一列。
// 它不参与条目输出，只用来回答首页那句「最近更新」——
// 说「最近更新」时指的是**官网抓取时间**，不是接口被调用的时间（Day 20 修正）。
const FETCHED_AT = 'fetched_at';

/**
 * 取某平台热搜前 N 名。
 *
 * @param {string} platform  平台标识（调用方已过白名单，只可能是 hupu/tencent/cctv5）
 * @param {number} limit     取多少条
 * @returns {Promise<Array>} 数据库行数组（snake_case）
 */
function findByPlatform(platform, limit) {
  return pg.selectRows(TABLE, {
    select: COLUMNS,
    platform: 'eq.' + platform,   // 值来自白名单常量，不是用户原始输入
    order: 'rank.asc',
    limit: limit
  });
}

/**
 * 【Day 20 新增】取全表最新一次抓取时间（ISO 字符串）。
 *
 * 用途：接口 meta.updatedAt —— 页面上的「最近更新」要显示**真实抓取时间**，
 * 不能拿 new Date() 顶替：那样每次刷新都会显示「刚刚」，看着新、其实数据是昨天的。
 *
 * 取法是「按 fetched_at 倒序取 1 行」而不是 max()：
 * PostgREST 的聚合查询要额外开权限，而本层本来就只有查询参数可用（不拼 SQL）。
 *
 * @returns {Promise<string>} 形如 `2026-10-05T15:30:00+00:00`；表为空时返回 ''
 */
function latestFetchedAt() {
  return pg.selectRows(TABLE, {
    select: FETCHED_AT,
    order: FETCHED_AT + '.desc',
    limit: 1
  }).then(rows => (rows[0] && rows[0][FETCHED_AT]) || '');
}

/**
 * 数据库行 → 接口条目 JSON（契约 2.1 的 items[] 形状）。
 * 两个要点：
 *   1. rank / heat 在库里是数值类型，但 PostgREST 回传可能是字符串，
 *      这里统一 Number() 强转，保证接口输出永远是数字（形状不变）。
 *   2. tag 缺省补「综合」、is_video 转布尔 —— 与重构前逐字一致。
 */
function toItemJSON(row) {
  return {
    rank: Number(row.rank),
    title: row.title,
    heat: Number(row.heat),
    url: row.url,
    tag: row.tag || '综合',
    video: !!row.is_video
  };
}

module.exports = {
  TABLE: TABLE,
  findByPlatform: findByPlatform,
  latestFetchedAt: latestFetchedAt,
  toItemJSON: toItemJSON
};
