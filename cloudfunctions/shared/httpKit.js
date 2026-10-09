/**
 * ============================================================
 * shared/httpKit.js — 数据访问层无关的「接口层公共零件」（Day 22 建）
 * ------------------------------------------------------------
 * 为什么要有这个文件：
 *   Day 22 一天里同时出现 PATCH 与 DELETE 两个写接口，涉及 **3 个云函数**
 *   （matches / news / favorites）。响应包络、日志、读 body、id 校验这几段
 *   代码如果每个函数各写一份，就会出现三份「看起来一样」的实现 ——
 *   迟早有一份改漏。按 Day 19 定下的分层原则（一处知识只留一份），
 *   把它们收到这里。
 *
 * 注意分层归属：本文件属于**接口层的零件**（HTTP 语义），不是数据访问层。
 *   放在 shared/ 只是因为「多个函数共用」，不代表它懂数据库 —— 它一行库都不碰。
 *
 * 它提供：
 *   sendJSON / ok / fail —— 契约 0.2 的统一响应包络
 *   log / timer          —— 单行 JSON 日志（[api] 前缀）
 *   readBody             —— 读请求体，带体积上限
 *   normalizeId          —— 校验外部传进来的 id（中文错误说明）
 *   parseBody            —— 读 + 解析 JSON，失败给中文说明
 *   createServer         —— 生成 http 服务（统一错误兜底 + 405）
 *   start                —— 监听 9000 端口 + 启动日志
 * ============================================================
 */

const http = require('node:http');

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

// ---------- 服务端日志 ----------
//
// 统一日志：一行 JSON，云函数控制台按「[api]」过滤即可回溯。
// 记什么：事件名 + 关键标识（id/表名）+ 耗时 + 结果；**不记 API Key**。

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

/**
 * 读 + 解析 JSON body。
 * @returns {Promise<{error: string|null, body: object}>} error 非空时是中文说明
 */
async function parseBody(req) {
  let raw = '';
  try {
    raw = await readBody(req);
  } catch (e) {
    return { error: '无法读取请求体：' + e.message, body: null };
  }
  if (!raw || !raw.trim()) {
    return { error: '请求体是空的。请提交 JSON，例如 {"id":"20260924-nba-01","status":"已结束"}。', body: null };
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { error: '请求体应为 JSON 对象（不是数组或其它类型）。', body: null };
    }
    return { error: null, body: body };
  } catch (e) {
    return { error: '请求体不是合法 JSON，请检查格式（应为 {"id":"...", ...}）。', body: null };
  }
}

// ---------- 校验外部传进来的 id ----------
//
// 清单要求 3：id 不存在要返回明确的中文说明，不能崩、不能裸 500。
// 这里负责「格式与取值」这层，**不负责「存不存在」**（那要查库，
// 由各接口的 handle 判断 → 404）。
//
// 只允许契约 2.2 的形态：字母数字加连字符（`20260924-nba-01`、`20260929-n01`）。
// 这条白名单同时也是防注入的一道边 —— id 会进 PostgREST 的查询值位置。

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

function normalizeId(raw) {
  const v = (raw === undefined || raw === null) ? '' : String(raw).trim();
  if (!v) {
    return { error: '缺少参数 id：请指明要操作哪一条记录（例如 "20260924-nba-01"）。', id: '' };
  }
  if (!ID_PATTERN.test(v)) {
    return {
      error: '参数 id 格式不合法：「' + v + '」。' +
        'id 应形如 20260924-nba-01 或 20260929-n01（字母、数字、短横线，长度 3–64）。',
      id: ''
    };
  }
  return { error: null, id: v };
}

// ---------- 服务与启动 ----------
//
// 统一错误兜底：任何未捕获异常都落成 500 + 中文说明，
// 绝不让客户端看到一个裸堆栈。

function createServer(handler, opts) {
  const options = opts || {};
  const allowedMethods = options.allowedMethods || ['GET', 'HEAD'];

  return http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://localhost');
    const started = Date.now();

    // 预检交给网关处理（网关自动回 CORS 头），这里只回一个干净的空响应，
    // 免得 OPTIONS 走到业务分支被判成 405。
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Content-Length': 0 });
      return res.end();
    }

    if (allowedMethods.indexOf(req.method) < 0) {
      log('method_not_allowed', { method: req.method, path: u.pathname });
      return fail(res, 405, 'METHOD_NOT_ALLOWED',
        '该接口支持 ' + allowedMethods.join(' 与 ') + '（收到 ' + req.method + '）');
    }

    try {
      return await handler(req, res, u);
    } catch (err) {
      log('error', {
        method: req.method, path: u.pathname,
        message: err && err.message, dbStatus: err && err.dbStatus,
        ms: Date.now() - started
      });
      return fail(res, 500, 'INTERNAL_ERROR',
        '服务端开小差了，请稍后重试。' + (err && err.message ? '（' + err.message + '）' : ''));
    }
  });
}

/**
 * 监听并打启动日志（云函数固定 9000 端口；本地测试可用 PORT 覆盖）。
 */
function start(server, fnName, pgConnectionInfo) {
  const PORT = Number(process.env.PORT || 9000);
  server.listen(PORT, () => {
    const conn = pgConnectionInfo || {};
    console.log('[每日体坛速览] ' + fnName + ' 云函数已启动，监听端口 ' + PORT +
      '（env=' + (conn.envId || '?') +
      '，API Key ' + (conn.apiKey === 'injected' ? '已注入' : '缺失！') + '）');
    log('boot', { fn: fnName, port: PORT, env: conn.envId, apiKey: conn.apiKey });
  });
  return PORT;
}

module.exports = {
  sendJSON: sendJSON,
  ok: ok,
  fail: fail,
  log: log,
  timer: timer,
  readBody: readBody,
  parseBody: parseBody,
  normalizeId: normalizeId,
  ID_PATTERN: ID_PATTERN,
  createServer: createServer,
  start: start
};
