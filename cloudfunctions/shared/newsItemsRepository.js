/**
 * ============================================================
 * shared/newsItemsRepository.js — 数据访问层 · 资讯表（Day 19 建）
 * ------------------------------------------------------------
 * 负责表：public.news_items（资讯条目；收藏线把一篇文章存进这张表）
 * 服务接口：POST /api/favorites（收藏一条）、GET /api/favorites（收藏列表）
 *          （按 db/schema.sql：news_items 同时服务未来的 /api/news、/api/news/:id）
 *
 * 这一层只干一件事：**怎么读写 news_items**。
 *   - 知道表名、列名，以及「api 字段 ↔ 数据库列」的唯一映射
 *   - 知道按 source_url 判重、按 digest_date 数当天条数、按 created_at 倒序翻页
 *   - 知道业务主键怎么生成（契约 2.2：YYYYMMDD-n01）
 * 它不知道 HTTP、不认识 req/res、不知道 status code。
 *
 * 重构前这些代码在 cloudfunctions/favorites/index.js 的顶部常量区
 * （FAV_TO_DB / DB_TO_FAV / FAV_COLUMNS）与三个 handle 函数里（toFavoriteJSON /
 * makeId / 各处 queryTable+insertRow 调用）。Day 19 原样搬到此处，行为一字未改。
 *
 * 契约 0.1：数据库列 snake_case、接口输出 camelCase，映射在这层做。
 * ============================================================
 */

const pg = require('./pg');

// 表名（字面量常量，不来自用户输入）
const TABLE = 'news_items';

// 接口字段（camelCase） → 数据库列（snake_case）——**唯一映射来源**
const TO_DB = {
  id: 'id',
  title: 'title',
  summary: 'summary',
  section: 'section',
  league: 'league',
  sourceName: 'source_name',
  sourceUrl: 'source_url',
  digestDate: 'digest_date',
  status: 'status',
  createdAt: 'created_at'
};

// 数据库列 → 接口字段（由上面反转生成）
const TO_API = Object.keys(TO_DB).reduce((acc, k) => {
  acc[TO_DB[k]] = k;
  return acc;
}, {});

// 查询列（统一由映射生成，避免手写列名漂移）
const COLUMNS = Object.keys(TO_DB).map(k => TO_DB[k]).join(',');

/**
 * 数据库行 → 接口 JSON（snake_case → camelCase）。
 * 只输出映射表里认识的字段；行里没有的字段直接跳过（与重构前一致）。
 */
function toJSON(row) {
  const out = {};
  Object.keys(TO_API).forEach(col => {
    if (row[col] === undefined) return;
    out[TO_API[col]] = row[col];
  });
  return out;
}

/**
 * 生成业务主键：契约 2.2 规则 `YYYYMMDD-n01`。
 * 当天第 N 条 = 已有同日期条目数 + 1（两位序号）。
 * 同一毫秒并发可能撞号，但撞了会被主键挡下（返回数据库错误），不会写脏数据
 * —— 宁可失败也不覆盖别人。
 */
function makeId(digestDate, existingCount) {
  return digestDate.replace(/-/g, '') + '-n' + String(existingCount + 1).padStart(2, '0');
}

/**
 * 按原文链接查一条（防重用）。命中返回行对象，未命中返回 null。
 */
function findBySourceUrl(sourceUrl) {
  return pg.selectRows(TABLE, {
    select: COLUMNS,
    source_url: 'eq.' + sourceUrl,
    limit: 1
  }).then(rows => rows.length ? rows[0] : null);
}

/**
 * 统计某天已入库的条数（用于生成当天第 N 条序号）。
 * @returns {Promise<number>}
 */
function countByDigestDate(digestDate) {
  return pg.selectRows(TABLE, {
    select: 'id',
    digest_date: 'eq.' + digestDate
  }).then(rows => rows.length);
}

/**
 * 收藏列表：按创建时间倒序翻页。
 * @returns {Promise<Array>} 行数组
 */
function listRecent(limit, offset) {
  return pg.selectRows(TABLE, {
    select: COLUMNS,
    order: 'created_at.desc',
    limit: limit,
    offset: offset
  });
}

/**
 * 插入一条资讯（键为数据库列名 snake_case）。
 * 返回数据库回传的那一行（写进去的到底是什么，由数据库说了算）。
 */
function insert(row) {
  return pg.insertRow(TABLE, row);
}

/**
 * 接口字段（camelCase） → 数据库列（snake_case）。
 * 传 id / createdAt 时跳过：id 由业务自造、created_at 交给数据库默认 now()。
 * 只保留映射表认识的字段，多余字段丢弃（防脏字段混进库）。
 */
function toDbRow(input) {
  const row = {};
  Object.keys(TO_DB).forEach(k => {
    if (k === 'id' || k === 'createdAt') return;
    row[TO_DB[k]] = input[k];
  });
  return row;
}

module.exports = {
  TABLE: TABLE,
  TO_DB: TO_DB,
  TO_API: TO_API,
  COLUMNS: COLUMNS,
  toJSON: toJSON,
  toDbRow: toDbRow,
  makeId: makeId,
  findBySourceUrl: findBySourceUrl,
  countByDigestDate: countByDigestDate,
  listRecent: listRecent,
  insert: insert
};
