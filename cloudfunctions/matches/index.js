/**
 * ============================================================
 * matches/index.js — 每日体坛速览 · 赛程比分写接口云函数（Day 22 建）
 * ------------------------------------------------------------
 * 今日实现（第 4 周板块① ②）：
 *   PATCH  /api/matches  —— 改一条比赛记录（状态 / 比分 / 展示标题 / 备注）
 *   DELETE /api/matches  —— 删一条比赛记录（**软删除**：只打标记，数据留在库里）
 *   GET    /api/matches  —— 读（本日仅提供「按 id 取一条」做改删验证；
 *                           列表读接口仍按契约 §2.4 属占位，前端走本地 JSON 兜底）
 *
 * 【分层】本文件只做三件事：**接请求、调函数、返响应**。
 *   表名/列名/字段映射/改删语句都在数据访问层：
 *     - cloudfunctions/shared/pg.js                —— 连接底座（怎么连库）
 *     - cloudfunctions/shared/matchesRepository.js —— 赛程表读写（怎么读写 matches）
 *   响应包络、日志、body 解析、id 校验在 cloudfunctions/shared/httpKit.js
 *   留在本文件的：路由/方法分支、**哪些字段允许改**、状态码，即「接口的对外行为」。
 *
 * 【今日掌握项：删除为什么比新增更容易出事？】
 *   新增是「加」，写错了最坏是多一条脏数据，看得见、删得掉。
 *   删除是「减」，写错一个 WHERE 就是一片数据没了，而且**不可逆**。
 *   本接口为此设了五道闸（第 ⑤ 道是余力加练补上的）：
 *     ① 路径层：只认 /api/matches，方法必须是 DELETE（写错方法先被 405 挡下）
 *     ② 底座层：pg.deleteRows / updateRows 拒绝无 eq. 过滤的写（少写条件直接报错，不是静默清表）
 *     ③ 接口层：先按 id 查一次 → 不存在就 404，压根不发删除请求；
 *                删除用 `id=eq.<id>` 精确定位，永远只可能命中 0 或 1 行
 *     ④ 前端层：检查台给了二次确认弹窗（清单要求 5）
 *     ⑤ 存储层：**软删除** —— 根本不是真删，只把 is_deleted 置 true。
 *                前四道闸是「别删错」，这一道是「删错了还能回来」：
 *                真删是不可逆的最后一步，软删除把这一步变成可逆的标记。
 *   —— 「在哪加了确认」：②③ 是代码里的确认，④ 是人手上的确认，⑤ 是留给自己的后路。
 *
 * 【软删除怎么体现（Day 22 余力加练）】
 *   标记：DELETE 走 repo.softDeleteById（PATCH is_deleted = true），不是 DELETE 语句。
 *   跳过：repo.findById 一律带 is_deleted = false 过滤 → 删完 GET 就是 404，
 *        本日那句完成标准「DELETE 删除后 GET 不再返回」一字不改地成立。
 *   找回：repo.restoreById 把标记改回 false，数据立刻回来（服务端调用，无对外接口）。
 *
 * 数据链路：
 *   浏览器 → 网关 /api/matches → 本云函数 → matchesRepository → 连接底座 pg.js
 *                                        → CloudBase PG 的 HTTP API（PostgREST）
 *
 * 安全（SQL 参数化）：本层与 repository 层都不拼 SQL —— 定位条件走 PostgREST
 *   查询参数（id=eq.…），要改的值走 PATCH 的 JSON body，由平台侧编译成参数化 SQL。
 *   表名/列名来自 repository 的白名单常量；用户输入先过校验（id 形态 / 字段白名单 /
 *   状态枚举 / 比分范围）才允许使用。
 * ============================================================
 */

const repo = require('../shared/matchesRepository');
const pg = require('../shared/pg');
const kit = require('../shared/httpKit');

// ---------- 白名单（与 db/schema.sql 的 CHECK 约束一一对应） ----------

const STATUSES = ['未开始', '进行中', '已结束', '延期', '取消'];
const TERMINAL_STATUS = '已结束';   // 该状态下两个比分必须都有值（DB 约束也一样）
const SCORE_MIN = 0;
const SCORE_MAX = 999;

// PATCH 允许改的字段（＝repository 的白名单，这里再声明一次是为了给出中文错误信息）
const PATCHABLE = repo.PATCHABLE;

// 字段 → 中文名（错误信息里用人类看得懂的说法）
const FIELD_CN = {
  status: '赛事状态',
  homeScore: '主队最终比分',
  awayScore: '客队最终比分',
  homeTeam: '主队名',
  awayTeam: '客队名',
  round: '轮次',
  venue: '场地',
  note: '备注'
};

// ---------- 入参校验 ----------

