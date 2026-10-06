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
 * ============================================================
 */

const pg = require('./pg');

// 表名（字面量常量，不来自用户输入）
const TABLE = 'hot_items';

// 查询列（与契约 2.1 输出字段一一对应）
const COLUMNS = 'rank,title,heat,url,tag,is_video';

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
  toItemJSON: toItemJSON
};
