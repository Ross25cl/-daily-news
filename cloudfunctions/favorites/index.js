/**
 * ============================================================
 * favorites/index.js — 每日体坛速览 · 收藏接口云函数（Day 18 建）
 * ------------------------------------------------------------
 * 今日实现：
 *   POST /api/favorites  —— 收藏一条体坛资讯（写入 news_items）
 *   GET  /api/favorites  —— 读回收藏列表（读 news_items）
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
 *   浏览器 → 网关 /api/favorites → 本云函数 → CloudBase PG 的 HTTP API（PostgREST）
 *
 * 为什么走 HTTP API 而不是 pg 驱动：
 *   CloudBase 体验版（个人版）不支持数据库 TCP 直连；且 HTTP 云函数不能云端装依赖。
 *   → 零依赖，只用 Node 原生 https。
 *
 * 安全（清单要求 3：SQL 必须参数化，禁止拼接）：
 *   本层不拼 SQL —— 读走 PostgREST 查询参数、写走 POST 的 JSON body
 *   （由平台侧编译成参数化 SQL）。表名/列名来自白名单常量，
 *   用户输入只进入「值」的位置，且先过校验（枚举/格式/长度）。
 * ============================================================
 */

const https = require('node:https');

const PORT = Number(process.env.PORT || 9000);
const ENV_ID = process.env.CB_ENV_ID || 'ross-d2gimwy406e0d6812';
const API_KEY = process.env.CB_API_KEY || '';
const REST_HOST = ENV_ID + '.api.tcloudbasegateway.com';
const REST_BASE = '/v1/rdb/rest';

// ---------- 收藏线：写入/读取 news_items ----------
//
// 零拍板（Day 18）：收藏 = 把一篇文章存进已有的核心表 news_items，不另建表；
// 防重复按 source_url 唯一（数据库已建唯一索引 news_items_source_url_uniq）。
//
// 契约 0.1：数据库列 snake_case、接口输出 camelCase，映射在这层做。
const FAVORITES_TABLE = 'news_items';