/**
 * 校验 PATCH body。
 *
 * 设计要点（与 Day 18 的 favorites 保持一致，减少心智负担）：
 *   1. **一次性收集全部问题**再返回 —— 用户一屏看到所有毛病，不用改一个报一个。
 *   2. 错误信息全中文，且说清「字段中文名 + 应该是什么」。
 *   3. 只留白名单内字段，多余字段丢弃并在 meta 里说明（不静默吞掉用户的意图）。
 *
 * @param {object} body
 * @param {Array<{column:string,value:any}>} [pre] 数据库里已有的值，用于做跨字段一致性校验
 */
function validatePatchInput(body, pre) {
  const errors = [];
  const ignored = [];
  const value = {};

  Object.keys(body).forEach(k => {
    if (k === 'id') return;                       // id 用来定位，不算要改的字段
    if (PATCHABLE.indexOf(k) < 0) {
      ignored.push(k);
      return;
    }
    value[k] = body[k];
  });

  if (Object.keys(value).length === 0) {
    errors.push('没有可修改的字段。请至少提交以下之一：' +
      PATCHABLE.map(k => k + '（' + FIELD_CN[k] + '）').join('、') + '。');
  }

  function str(key) {
    const v = value[key];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v.trim() : String(v).trim();
  }

  // ---- 状态：五种枚举，且必须是非空字符串 ----
  if (value.status !== undefined) {
    const s = str('status');
    if (!s) {
      errors.push('字段 status（赛事状态）不能为空。');
    } else if (STATUSES.indexOf(s) < 0) {
      errors.push('字段 status（赛事状态）取值无效：「' + s + '」不在允许范围内，只能是 ' +
        STATUSES.join(' / ') + '。');
    } else {
      value.status = s;
    }
  }

  // ---- 比分：非负整数 ----
  ['homeScore', 'awayScore'].forEach(key => {
    if (value[key] === undefined) return;
    const raw = value[key];
    if (raw === null || raw === '') { value[key] = null; return; }   // 允许显式清空
    const n = Number(raw);
    if (!Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
      errors.push('字段 ' + key + '（' + FIELD_CN[key] + '）应为 ' +
        SCORE_MIN + '–' + SCORE_MAX + ' 的整数：当前收到「' + raw + '」。');
      return;
    }
    value[key] = n;
  });

  // ---- 文本字段：不能改成空串 ----
  ['homeTeam', 'awayTeam'].forEach(key => {
    if (value[key] === undefined) return;
    const s = str(key);
    if (!s) {
      errors.push('字段 ' + key + '（' + FIELD_CN[key] + '）不能为空，请填写队名。');
      return;
    }
    value[key] = s;
  });

  // round / venue / note 允许改成空字符串（表示「清掉这个说明」），只做长度护栏
  ['round', 'venue', 'note'].forEach(key => {
    if (value[key] === undefined) return;
    const s = str(key);
    if (s.length > 200) {
      errors.push('字段 ' + key + '（' + FIELD_CN[key] + '）过长：超过 200 字，请精简。');
      return;
    }
    value[key] = s;
  });

  // ---- 跨字段一致性：与 DB 的 matches_finished_need_score 约束对齐 ----
  // 这里先拦一道，是为了给出「人话」而不是数据库的 23514。
  // 校验的是「改完之后」的最终状态，所以要和数据库里已有的值合并后再看。
  if (errors.length === 0) {
    const finalStatus = (value.status !== undefined) ? value.status
      : (pre && pre.status);
    const finalHome = (value.homeScore !== undefined) ? value.homeScore
      : (pre ? pre.home_score : null);
    const finalAway = (value.awayScore !== undefined) ? value.awayScore
      : (pre ? pre.away_score : null);

    if (finalStatus === TERMINAL_STATUS &&
      (finalHome === null || finalHome === undefined ||
        finalAway === null || finalAway === undefined)) {
      errors.push('状态改成「已结束」时，主客队比分都必须有值。' +
        '请在同一次请求里一并提交 homeScore 与 awayScore（例如 {"status":"已结束","homeScore":112,"awayScore":108}）。');
    }
    if (finalStatus && finalStatus !== TERMINAL_STATUS && finalStatus !== '进行中' &&
      value.homeScore !== undefined && value.awayScore !== undefined &&
      value.homeScore === null && value.awayScore === null) {
      // 把未开赛的比分清空是合法操作，不拦（只是提示性质的一条，故不入 errors）
    }
  }

  return { errors: errors, ignored: ignored, value: value };
}

// ---------- 业务：PATCH /api/matches ----------

