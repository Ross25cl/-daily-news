/**
 * ============================================================
 * shared/newsItemsRepository.js — 数据访问层 · 资讯表（Day 19 建）
 * ------------------------------------------------------------
 * 负责表：public.news_items（资讯条目；收藏线把一篇文章存进这张表）
 * 服务接口：POST /api/favorites（收藏一条）、GET /api/favorites（收藏列表）
 *          PATCH /api/news （改一条，Day 22 新增）、DELETE /api/news（删一条，Day 22 新增）
 *          （按 db/schema.sql：news_items 同时服务未来的 /api/news、/api/news/:id）
 *
 * 这一层只干一件事：**怎么读写 news_items**。
 *   - 知道表名、列名，以及「api 字段 ↔ 数据库列」的唯一映射
 *   - 知道按 source_url 判重、按 digest_date 数当天条数、按 created_at 倒序翻页
 *   - 知道按 id 改一行、按 id 删一行（Day 22）
 *   - 知道业务主键怎么生成（契约 2.2：YYYYMMDD-n01）
 * 它不知道 HTTP、不认识 req/res、不知道 status code。
 *
 * 重构前这些代码在 cloudfunctions/favorites/index.js 的顶部常量区
 * （FAV_TO_DB / DB_TO_FAV / FAV_COLUMNS）与三个 handle 函数里（toFavoriteJSON /
 * makeId / 各处 queryTable+insertRow 调用）。Day 19 原样搬到此处，行为一字未改。
 *
 * 契约 0.1：数据库列 snake_case、接口输出 camelCase，映射在这层做。
 *
 * 关于「软删除」（Day 22 余力加练）
 *   与 matchesRepository 同款：DELETE 只打 is_deleted 标记，查询跳过，可恢复。
 *   但本表多一个**必须想清楚的地方**：哪些查询该跳过被删的行，哪些**不能**跳过。
 *     跳过   → findById（删了就该查不到）、listRecent（收藏列表不展示已删的）
 *     不跳过 → countByDigestDate（序号 = 当天已有条数；跳过会让序号重算 → 撞主键）
 *              findBySourceUrl（source_url 是全表唯一键，含已删行才能与约束一致，
 *                               否则「查不到 → 去插 → 撞唯一约束」变成看不懂的报错）
 *   两处「不跳过」都写了理由，别顺手「统一一下」。
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
  note: 'note',
  createdAt: 'created_at'
};

// 数据库列 → 接口字段（由上面反转生成）
const TO_API = Object.keys(TO_DB).reduce((acc, k) => {
  acc[TO_DB[k]] = k;
  return acc;
}, {});

// 查询列（统一由映射生成，避免手写列名漂移）
const COLUMNS = Object.keys(TO_DB).map(k => TO_DB[k]).join(',');

// ---------- 软删除（Day 22 余力加练） ----------
// is_deleted **不进 TO_DB 映射表** → COLUMNS 不含它 → 接口响应里不会出现这个开关。
// 但 findBySourceUrl 需要看见它（判断「命中的是一条已删除的文章」），
// 所以那一处单独把它加进 select，见下面的注释。
const DELETED_COL = 'is_deleted';
const NOT_DELETED = { is_deleted: 'eq.false' };

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
 *
 * ⚠️ **故意不过滤 is_deleted**（软删除的例外之一）：
 *   source_url 上有全表唯一约束，所以「按 source_url 查」必须能看见已删除的行 ——
 *   否则会出现最难受的一种状态：查不到 → 走去插入 → 撞唯一约束 → 报一个
 *   「这篇文章已存在」但列表里又看不到它。
 *   看得见它，接口层才能做正确的处置（favorites 对已删行走「复活」，见 favorites/index.js）。
 *   select 里额外带上 is_deleted，就是为了让调用方能做出这个判断。
 */
function findBySourceUrl(sourceUrl) {
  return pg.selectRows(TABLE, {
    select: COLUMNS + ',' + DELETED_COL,
    source_url: 'eq.' + sourceUrl,
    limit: 1
  }).then(rows => rows.length ? rows[0] : null);
}

/**
 * 统计某天已入库的条数（用于生成当天第 N 条序号）。
 *
 * ⚠️ **故意不过滤 is_deleted**（软删除的例外之二）：
 *   序号规则是「当天第 N 条」，而软删除的行**仍然占着主键**（形如 20261009-n01）。
 *   若统计时跳过它们，N 会从更小的值重算 → 生成到一个已被占用的 id →
 *   撞主键报错。数「库里实际有几条」而不是「有几条活着」，才和主键分配一致。
 *
 * @returns {Promise<number>}
 */
function countByDigestDate(digestDate) {
  return pg.selectRows(TABLE, {
    select: 'id',
    digest_date: 'eq.' + digestDate
  }).then(rows => rows.length);
}

/**
 * 收藏列表：按创建时间倒序翻页，**跳过已软删除的行**。
 * 删掉的收藏不该继续出现在列表里 —— 这是「删除」对用户可见的部分。
 * @returns {Promise<Array>} 行数组
 */
function listRecent(limit, offset) {
  return pg.selectRows(TABLE, Object.assign({
    select: COLUMNS,
    order: 'created_at.desc',
    limit: limit,
    offset: offset
  }, NOT_DELETED));
}

/**
 * 插入一条资讯（键为数据库列名 snake_case）。
 * 返回数据库回传的那一行（写进去的到底是什么，由数据库说了算）。
 */
