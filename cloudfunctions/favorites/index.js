/**
 * ============================================================
 * favorites/index.js — 每日体坛速览 · 收藏接口云函数（Day 18 建，Day 19 分层重构）
 * ------------------------------------------------------------
 * 今日实现：
 *   POST /api/favorites  —— 收藏一条体坛资讯（写入 news_items）
 *   GET  /api/favorites  —— 读回收藏列表（读 news_items）
 *
 * 【Day 19 分层重构】本文件现在只做三件事：**接请求、调函数、返响应**。
 *   news_items 怎么查/怎么写、「行 → 接口字段」怎么映射、主键怎么生成，
 *   全搬到数据访问层了：
 *     - cloudfunctions/shared/pg.js                  —— 连接底座（怎么连库）
 *     - cloudfunctions/shared/newsItemsRepository.js —— 资讯表读写（怎么读写 news_items）
 *   保留在本文件的：
 *     - 路由/方法分支、入参校验（防错误输入）、状态码/错误码、响应包络、日志
 *   —— 这些都是「接口对外行为」，属于接口层；它们不碰数据库。
 *
 * 为什么单独一个云函数、不并进 api 函数（Day 18 实测结论，重要）：
 *   CloudBase 网关转发时会**剥掉路由前缀**，且**不把原始路径放进任何请求头**
 *   （实测请求头里只有 x-scf-* / x-cloudbase-* / forwarded 等，没有 original-path 一类字段）。
 *   结果：外部访问 /api/hot 与 /api/favorites，函数内收到的 req.url 都是 "/"，
 *   **无法区分**。两个路由挂同一个函数 → 必然互相串。
 *   解法：**一个路由一个函数**。/api/hot 归 api 函数，/api/favorites 归本函数，
 *   每个函数内部只有一个业务，路由判断退化成「是不是根路径」，不再有歧义。
 *
 * 数据链路：
 *   浏览器 → 网关 /api/favorites → 本云函数 → newsItemsRepository → pg.js
 *                                 → CloudBase PG 的 HTTP API（PostgREST）
 *
 * 【Day 22 配套改动：软删除之后的「复活」】
 *   news_items 自 Day 22 起支持软删除（删除只打 is_deleted 标记，查询跳过）。
 *   本接口是同一张表的另一条写入口，所以必须跟着想一步：
 *   被软删过的文章再次被收藏时，只回一句「已在收藏中」会让用户困惑
 *   ——「说有，可我把列表翻遍了也没看见它」。
 *   → 本层把命中的软删除行**复活**（见 resolveExisting 的注释）。
 *   这不是新功能，是软删除引入后必须补上的一致性。
 *
 * 安全（清单要求 3：SQL 必须参数化，禁止拼接）：
 *   本层不拼 SQL —— 读走 PostgREST 查询参数、写走 POST 的 JSON body
 *   （由平台侧编译成参数化 SQL）。表名/列名来自 repository 的白名单常量，
 *   用户输入只进入「值」的位置，且先过校验（枚举/格式/长度）。
 * ============================================================
 */

const newsRepo = require('../shared/newsItemsRepository');
const pg = require('../shared/pg');

const PORT = Number(process.env.PORT || 9000);

// ---------- 白名单（与 db/schema.sql 的 CHECK 约束一一对应） ----------
// 这些约束「什么算合法输入」，属于接口层的校验职责；
// 数据库列名与映射在 newsItemsRepository 里。
const SECTIONS = ['头条', '转会伤病', '热议', '明日看点'];
const STATUSES = ['draft', 'published'];
const TITLE_MAX = 30;
const SUMMARY_MAX = 60;

// ---------- 统一响应（契约 0.2） ----------