async function handlePatch(req, res) {
  const elapsed = kit.timer();

  const parsed = await kit.parseBody(req);
  if (parsed.error) {
    kit.log('matches.patch.reject', { reason: 'body 解析失败', detail: parsed.error, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', parsed.error);
  }
  const body = parsed.body;

  // ---- ① 校验 id 形态（不存在的 id 走下面 404，不是这里） ----
  const idCheck = kit.normalizeId(body.id);
  if (idCheck.error) {
    kit.log('matches.patch.reject', { reason: 'id 不合法', raw: body.id, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', idCheck.error);
  }
  const id = idCheck.id;

  // ---- ② 先按 id 查一次：拿到「改之前」的快照 ----
  // 目的有两个：一是确认这条真存在（不存在直接 404，不做无效写），
  // 二是跨字段校验（比分与状态的一致性）需要知道库里原值。
  const before = await repo.findById(id);
  if (!before) {
    kit.log('matches.patch.not_found', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该比赛记录（id=' + id + '）。');
  }

  // ---- ③ 字段校验 ----
  const v = validatePatchInput(body, before);
  if (v.errors.length) {
    kit.log('matches.patch.reject', { id: id, reason: '校验未通过', errors: v.errors, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', v.errors.join(' '));
  }

  // ---- ④ 落库：改完之后把最新整行取回来 ----
  const patchRow = repo.toPatchRow(v.value);
  patchRow.updated_at = new Date().toISOString();   // 改过就留痕（契约 2.4：比分更正须更新）

  const after = await repo.updateById(id, patchRow);
  if (!after) {
    // 查到了却又改不到：只可能是查询与改动之间被并发删掉了
    kit.log('matches.patch.gone', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该比赛记录（id=' + id + '），可能刚刚被删除。');
  }

  kit.log('matches.patch.ok', {
    id: id, changed: Object.keys(v.value).join(','), ms: elapsed()
  });

  // 返回「改之前 / 改之后」两组值 —— 前端要拿它画对比（今日截图要求）
  return kit.ok(res, {
    before: repo.toJSON(before),
    after: repo.toJSON(after),
    title: repo.toTitle(after),
    summary: repo.toSummary(after)
  }, {
    id: id,
    changed: Object.keys(v.value),
    ignored: v.ignored,
    message: '已修改 ' + Object.keys(v.value).length + ' 个字段' +
      (v.ignored.length ? '；忽略不可改字段：' + v.ignored.join('、') : ''),
    updatedAt: after.updated_at
  });
}

// ---------- 业务：DELETE /api/matches ----------

/**
 * 删除一条比赛记录。
 *
 * 为什么先查再删（而不是直接删、数命中行数）：
 *   直接删也能知道命中几行，但拿不到被删内容，**返回体里没法让用户确认
 *   「删掉的到底是哪一条」**。先查一次既多一句人话（404 说清 id），
 *   又能把被删的记录原样回给前端做留档（今日截图要「GET 返回里该条已消失」，
 *   有这条被删的原文对照才说得清）。
 *   代价是多一次查询 —— 对一天百来行的表完全不值得优化。
 *
 * ⚠️ 本接口只打标记，**不真删数据**（见文件头「软删除怎么体现」）：
 *    走 repo.softDeleteById（PATCH is_deleted = true），数据仍躺在 matches 表里；
 *    repo.findById 带 is_deleted = false 过滤，所以对上层来说它的表现和删掉一样
 *    （GET 404、再删 404、PATCH 404）—— 这就是「查询时跳过」那条要求的效果。
 *    想让一条记录真消失，只能走数据库 SQL（repo.deleteById 是那条维护通道）。
 */
async function handleDelete(req, res) {
  const elapsed = kit.timer();

  // DELETE 的 id 两种来源都认：
  //   ① 路径后缀（/api/matches/<id> → 网关剥前缀后 req.url = /<id>）
  //   ② 请求体 {"id":"..."}（body 优先，方便前端与 curl 用同一种写法）
  // 先试 body；body 为空则回落到路径后缀。
  let rawId = '';
  let from = '';

  const raw = await kit.readBody(req).catch(() => '');
  if (raw && raw.trim()) {
    try {
      const b = JSON.parse(raw);
      if (b && typeof b === 'object' && !Array.isArray(b) && b.id !== undefined) {
        rawId = b.id;
        from = 'body';
      }
    } catch (e) {
      kit.log('matches.delete.reject', { reason: 'body 不是合法 JSON', ms: elapsed() });
      return kit.fail(res, 400, 'BAD_REQUEST',
        '请求体不是合法 JSON，请检查格式（应为 {"id":"20260924-nba-01"}）。');
    }
  }

  if (!rawId) {
    // 回落：路径后缀
    const suffix = (req.url || '/').split('?')[0].replace(/^\/+/, '');
    const seg = suffix.split('/').filter(Boolean).pop() || '';
    if (seg && seg !== 'matches' && seg !== 'api') {
      rawId = decodeURIComponent(seg);
      from = 'path';
    }
  }

  const idCheck = kit.normalizeId(rawId);
  if (idCheck.error) {
    kit.log('matches.delete.reject', { reason: 'id 不合法', raw: rawId, from: from, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', idCheck.error);
  }
  const id = idCheck.id;

  // ---- ① 存在性校验：不存在 → 404 + 中文说明（清单要求 3） ----
  const before = await repo.findById(id);
  if (!before) {
    kit.log('matches.delete.not_found', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该比赛记录（id=' + id + '），无需删除。');
  }

  // ---- ② 软删除：只打 is_deleted 标记，数据不离开这张表 ----
  // 定位条件 = id 精确匹配 + is_deleted = false（写在 repository 里），命中 0 或 1 行。
  // 走的是 PATCH 而不是 DELETE 语句，所以底座那条「无 eq. 过滤就拒绝」的安全阀照样生效。
  const deleted = await repo.softDeleteById(id);
  if (!deleted) {
    kit.log('matches.delete.gone', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该比赛记录（id=' + id + '），可能刚刚被删除。');
  }

  // ---- ③ 删后自查一次：确认**查询侧**看不见它了（不靠「返回 200」当证据） ----
  // 这里验的是「查不到」，不是「行没了」—— 行仍在库里，只是被标记、被过滤掉了。
  const still = await repo.findById(id);
  kit.log('matches.delete.ok', {
    id: id, mode: 'soft', verifiedGone: !still, from: from, ms: elapsed()
  });

  return kit.ok(res, {
    deleted: repo.toJSON(deleted),
    verifiedGone: !still,
    mode: 'soft',            // 本次删除的方式：软删除（不是真删）
    recoverable: true,       // 数据仍在，可由服务端找回
    restoreHint: '服务端调用 repo.restoreById(id) 即可恢复该条（无对外接口）'
  }, {
    id: id,
    message: '已软删除该比赛记录：数据仍保留在库中（仅标记 is_deleted = true），查询已跳过它' +
      (!still ? '；复查确认已查不到。' : '；但复查仍能查到，请再试一次。'),
    deletedAt: new Date().toISOString()
  });
}

// ---------- 业务：GET /api/matches?id=xxx（改删验证用） ----------

async function handleGet(res, params) {
  const elapsed = kit.timer();

  const rawId = params.get('id');
  if (rawId) {
    const idCheck = kit.normalizeId(rawId);
    if (idCheck.error) {
      kit.log('matches.get.reject', { reason: 'id 不合法', raw: rawId, ms: elapsed() });
      return kit.fail(res, 400, 'BAD_REQUEST', idCheck.error);
    }
    const row = await repo.findById(idCheck.id);
    if (!row) {
      kit.log('matches.get.not_found', { id: idCheck.id, ms: elapsed() });
      // 这条 404 正是「DELETE 之后 GET 不再返回」的证据来源
      return kit.fail(res, 404, 'NOT_FOUND', '未找到该比赛记录（id=' + idCheck.id + '）。');
    }
    kit.log('matches.get.ok', { id: idCheck.id, ms: elapsed() });
    return kit.ok(res, repo.toJSON(row), { id: idCheck.id });
  }

  // 不带 id 的列表读：契约 §2.4 仍是占位，本日不实现列表，
  // 明确告知（而不是返回空数组让调用方误判为「没有数据」）。
  const limit = Math.min(Math.max(parseInt(params.get('limit') || '50', 10) || 50, 1), 200);
  const rows = await pg.selectRows(repo.TABLE, Object.assign({
    select: repo.COLUMNS,
    order: 'match_time.asc',
    limit: limit
  }, repo.NOT_DELETED));   // 列表同样跳过软删除的行
  kit.log('matches.list.ok', { count: rows.length, limit: limit, ms: elapsed() });
  return kit.ok(res, rows.map(repo.toJSON), {
    count: rows.length, limit: limit, updatedAt: new Date().toISOString(),
    note: '列表读接口按契约 §2.4 仍为占位，本日仅提供按 id 取单条；此处顺带返回列表便于核对整表。'
  });
}

// ---------- 路由 ----------
//
// 本函数只服务 /api/matches 一个路由（Day 18 结论：一个路由一个函数）。
// 网关是前缀匹配、剥掉路由前缀，剩余留给 req.url：
//   /api/matches        → "/"   ← 线上形态
//   /api/matches/<id>   → "/<id>"
//   /api/matches        → "/api/matches"（本地直连形态）
// 方法分流：GET/HEAD 读、PATCH 改、DELETE 删、其它 → 405。

const server = kit.createServer(async (req, res, u) => {
  if (req.method === 'PATCH') return handlePatch(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  return handleGet(res, u.searchParams);
}, { allowedMethods: ['GET', 'HEAD', 'PATCH', 'DELETE'] });

kit.start(server, 'matches', pg.connectionInfo());

process.on('uncaughtException', err => {
  kit.log('uncaught_exception', { message: err && err.message, stack: err && err.stack });
});