// 接口字段（camelCase） → 数据库列（snake_case）——**唯一映射来源**
const FAV_TO_DB = {
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
const DB_TO_FAV = Object.keys(FAV_TO_DB).reduce((acc, k) => {
  acc[FAV_TO_DB[k]] = k;
  return acc;
}, {});

// 白名单（与 db/schema.sql 的 CHECK 约束一一对应）
const SECTIONS = ['头条', '转会伤病', '热议', '明日看点'];
const STATUSES = ['draft', 'published'];
const TITLE_MAX = 30;
const SUMMARY_MAX = 60;

const FAV_COLUMNS = Object.keys(FAV_TO_DB).map(k => FAV_TO_DB[k]).join(',');

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
 * 为什么：排查「谁在什么时候写了什么、为什么失败」，四个要素缺一不可；
 * 单行 JSON 在日志检索里可按字段过滤，比多行散文本好用。
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

// ---------- PostgREST 访问 ----------

function queryTable(table, query) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error('服务端未配置 API Key（环境变量 CB_API_KEY 缺失）'));
    }
    const qs = Object.keys(query)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
      .join('&');
    const path = REST_BASE + '/' + table + (qs ? '?' + qs : '');

    const req = https.request({
      host: REST_HOST, path: path, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + API_KEY, 'Accept': 'application/json' },
      timeout: 8000
    }, resp => {
      let raw = '';
      resp.setEncoding('utf8');
      resp.on('data', c => { raw += c; });
      resp.on('end', () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          const err = new Error('数据库返回 HTTP ' + resp.statusCode + '：' + raw.slice(0, 300));
          err.dbStatus = resp.statusCode;
          err.dbBody = raw;
          return reject(err);
        }
        try {
          const rows = JSON.parse(raw);
          resolve(Array.isArray(rows) ? rows : []);
        } catch (e) {
          reject(new Error('数据库返回的不是合法 JSON：' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('查询数据库超时（8 秒）')); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 向一张表插入一行（PostgREST POST）。
 * 带 `Prefer: return=representation`，让接口回传真正写进库的那一行
 * ——「写进去的到底是什么」必须由数据库说了算，不由我们猜。
 */
function insertRow(table, row) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error('服务端未配置 API Key（环境变量 CB_API_KEY 缺失）'));
    }
    const payload = JSON.stringify(row);

    const req = https.request({
      host: REST_HOST, path: REST_BASE + '/' + table, method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        // return=representation：写入后回传整行。
        // 不开 resolution=merge-duplicates —— 我们要的就是「撞唯一键就报错」（接口转成「已存在」）。
        'Prefer': 'return=representation',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 8000
    }, resp => {
      let raw = '';
      resp.setEncoding('utf8');
      resp.on('data', c => { raw += c; });
      resp.on('end', () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          const err = new Error('数据库写入失败 HTTP ' + resp.statusCode + '：' + raw.slice(0, 300));
          err.dbStatus = resp.statusCode;
          err.dbBody = raw;
          return reject(err);
        }
        try {
          const rows = JSON.parse(raw);
          resolve(Array.isArray(rows) ? rows[0] : rows);
        } catch (e) {
          reject(new Error('数据库返回的不是合法 JSON：' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('写入数据库超时（8 秒）')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------- 入参校验（今日掌握项①：防错误输入） ----------

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

/**
 * 生成业务主键：契约 2.2 规则 `YYYYMMDD-n01`。
 * 当天第 N 条 = 已有同日期条目数 + 1（两位序号）。
 * 同一毫秒并发可能撞号，但撞了会被主键挡下（返回数据库错误），不会写脏数据
 * —— 宁可失败也不覆盖别人。
 */
function makeId(digestDate, existingCount) {
  return digestDate.replace(/-/g, '') + '-n' + String(existingCount + 1).padStart(2, '0');
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
  const dupRows = await queryTable(FAVORITES_TABLE, {
    select: FAV_COLUMNS, source_url: 'eq.' + input.sourceUrl, limit: 1
  });
  if (dupRows.length) {
    log('favorites.create.duplicate', {
      sourceUrl: input.sourceUrl, existingId: dupRows[0].id, ms: elapsed()
    });
    return ok(res, toFavoriteJSON(dupRows[0]), { created: false, message: '这篇文章已在收藏中' });
  }

  // ---- 生成 id（当天第 N 条）----
  let sameDayCount = 0;
  try {
    const sameDay = await queryTable(FAVORITES_TABLE, {
      select: 'id', digest_date: 'eq.' + input.digestDate
    });
    sameDayCount = sameDay.length;
  } catch (e) {
    // 统计失败不阻塞写入：序号从 1 起可能撞主键，但会由唯一约束挡下（不会写脏）
    log('favorites.create.warn', { reason: '统计当天条数失败，序号从 1 起', detail: e.message });
  }
  const id = makeId(input.digestDate, sameDayCount);

  // ---- 写库（键为数据库列名）----
  const row = {};
  Object.keys(FAV_TO_DB).forEach(k => {
    if (k === 'id' || k === 'createdAt') return;   // id 自造、created_at 交给数据库默认 now()
    row[FAV_TO_DB[k]] = input[k];
  });
  row.id = id;

  try {
    const written = await insertRow(FAVORITES_TABLE, row);
    log('favorites.create.ok', {
      id: written.id, title: written.title, section: written.section,
      digestDate: written.digest_date, ms: elapsed()
    });
    return sendJSON(res, 200, {
      ok: true,
      data: toFavoriteJSON(written),
      meta: { created: true, message: '收藏成功' }
    });
  } catch (err) {
    // ---- 第二道防线：唯一索引挡住并发重复（PG 错误码 23505）----
    const isDup = err.dbStatus === 409 ||
      /23505/.test(String(err.dbBody || '')) ||
      /duplicate key/i.test(String(err.dbBody || err.message || ''));

    if (isDup) {
      const again = await queryTable(FAVORITES_TABLE, {
        select: FAV_COLUMNS, source_url: 'eq.' + input.sourceUrl, limit: 1
      });
      log('favorites.create.conflict', {
        sourceUrl: input.sourceUrl, found: again.length > 0, ms: elapsed()
      });
      if (again.length) {
        return ok(res, toFavoriteJSON(again[0]), {
          created: false, message: '这篇文章已在收藏中（并发重复提交）'
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

  const rows = await queryTable(FAVORITES_TABLE, {
    select: FAV_COLUMNS, order: 'created_at.desc', limit: limit, offset: offset
  });

  log('favorites.list.ok', { limit: limit, offset: offset, count: rows.length, ms: elapsed() });

  ok(res, rows.map(toFavoriteJSON), {
    count: rows.length, limit: limit, offset: offset, updatedAt: new Date().toISOString()
  });
}

// ---------- 行 → 接口 JSON（snake_case → camelCase） ----------

function toFavoriteJSON(row) {
  const out = {};
  Object.keys(DB_TO_FAV).forEach(col => {
    if (row[col] === undefined) return;
    out[DB_TO_FAV[col]] = row[col];
  });
  return out;
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
  console.log('[每日体坛速览] favorites 云函数已启动，监听端口 ' + PORT +
    '（env=' + ENV_ID + '，API Key ' + (API_KEY ? '已注入' : '缺失！') + '）');
  log('boot', { port: PORT, env: ENV_ID, apiKey: API_KEY ? 'injected' : 'missing' });
});

process.on('uncaughtException', err => {
  log('uncaught_exception', { message: err && err.message, stack: err && err.stack });
});
