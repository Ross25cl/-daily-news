/**
 * ============================================================
 * news/index.js — 每日体坛速览 · 资讯写接口云函数（Day 22 建）
 * ------------------------------------------------------------
 * 今日实现（第 4 周板块① ②，覆盖任务清单点名的「新闻标题 / 内容摘要 / 备注」）：
 *   PATCH  /api/news  —— 改一条资讯（标题 / 摘要 / 备注 / 发布状态）
 *   DELETE /api/news  —— 删一条资讯（**软删除**：只打 is_deleted 标记，数据留在库里）
 *   GET    /api/news?id=xxx  —— 按 id 取一条（改删验证用；列表读接口按契约 §2.2 仍占位）
 *
 * 【为什么单独开一个函数，而不是并进 favorites】
 *   Day 18 的结论是「**一个路由一个云函数**」——网关只把请求转给前缀匹配上的
 *   那个函数，没登记路由的路径在网关层就 404。
 *   本接口的路径是 /api/news（契约 §1 早已登记为读接口的路径），
 *   与 /api/favorites（收藏线）是**两条不同的路径** → 必须各自登记路由。
 *   至于 /api/news 自己路径下的 GET / PATCH / DELETE 三个方法，
 *   按契约 §2.9 的结论「同路径不同方法可以同函数」，就在本文件里靠 req.method 分流。
 *
 * 【分层】与 matches 函数同款：本文件只接请求 / 调函数 / 返响应；
 *   表读写看 shared/newsItemsRepository.js，响应与校验零件看 shared/httpKit.js。
 *
 * 【删除的确认做在哪（今日掌握项）】
 *   ① 底座层 pg.deleteRows / updateRows 拒绝无 eq. 过滤的写；
 *   ② 接口层先 findById 确认存在，不存在直接 404，绝不做无效删除；
 *   ③ 删除后**再查一次**确认查询侧真的看不见它了，把结果写进 data.verifiedGone
 *      —— 不靠「返回 200」当证据（注意验的是「查不到」，不是「行没了」）；
 *   ④ 前端检查台给二次确认弹窗；
 *   ⑤ 存储层是**软删除**（Day 22 余力加练）：只把 is_deleted 置 true，数据留在表里。
 *      前四道闸防的是「别删错」，这一道管的是「删错了还能回来」（restoreById）。
 *
 * 数据链路：
 *   浏览器 → 网关 /api/news → 本云函数 → newsItemsRepository → 底座 pg.js
 *                                     → CloudBase PG 的 HTTP API（PostgREST）
 *
 * 安全：走 PostgREST 查询参数 + PATCH 的 JSON body，由平台侧编译成参数化 SQL，
 *   本层不拼 SQL。表名/列名来自 repository 白名单常量，用户输入先过校验。
 * ============================================================
 */

const newsRepo = require('../shared/newsItemsRepository');
const pg = require('../shared/pg');
const kit = require('../shared/httpKit');

// ---------- 白名单（与 db/schema.sql 的 CHECK 约束一一对应） ----------

const SECTIONS = ['头条', '转会伤病', '热议', '明日看点'];
const STATUSES = ['draft', 'published'];
const TITLE_MAX = 30;
const SUMMARY_MAX = 60;

// PATCH 允许改的字段（＝repository 白名单）
const PATCHABLE = newsRepo.PATCHABLE;

const FIELD_CN = {
  title: '新闻标题',
  summary: '内容摘要',
  note: '备注',
  status: '发布状态'
};

// ---------- 入参校验 ----------