function insert(row) {
  return pg.insertRow(TABLE, row);
}

/**
 * 【Day 22】按 id 取一行（改之前先取快照，接口要能给出「改之前 vs 改之后」）。
 * 只取 published 吗？——**不**。改删接口是运营动作，草稿也要能改/能删，
 * 所以这里不做 status 过滤。
 * 但 **一定要带 is_deleted = false**（软删除的「跳过」）：被标记删除的行取不到，
 * 于是 PATCH / DELETE / 复查 GET 全都看不见它 ——「删掉之后 GET 不再返回」就靠这一句。
 * @returns {Promise<object|null>} 行对象或 null
 */
function findById(id) {
  return pg.selectRows(TABLE, Object.assign({
    select: COLUMNS,
    id: 'eq.' + id,
    limit: 1
  }, NOT_DELETED)).then(rows => rows.length ? rows[0] : null);
}

/**
 * 【Day 22】按 id 改一行。
 * @param {string} id
 * @param {object} patch  键为**数据库列名**（snake_case），调用方已过白名单
 * @returns {Promise<object|null>} 改后的行；null = id 不存在（命中 0 行）
 */
function updateById(id, patch) {
  return pg.updateRows(TABLE, patch, { id: 'eq.' + id })
    .then(rows => rows.length ? rows[0] : null);
}

/**
 * 【维护通道】按 id **真删**一行 —— 数据从库里消失，找不回来。
 *
 * ⚠️ 接口层已不再调用它（DELETE /api/news 走下面的软删除）。
 *   留着是为了有个出口清掉「永远查不到、却一直占着 id」的行（清测试垃圾、真要清除数据）。
 *   只从数据库 SQL 或服务端脚本调用，前端碰不到。
 * @returns {Promise<object|null>} 被删掉的那一行；null = id 不存在（命中 0 行）
 */
function deleteById(id) {
  return pg.deleteRows(TABLE, { id: 'eq.' + id })
    .then(rows => rows.length ? rows[0] : null);
}

/**
 * 【Day 22 余力加练】按 id 软删除一行 —— 只打标记，数据留在库里。
 *
 * 条件里带上 `is_deleted = eq.false`：对已删除的行再删一次命中 0 行 → null →
 * 接口层给 404「无需删除」，天然幂等。
 * 走 PATCH 而不是 DELETE，因此**同样受底座安全阀约束**（必须带 eq. 过滤）。
 *
 * @returns {Promise<object|null>} 标记后的行；null = 没有可标记的行
 */
function softDeleteById(id) {
  const patch = {};
  patch[DELETED_COL] = true;
  return pg.updateRows(TABLE, patch, { id: 'eq.' + id, is_deleted: 'eq.false' })
    .then(rows => rows.length ? rows[0] : null);
}

/**
 * 【Day 22 余力加练】按 id 恢复一行 —— 把软删除标记改回 false（「删错了还能找回」）。
 *
 * 条件写 `is_deleted = eq.true`：只恢复确实被软删过的行，
 * 对活着的数据调恢复命中 0 行 → null，不会白改它的时间戳。
 *
 * ⚠️ 恢复时**不动 source_url**：它本来就是原值（软删除只改了标记），
 *   所以恢复后不会和唯一约束打架。
 *
 * @returns {Promise<object|null>} 恢复后的行；null = 没有可恢复的行
 */
function restoreById(id) {
  const patch = {};
  patch[DELETED_COL] = false;
  return pg.updateRows(TABLE, patch, { id: 'eq.' + id, is_deleted: 'eq.true' })
    .then(rows => rows.length ? rows[0] : null);
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

/**
 * 【Day 22】news_items 上 PATCH 允许改的字段白名单。
 * 对应任务清单点名的四类：
 *   title      ← 「新闻标题」
 *   summary    ← 「内容摘要」
 *   note       ← 「备注」
 *   status     ← 本条资讯的发布状态（draft/published）
 * 其余一律不可改：id 是主键、source_url 是防重键与溯源凭据、digest_date 决定归属日、
 * created_at 是写入时刻。改它们会破坏 Day 18 定下的防重语义。
 * is_deleted 也**不在**白名单（它连 TO_DB 映射表都没进）：
 *   删除标记只能由 softDeleteById / restoreById 这两条专用路径动。
 */
const PATCHABLE = ['title', 'summary', 'note', 'status'];

/**
 * 只挑白名单内的字段，并转成数据库列名。白名单外的静默丢弃（接口层会提示）。
 */
function toPatchRow(input) {
  const row = {};
  PATCHABLE.forEach(k => {
    if (input[k] === undefined) return;
    row[TO_DB[k]] = input[k];
  });
  return row;
}

module.exports = {
  TABLE: TABLE,
  TO_DB: TO_DB,
  TO_API: TO_API,
  COLUMNS: COLUMNS,
  PATCHABLE: PATCHABLE,
  DELETED_COL: DELETED_COL,
  NOT_DELETED: NOT_DELETED,
  toJSON: toJSON,
  toDbRow: toDbRow,
  toPatchRow: toPatchRow,
  makeId: makeId,
  findBySourceUrl: findBySourceUrl,
  countByDigestDate: countByDigestDate,
  listRecent: listRecent,
  insert: insert,
  findById: findById,
  updateById: updateById,
  deleteById: deleteById,
  softDeleteById: softDeleteById,
  restoreById: restoreById
};
