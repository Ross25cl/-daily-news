/**
 * ============================================================
 * shared/matchesRepository.js — 数据访问层 · 赛程比分表（Day 22 建）
 * ------------------------------------------------------------
 * 负责表：public.matches（赛程比分；一场比赛一行）
 * 服务接口：
 *   GET    /api/matches   —— 赛程比分读接口（本日仍走前端本地 JSON 兜底）
 *   PATCH  /api/matches   —— 改一条（Day 22 新增）：状态 / 比分 / 标题 / 摘要 / 备注
 *   DELETE /api/matches   —— 删一条（Day 22 新增；**软删除**，见下「关于软删除」）
 *
 * 这一层只干一件事：**怎么读写 matches**。
 *   - 知道表名、列名（白名单常量），以及「接口字段 ↔ 数据库列」的唯一映射
 *   - 知道按 id 取一行、按 id 改一行、按 id 软删一行、按 id 恢复一行
 * 它不知道 HTTP、不认识 req/res、不知道 status code —— 那些是接口层的事。
 *
 * 契约 0.1：数据库列 snake_case、接口输出 camelCase，映射在这层做。
 *
 * 关于「软删除」（Day 22 余力加练，重要）
 *   本表不真删数据：deleteById 保留但**接口层已不再调用**（那是维护通道，真删）；
 *   接口走的是 softDeleteById —— 只把 is_deleted 置 true。
 *   三处配套，缺一不可：
 *     ① 标记：softDeleteById 用 PATCH 置 is_deleted = true（**带上 is_deleted = false 条件**，
 *        所以对已删除的行再删一次命中 0 行 → 接口层自然给出 404，天然幂等）。
 *     ② 跳过：findById 一律带 is_deleted = false 过滤 → 删掉的行「查不到」，但**还在库里**。
 *     ③ 找回：restoreById 把标记改回 false。
 *   为什么 is_deleted 不进 TO_DB 映射表：映射表描述的是「接口契约里的字段」，
 *   is_deleted 是实现细节。不进映射表 → COLUMNS 不含它 → 接口响应里也不会出现，
 *   前端就不会以为存在一个可以随便拨的「删除开关」。

 *
 * 关于「标题 / 摘要 / 备注」（Day 22 决定，重要）
 *   任务清单要求 PATCH 能改「新闻标题、内容摘要、备注」，但 matches 这张表
 *   按 Day 16 的设计**只有比赛字段**（主客队 / 比分 / 状态…），没有标题与摘要。
 *   本日的处理：
 *     - 「备注」→ matches 本日新加 note 列（见 db/migrate-day22.sql），直接可改。
 *     - 「标题 / 摘要」→ 由**主客队 + 比分/状态拼出来**，是「展示用标题/摘要」，
 *       不是新增的列。改它的语义 = 改比赛的展示信息（例如微调主客队名、
 *       改轮次说明），因此映射到 home_team / away_team / round 这三个真实列。
 *     - news_items 表那边（标题 / 摘要 / 备注）由 newsItemsRepository 负责。
 *   —— 这样「清单点名的五类字段」两类表合起来全部可改，且不凭空造列。
 * ============================================================
 */

const pg = require('./pg');

// 表名（字面量常量，不来自用户输入）
const TABLE = 'matches';

// 接口字段（camelCase） → 数据库列（snake_case）——**唯一映射来源**
const TO_DB = {
  id: 'id',
  league: 'league',
  homeTeam: 'home_team',
  awayTeam: 'away_team',
  matchTime: 'match_time',
  status: 'status',
  homeScore: 'home_score',
  awayScore: 'away_score',
  round: 'round',
  venue: 'venue',
  dataSource: 'data_source',
  note: 'note',
  updatedAt: 'updated_at'
};

// 数据库列 → 接口字段（由上面反转生成）
const TO_API = Object.keys(TO_DB).reduce((acc, k) => {
  acc[TO_DB[k]] = k;
  return acc;
}, {});

// 查询列（统一由映射生成，避免手写列名漂移）
const COLUMNS = Object.keys(TO_DB).map(k => TO_DB[k]).join(',');

// ---------- 软删除（Day 22 余力加练） ----------
// 列名与「未删除」过滤条件收在这里，避免各处手写 'eq.false' 写错一个字母
// 就从「按条件过滤」变成「全表返回」。
const DELETED_COL = 'is_deleted';
const NOT_DELETED = { is_deleted: 'eq.false' };

// PATCH 允许改的字段白名单（＝任务清单点名的五类，去掉拼标题/摘要用的来源列）
//   status     ← 「赛事状态」
//   homeScore / awayScore ← 「最终比分」
//   homeTeam / awayTeam / round ← 「标题」（展示用主客队标题的组成部分）
//   venue      ← 「摘要」的一部分（场地）
//   note       ← 「备注」
// 其余字段（id / league / matchTime / dataSource）**不可改**：
//   id 是主键、league 与赛程归属相关、dataSource 是溯源凭据（改了就没法核对）。
// 另外 is_deleted **也不在**白名单里（它连 TO_DB 映射表都没进）：
//   删除标记只能由 softDeleteById / restoreById 这两条专用路径动，
//   不给 PATCH 开一个「顺手把删除开关拨一下」的后门。
const PATCHABLE = [
  'status',
  'homeScore', 'awayScore',
  'homeTeam', 'awayTeam', 'round',
  'venue', 'note'
];