function validatePatchInput(body) {
  const errors = [];
  const ignored = [];
  const value = {};

  Object.keys(body).forEach(k => {
    if (k === 'id') return;
    // 特殊拦截「快照字段」：news_items 的标题/摘要长度有 DB CHECK 上限，
    // 这里给出人话提示，比让数据库回 23514 友好。
    if (['digestDate', 'sourceUrl', 'sourceName', 'section', 'seeAt'].indexOf(k) >= 0) return;
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

  // ---- 标题：非空，≤30 字 ----
  if (value.title !== undefined) {
    const t = str('title');
    if (!t) {
      errors.push('字段 title（新闻标题）不能为空。');
    } else if (t.length > TITLE_MAX) {
      errors.push('字段 title（新闻标题）超出 ' + TITLE_MAX +
        ' 字上限：当前 ' + t.length + ' 字，请精简标题。');
    } else {
      value.title = t;
    }
  }

  // ---- 摘要：非空，≤60 字 ----
  if (value.summary !== undefined) {
    const s = str('summary');
    if (!s) {
      errors.push('字段 summary（内容摘要）不能为空。');
    } else if (s.length > SUMMARY_MAX) {
      errors.push('字段 summary（内容摘要）超出 ' + SUMMARY_MAX +
        ' 字上限：当前 ' + s.length + ' 字，请精简摘要。');
    } else {
      value.summary = s;
    }
  }

  // ---- 备注：允许清空，只做长度护栏 ----
  if (value.note !== undefined) {
    const n = str('note');
    if (n.length > 200) {
      errors.push('字段 note（备注）过长：超过 200 字，请精简。');
    } else {
      value.note = n;
    }
  }

  // ---- 发布状态：二选一 ----
  if (value.status !== undefined) {
    const s = str('status');
    if (STATUSES.indexOf(s) < 0) {
      errors.push('字段 status（发布状态）取值无效：「' + s + '」不在允许范围内，只能是 ' +
        STATUSES.join(' / ') + '。');
    } else {
      value.status = s;
    }
  }

  return { errors: errors, ignored: ignored, value: value };
}

// ---------- 业务：PATCH /api/news ----------

async function handlePatch(req, res) {
  const elapsed = kit.timer();

  const parsed = await kit.parseBody(req);
  if (parsed.error) {
    kit.log('news.patch.reject', { reason: 'body 解析失败', detail: parsed.error, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', parsed.error);
  }
  const body = parsed.body;

  const idCheck = kit.normalizeId(body.id);
  if (idCheck.error) {
    kit.log('news.patch.reject', { reason: 'id 不合法', raw: body.id, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', idCheck.error);
  }
  const id = idCheck.id;

  // ---- 存在性校验：不存在 → 404 + 中文说明（清单要求 3） ----
  const before = await newsRepo.findById(id);
  if (!before) {
    kit.log('news.patch.not_found', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该体坛速览记录（id=' + id + '）。');
  }

  const v = validatePatchInput(body);
  if (v.errors.length) {
    kit.log('news.patch.reject', { id: id, reason: '校验未通过', errors: v.errors, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', v.errors.join(' '));
  }

  const patchRow = newsRepo.toPatchRow(v.value);
  const after = await newsRepo.updateById(id, patchRow);
  if (!after) {
    kit.log('news.patch.gone', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该体坛速览记录（id=' + id + '），可能刚刚被删除。');
  }

  kit.log('news.patch.ok', { id: id, changed: Object.keys(v.value).join(','), ms: elapsed() });

  // before / after 两组值 —— 今日截图要「改之前与之后的值对比」
  return kit.ok(res, {
    before: newsRepo.toJSON(before),
    after: newsRepo.toJSON(after)
  }, {
    id: id,
    changed: Object.keys(v.value),
    ignored: v.ignored,
    message: '已修改 ' + Object.keys(v.value).length + ' 个字段' +
      (v.ignored.length ? '；忽略不可改字段：' + v.ignored.join('、') : '')
  });
}

// ---------- 业务：DELETE /api/news ----------

async function handleDelete(req, res) {
  const elapsed = kit.timer();

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
      kit.log('news.delete.reject', { reason: 'body 不是合法 JSON', ms: elapsed() });
      return kit.fail(res, 400, 'BAD_REQUEST',
        '请求体不是合法 JSON，请检查格式（应为 {"id":"20260929-n01"}）。');
    }
  }

  if (!rawId) {
    const suffix = (req.url || '/').split('?')[0].replace(/^\/+/, '');
    const seg = suffix.split('/').filter(Boolean).pop() || '';
    if (seg && seg !== 'news' && seg !== 'api') {
      rawId = decodeURIComponent(seg);
      from = 'path';
    }
  }

  const idCheck = kit.normalizeId(rawId);
  if (idCheck.error) {
    kit.log('news.delete.reject', { reason: 'id 不合法', raw: rawId, from: from, ms: elapsed() });
    return kit.fail(res, 400, 'BAD_REQUEST', idCheck.error);
  }
  const id = idCheck.id;

  // ---- ① 存在性校验 ----
  const before = await newsRepo.findById(id);
  if (!before) {
    kit.log('news.delete.not_found', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该体坛速览记录（id=' + id + '），无需删除。');
  }

  // ---- ② 软删除：只打 is_deleted 标记，行留在表里（Day 22 余力加练） ----
  // 条件 = id 精确匹配 + is_deleted = false（写在 repository 里）；
  // 走 PATCH 而非 DELETE 语句，所以底座「无 eq. 过滤就拒绝」的安全阀依旧生效。
  const deleted = await newsRepo.softDeleteById(id);
  if (!deleted) {
    kit.log('news.delete.gone', { id: id, ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '未找到该体坛速览记录（id=' + id + '），可能刚刚被删除。');
  }

  // ---- ③ 删后自查：确认查询侧真的看不见它了 ----
  const still = await newsRepo.findById(id);
  kit.log('news.delete.ok', { id: id, mode: 'soft', verifiedGone: !still, from: from, ms: elapsed() });

  return kit.ok(res, {
    deleted: newsRepo.toJSON(deleted),
    verifiedGone: !still,
    mode: 'soft',            // 本次删除的方式：软删除（不是真删）
    recoverable: true,       // 数据仍在，可由服务端找回
    restoreHint: '服务端调用 newsRepo.restoreById(id) 可恢复；收藏线重新收藏同一 sourceUrl 也会复活它'
  }, {
    id: id,
    message: '已软删除该体坛速览记录：数据仍保留在库中（仅标记 is_deleted = true），列表与查询都已跳过它' +
      (!still ? '；复查确认已查不到。' : '；但复查仍能查到，请再试一次。'),
    deletedAt: new Date().toISOString()
  });
}

// ---------- 业务：GET /api/news?id=xxx ----------

async function handleGet(res, params) {
  const elapsed = kit.timer();

  const rawId = params.get('id');
  if (rawId) {
    const idCheck = kit.normalizeId(rawId);
    if (idCheck.error) {
      kit.log('news.get.reject', { reason: 'id 不合法', raw: rawId, ms: elapsed() });
      return kit.fail(res, 400, 'BAD_REQUEST', idCheck.error);
    }
    const row = await newsRepo.findById(idCheck.id);
    if (!row) {
      kit.log('news.get.not_found', { id: idCheck.id, ms: elapsed() });
      // ★ 这条 404 就是「DELETE 之后 GET 不再返回」的直接证据
      return kit.fail(res, 404, 'NOT_FOUND', '未找到该体坛速览记录（id=' + idCheck.id + '）。');
    }
    kit.log('news.get.ok', { id: idCheck.id, ms: elapsed() });
    return kit.ok(res, newsRepo.toJSON(row), { id: idCheck.id });
  }

  const limit = Math.min(Math.max(parseInt(params.get('limit') || '50', 10) || 50, 1), 200);
  const rows = await pg.selectRows(newsRepo.TABLE, Object.assign({
    select: newsRepo.COLUMNS,
    order: 'created_at.desc',
    limit: limit
  }, newsRepo.NOT_DELETED));   // 列表同样跳过软删除的行
  kit.log('news.list.ok', { count: rows.length, limit: limit, ms: elapsed() });
  return kit.ok(res, rows.map(newsRepo.toJSON), {
    count: rows.length, limit: limit, updatedAt: new Date().toISOString(),
    note: '列表读接口按契约 §2.2 仍为占位，本日仅提供按 id 取单条；此处顺带返回列表便于核对整表。'
  });
}

// ---------- 路由 ----------

const server = kit.createServer(async (req, res, u) => {
  if (req.method === 'PATCH') return handlePatch(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  return handleGet(res, u.searchParams);
}, { allowedMethods: ['GET', 'HEAD', 'PATCH', 'DELETE'] });

kit.start(server, 'news', pg.connectionInfo());

process.on('uncaughtException', err => {
  kit.log('uncaught_exception', { message: err && err.message, stack: err && err.stack });
});