function sendJSON(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function ok(res, data, meta) {
  sendJSON(res, 200, { ok: true, data: data, meta: meta || {} });
}

function fail(res, statusCode, code, message) {
  sendJSON(res, statusCode, { ok: false, error: { code: code, message: message } });
}

// ---------- 服务端日志（Day 18 加练） ----------

/**
 * 统一日志：一行 JSON，云函数控制台按「[api]」过滤即可回溯。
 * 记什么：事件名 + 关键标识（id/url/表名）+ 耗时 + 结果；**不记 API Key**。
 */
function log(event, fields) {
  console.log('[api] ' + JSON.stringify(Object.assign({
    ts: new Date().toISOString(),
    event: event
  }, fields || {})));
}

function timer() {
  const t0 = Date.now();
  return () => Date.now() - t0;
}

// ---------- 入参校验（防错误输入） ----------

/**
 * 校验并归一化 POST body，返回 { errors, value }。
 * 设计要点：
 *   1. **收集全部错误再一次性返回** —— 用户一屏看到所有问题，不用「改一个报一个」。
 *   2. 错误信息全中文，明确说「缺了什么 / 错在哪、正确格式是什么」。
 *   3. 返回值只留白名单内字段，多余字段丢弃（防脏字段混进库）。
 */
function validateFavoriteInput(body) {
  const errors = [];
  const src = (body && typeof body === 'object') ? body : {};

  function str(key) {
    const v = src[key];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v.trim() : String(v).trim();
  }

  const title = str('title');
  const summary = str('summary');
  const section = str('section');
  const league = str('league');
  const sourceName = str('sourceName');
  const sourceUrl = str('sourceUrl');
  const digestDate = str('digestDate');
  const status = str('status') || 'published';   // 选填，默认 published

  // ---- 必填校验（逐个点名，中文） ----
  const REQUIRED = [
    ['title', title, '标题 title'],
    ['summary', summary, '摘要 summary'],
    ['section', section, '板块 section'],
    ['league', league, '联赛 league'],
    ['sourceName', sourceName, '来源名称 sourceName'],
    ['sourceUrl', sourceUrl, '原文链接 sourceUrl'],
    ['digestDate', digestDate, '归属日期 digestDate']
  ];
  const missing = REQUIRED.filter(x => !x[1]).map(x => x[2]);
  if (missing.length) {
    errors.push('缺少必填字段：' + missing.join('、') + '。请补齐后重新提交。');
  }

  // ---- 格式校验 ----
  // 归属日期：YYYY-MM-DD，且必须是真实存在的日期
  if (digestDate && !/^\d{4}-\d{2}-\d{2}$/.test(digestDate)) {
    errors.push('字段 digestDate 格式错误：应为 YYYY-MM-DD（例如 2026-10-06），当前收到「' + digestDate + '」。');
  } else if (digestDate) {
    // 注意：**不能用 toISOString() 回比** —— 它按 UTC 输出，东八区会把
    // 2026-10-06 本地零点变成 2026-10-05T16:00Z，误判成「日期不存在」。
    // 正确做法：直接用 UTC 构造再取 UTC 分量，纯做「这一天是否存在」的判定。
    const p = digestDate.split('-').map(Number);
    const y = p[0], m = p[1], d = p[2];
    const dt = new Date(Date.UTC(y, m - 1, d));
    const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d && y >= 1900 && y <= 2999;
    if (!valid) {
      errors.push('字段 digestDate 不是有效日期：「' + digestDate + '」这一天不存在，请检查月/日。');
    }
  }

  // 原文链接：必须 http(s) 开头
  if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) {
    errors.push('字段 sourceUrl 格式错误：应以 http:// 或 https:// 开头，当前收到「' + sourceUrl + '」。');
  }

  // 板块四选一
  if (section && SECTIONS.indexOf(section) < 0) {
    errors.push('字段 section 取值无效：「' + section + '」不在允许范围内，只能是 ' + SECTIONS.join(' / ') + '。');
  }

  // 状态二选一
  if (status && STATUSES.indexOf(status) < 0) {
    errors.push('字段 status 取值无效：「' + status + '」不在允许范围内，只能是 ' + STATUSES.join(' / ') + '。');
  }

  // 字数上限（与数据库 CHECK 一致，这里先拦可给更清楚的中文提示）
  if (title && title.length > TITLE_MAX) {
    errors.push('字段 title 超出 ' + TITLE_MAX + ' 字上限：当前 ' + title.length + ' 字，请精简标题。');
  }
  if (summary && summary.length > SUMMARY_MAX) {
    errors.push('字段 summary 超出 ' + SUMMARY_MAX + ' 字上限：当前 ' + summary.length + ' 字，请精简摘要。');
  }

  return {
    errors: errors,
    value: {
      title: title, summary: summary, section: section, league: league,
      sourceName: sourceName, sourceUrl: sourceUrl, digestDate: digestDate, status: status
    }
  };
}