/**
 * 数据库行 → 接口 JSON（snake_case → camelCase）。
 * 只输出映射表里认识的字段；行里没有的字段直接跳过。
 * 数值列统一转数字：PostgREST 回传的 integer 可能是字符串。
 */
function toJSON(row) {
  const out = {};
  Object.keys(TO_API).forEach(col => {
    if (row[col] === undefined) return;
    out[TO_API[col]] = row[col];
  });
  if (out.homeScore !== undefined && out.homeScore !== null) out.homeScore = Number(out.homeScore);
  if (out.awayScore !== undefined && out.awayScore !== null) out.awayScore = Number(out.awayScore);
  return out;
}

/**
 * 按 id 取一行（改之前先取快照：接口要能返回「改之前 vs 改之后」）。
 *
 * ⚠️ 一律带 `is_deleted = false` 过滤（软删除的「跳过」在这里生效）：
 *   被标记删除的行**取不到**，所以下游的 PATCH / DELETE / 复查 GET 全都看不见它，
 *   ——「删掉之后 GET 不再返回」这条完成标准，靠的就是这一句过滤。
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
 * 按 id 改一行。
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
 * ⚠️ 接口层已不再调用它（DELETE /api/matches 走的是下面的软删除）。
 *   留着的唯一理由：软删除会留下「永远查不到、但一直占着主键」的行，
 *   需要有个出口把它们彻底清掉（清测试垃圾、或真的要执行数据清除）。
 *   调用方式只有数据库 SQL 或服务端脚本，前端碰不到。
 * @returns {Promise<object|null>} 被删掉的那一行；null = id 不存在（命中 0 行）
 */
function deleteById(id) {
  return pg.deleteRows(TABLE, { id: 'eq.' + id })
    .then(rows => rows.length ? rows[0] : null);
}

/**
 * 【Day 22 余力加练】按 id 软删除一行 —— 只打标记，数据留在库里。
 *
 * 两个细节是故意的：
 *   1. 条件是 `id = eq.<id>` **且** `is_deleted = eq.false`：
 *      对已经删过的行再删一次命中 0 行 → 返回 null → 接口层如实给 404「无需删除」，
 *      天然幂等，也不会去动一条已经躺着的行。
 *   2. 用 PATCH 而不是 DELETE，所以**同样受底座那条安全阀约束**
 *      （必须带 eq. 过滤，否则直接报错）—— 换成软删除并没有把「防误删」降级。
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
 * 【Day 22 余力加练】按 id 恢复一行 —— 把软删除标记改回 false。
 * 这是「删错了还能找回」里「找回」的那一步；恢复后该行立刻重新出现在查询里。
 *
 * 条件写的是 `is_deleted = eq.true`：只恢复**确实被软删过**的行。
 * 对一行活着的数据调恢复 → 命中 0 行 → null，不会白改它的 updated_at。
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
 * 接口字段（camelCase） → 数据库列（snake_case），只保留 PATCHABLE 白名单内的。
 * 白名单外的字段直接丢弃（静默忽略，不报错）—— 接口层会另行提示「哪些字段不生效」。
 * updatedAt 不由调用方给：这里强制写当前时刻（改过就得留痕）。
 */
function toPatchRow(input) {
  const row = {};
  PATCHABLE.forEach(k => {
    if (input[k] === undefined) return;
    row[TO_DB[k]] = input[k];
  });
  return row;
}

/**
 * 拼「展示用标题/摘要」。
 * 理由见文件头：matches 没有 title / summary 列，这两个词在赛程语境下
 * 就是「主客队 + 比分」的展示串，所以不落库、由字段现算。
 *   标题：`<主队> vs <客队>`（或 `<主队> vs <客队>（<状态>）`）
 *   摘要：`<联赛> · <轮次> · <时间>` + 比分或状态
 */
function toTitle(row) {
  if (!row) return '';
  const vs = (row.home_team || '?') + ' vs ' + (row.away_team || '?');
  const status = row.status || '';
  return status ? vs + '（' + status + '）' : vs;
}

function toSummary(row) {
  if (!row) return '';
  const parts = [];
  if (row.league) parts.push(row.league);
  if (row.round) parts.push(row.round);
  if (row.match_time) parts.push(String(row.match_time).replace('T', ' ').slice(0, 16));
  let head = parts.join(' · ');

  if (row.home_score !== null && row.home_score !== undefined &&
    row.away_score !== null && row.away_score !== undefined) {
    head += '，' + row.home_score + ':' + row.away_score;
  }
  if (row.venue) head += '，' + row.venue;
  return head;
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
  toPatchRow: toPatchRow,
  toTitle: toTitle,
  toSummary: toSummary,
  findById: findById,
  updateById: updateById,
  deleteById: deleteById,
  softDeleteById: softDeleteById,
  restoreById: restoreById
};