// ---------- 软删除的配套：命中「已删除」的资讯时把它复活（Day 22 余力加练） ----------

/**
 * 按 sourceUrl 命中一行之后的统一处置。
 *
 * 为什么需要它（这是软删除带来的一个真实边角，不处理就会留下说不通的状态）：
 *   news_items 支持软删除后，「按 source_url 查得到」≠「用户看得见」——
 *   列表与按 id 查询都跳过已删除的行。如果 POST /api/favorites 只回一句
 *   「这篇文章已在收藏中」，用户会陷入矛盾：说有，可列表里翻不到。
 *   所以命中的行若是软删除态，就把它**复活**（is_deleted 改回 false），
 *   语义变成「它回来了」——这也正好呼应软删除的初衷：删错了能回来。
 *
 * 并发上的小坑：查出来是删除态、真去恢复时它可能已经被别人恢复了（或又被删了），
 *   restoreById 命中 0 行会返回 null —— 此时**不报错**，按普通「已存在」处理。
 *   收藏是幂等操作，没必要为这种竞态给用户一个红色提示。
 *
 * @returns {Promise<{row: object, restored: boolean}>}
 */
async function resolveExisting(row, sourceUrl) {
  if (row.is_deleted) {
    const revived = await newsRepo.restoreById(row.id);
    if (revived) return { row: revived, restored: true };
    log('favorites.create.revive_miss', { sourceUrl: sourceUrl, id: row.id });
  }
  return { row: row, restored: false };
}

// ---------- 业务：POST /api/favorites ----------

async function handleCreateFavorite(req, res) {
  const elapsed = timer();

  let raw = '';
  try {
    raw = await readBody(req);
  } catch (e) {
    log('favorites.create.reject', { reason: '读取请求体失败', detail: e.message, ms: elapsed() });
    return fail(res, 400, 'BAD_REQUEST', '无法读取请求体：' + e.message);
  }

  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    log('favorites.create.reject', { reason: 'JSON 解析失败', ms: elapsed() });
    return fail(res, 400, 'BAD_REQUEST', '请求体不是合法 JSON，请检查格式（应为 {"title":"...", ...}）。');
  }

  // ---- 校验（防错误输入） ----
  const v = validateFavoriteInput(body);
  if (v.errors.length) {
    log('favorites.create.reject', { reason: '校验未通过', errors: v.errors, ms: elapsed() });
    return fail(res, 400, 'BAD_REQUEST', v.errors.join(' '));
  }
  const input = v.value;

  // ---- 防重复（今日掌握项②）：先查后写 + 唯一索引兜底 ----
  //
  // 第一道：查同 sourceUrl 是否已存在。
  //   存在 → 不报错，把已有那条返回（收藏是幂等操作，用户重复点不该看到红色报错，
  //   而应看到「已收藏」）。meta.created=false 供前端区分。
  //   「怎么按 source_url 查一条」由 repository 负责。
  const existing = await newsRepo.findBySourceUrl(input.sourceUrl);
  if (existing) {
    // 命中的是软删除行 → 先复活（理由见 resolveExisting 的注释）
    const resolved = await resolveExisting(existing, input.sourceUrl);
    log('favorites.create.duplicate', {
      sourceUrl: input.sourceUrl, existingId: resolved.row.id,
      restored: resolved.restored, ms: elapsed()
    });
    return ok(res, newsRepo.toJSON(resolved.row), {
      created: false,
      restored: resolved.restored,
      message: resolved.restored
        ? '这条资讯之前被删除过（软删除），本次收藏已把它恢复显示'
        : '这篇文章已在收藏中'
    });
  }

  // ---- 生成 id（当天第 N 条）----
  // 「数当天条数」「拼主键」都由 repository 负责。
  let sameDayCount = 0;
  try {
    sameDayCount = await newsRepo.countByDigestDate(input.digestDate);
  } catch (e) {
    // 统计失败不阻塞写入：序号从 1 起可能撞主键，但会由唯一约束挡下（不会写脏）
    log('favorites.create.warn', { reason: '统计当天条数失败，序号从 1 起', detail: e.message });
  }
  const id = newsRepo.makeId(input.digestDate, sameDayCount);

  // ---- 组装要写的行（键为数据库列名；由 repository 做字段映射）----
  const row = newsRepo.toDbRow(input);
  row.id = id;

  try {
    const written = await newsRepo.insert(row);
    log('favorites.create.ok', {
      id: written.id, title: written.title, section: written.section,
      digestDate: written.digest_date, ms: elapsed()
    });
    return sendJSON(res, 200, {
      ok: true,
      data: newsRepo.toJSON(written),
      meta: { created: true, message: '收藏成功' }
    });
  } catch (err) {
    // ---- 第二道防线：唯一索引挡住并发重复（PG 错误码 23505）----
    const isDup = err.dbStatus === 409 ||
      /23505/.test(String(err.dbBody || '')) ||
      /duplicate key/i.test(String(err.dbBody || err.message || ''));

    if (isDup) {
      const again = await newsRepo.findBySourceUrl(input.sourceUrl);
      log('favorites.create.conflict', {
        sourceUrl: input.sourceUrl, found: !!again, ms: elapsed()
      });
      if (again) {
        const resolved = await resolveExisting(again, input.sourceUrl);
        return ok(res, newsRepo.toJSON(resolved.row), {
          created: false,
          restored: resolved.restored,
          message: resolved.restored
            ? '这条资讯之前被删除过（软删除），本次提交已把它恢复显示'
            : '这篇文章已在收藏中（并发重复提交）'
        });
      }
      return fail(res, 409, 'CONFLICT', '该文章已存在或被同时提交，请刷新后查看收藏列表。');
    }
    throw err;
  }
}

// ---------- 业务：GET /api/favorites ----------

async function handleListFavorites(res, params) {
  const elapsed = timer();

  let limit = parseInt(params.get('limit') || '20', 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 50) limit = 50;

  let offset = parseInt(params.get('offset') || '0', 10);
  if (isNaN(offset) || offset < 0) offset = 0;

  // 「怎么按创建时间倒序翻页」由 repository 负责。
  const rows = await newsRepo.listRecent(limit, offset);

  log('favorites.list.ok', { limit: limit, offset: offset, count: rows.length, ms: elapsed() });

  ok(res, rows.map(newsRepo.toJSON), {
    count: rows.length, limit: limit, offset: offset, updatedAt: new Date().toISOString()
  });
}

// ---------- 读请求体（带体积上限） ----------

function readBody(req, maxBytes) {
  const LIMIT = maxBytes || 64 * 1024;   // 64KB 足够，防大包打爆
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > LIMIT) {
        reject(new Error('请求体超过 ' + Math.round(LIMIT / 1024) + 'KB 上限'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- 路由 ----------
//
// 本函数只服务 /api/favorites 一个路由，网关剥前缀后 req.url 恒为 "/"，
// 因此这里不需要（也无法）按路径判别，只看方法即可。

const server = http_createServer();

function http_createServer() {
  const http = require('node:http');
  return http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://localhost');
    const path = u.pathname;
    const started = Date.now();

    try {
      // ---- POST /api/favorites ----
      if (req.method === 'POST') {
        return await handleCreateFavorite(req, res);
      }

      // ---- GET /api/favorites ----
      if (req.method === 'GET' || req.method === 'HEAD') {
        return await handleListFavorites(res, u.searchParams);
      }

      // ---- 其它方法 ----
      log('method_not_allowed', { method: req.method, path: path });
      return fail(res, 405, 'METHOD_NOT_ALLOWED', '该接口支持 GET 与 POST（收到 ' + req.method + '）');
    } catch (err) {
      log('error', {
        method: req.method, path: path, message: err && err.message,
        dbStatus: err && err.dbStatus, ms: Date.now() - started
      });
      return fail(res, 500, 'INTERNAL_ERROR',
        '服务端开小差了，请稍后重试。' + (err && err.message ? '（' + err.message + '）' : ''));
    }
  });
}

server.listen(PORT, () => {
  const conn = pg.connectionInfo();
  console.log('[每日体坛速览] favorites 云函数已启动，监听端口 ' + PORT +
    '（env=' + conn.envId + '，API Key ' + (conn.apiKey === 'injected' ? '已注入' : '缺失！') + '）');
  log('boot', { port: PORT, env: conn.envId, apiKey: conn.apiKey });
});

process.on('uncaughtException', err => {
  log('uncaught_exception', { message: err && err.message, stack: err && err.stack });
});
