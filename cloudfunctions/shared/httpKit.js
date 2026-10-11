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
 *   createServer         —— 生成 http 服务（统一错误兜底 + 405 + 预检
 *                           + 【Day 23 加练】每条请求一行 request 日志）
 *   readBody             —— 读请求体，带体积上限
 *   normalizeId          —— 校验外部传进来的 id（中文错误说明）
 *   idFromPathSuffix     —— 【Day 23】从路径后缀取 id（自己解码，畸形转义不炸 500）
 *   readDeleteId         —— 【Day 23】删除接口取 id（body 优先 / 路径后缀兜底，一处实现）
 *   parseBody            —— 读 + 解析 JSON，失败给中文说明
 *   inputError           —— 【Day 23】三类错误之「输入错」的唯一出口（400）
 *   failUnexpected       —— 【Day 23】三类错误之「网络错 / 服务端错」的兜底出口
 *   classify             —— 【Day 23】把内部异常归到三类里的哪一类
 *   start                —— 监听 9000 端口 + 启动日志
 * ============================================================
 */

const http = require('node:http');

// 请求体体积上限（readBody 默认值；parseBody 的报错文案也用它）
const BODY_LIMIT = 64 * 1024;

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

// ---------- 三类错误：对外话术的唯一出口（Day 23） ----------
//
// 全项目对外只承认三种「出错」，每种对应一句固定中文：
//
//   ① 输入错   INPUT    用户传的参数 / 请求体不合规         → 400 BAD_REQUEST
//   ② 网络错   NETWORK  连不上上游数据服务（超时/断连/5xx） → 503 UPSTREAM_UNREACHABLE
//   ③ 服务端错 SERVER   其它未预期异常（含我们自己配错）     → 500 INTERNAL_ERROR
//
// 铁律：**响应体里绝不出现 err.message**。
//   内部的错（Node 的英文原文、PostgREST 的返回体、堆栈）只写进日志。
//   为什么较真：Day 22 之前的兜底写的是
//     '服务端开小差了，请稍后重试。（' + err.message + '）'
//   那个括号里就是数据库原文 / 'getaddrinfo ENOTFOUND …' ——
//   用户看不懂，还可能把表名、SQL 片段、环境变量名带出去。
//
// 注意 404 不在三类之内：它是**具体的业务结果**（这条记录不存在），
//   语义明确，文案由各接口自己说（「未找到该比赛记录（id=…）」）。
//   三类管的是「说不清是谁的错，才需要兜底」的那些。
//
// 一个使用前提：NETWORK 由数据访问层显式打标（shared/pg.js 里 err.kind = 'NETWORK'）
//   —— 只有那一层才分得清「是连不上库」还是「查询本身写错了」。

const KINDS = {
  INPUT:   { status: 400, code: 'BAD_REQUEST' },
  NETWORK: { status: 503, code: 'UPSTREAM_UNREACHABLE' },
  SERVER:  { status: 500, code: 'INTERNAL_ERROR' }
};

const PUBLIC_MESSAGE = {
  INPUT:   '输入有误：',                              // 后面接「错在哪、怎么改」
  NETWORK: '暂时连不上数据服务，请稍后重试。',
  SERVER:  '服务端开小差了，请稍后重试。'
};

/**
 * 输入错（400）。detail 必须是**已经写成人话的中文说明**，说清「错在哪、怎么改」。
 * 例：'缺少必填字段：title、sourceUrl。请补齐后重新提交。'
 * 注：内部的「格式校验失败」提示本来就是人话（Day 18/22 刻意这么写的），
 *     所以这里只统一前缀与状态码，不重写内容。
 */
function inputError(res, detail) {
  return fail(res, KINDS.INPUT.status, KINDS.INPUT.code, PUBLIC_MESSAGE.INPUT + detail);
}

/**
 * 把内部异常归到三类里的某一类。
 * 打标规则：数据访问层把「连不上上游」的错标成 err.kind = 'NETWORK'；
 * 其余（含 Node 抛的、我们自己写错的）一律算服务端错。
 */
function classify(err) {
  const kind = (err && err.kind === 'NETWORK') ? 'NETWORK' : 'SERVER';
  return {
    kind: kind,
    status: KINDS[kind].status,
    code: KINDS[kind].code,
    message: PUBLIC_MESSAGE[kind]
  };
}

/**
 * 兜底出口：未预期的异常 → 网络错 或 服务端错，对外只有固定中文。
 * fields 里的东西只进日志。返回的响应体里**没有** err.message。
 */
function failUnexpected(res, err, fields) {
  const c = classify(err);
  log(c.kind === 'NETWORK' ? 'upstream_unreachable' : 'error', Object.assign({
    kind: c.kind,
    // ↓ 这一行是给运维看的，只进日志，不进响应体
    reason: (err && err.message) ? String(err.message).slice(0, 400) : '',
    dbStatus: err && err.dbStatus
  }, fields || {}));
  return fail(res, c.status, c.code, c.message);
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
  const LIMIT = maxBytes || BODY_LIMIT;   // 够用即可，防大包打爆
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
 *
 * @param {object} [opts]
 * @param {string} [opts.example]      报错文案里给的 JSON 示例（各接口不一样，免得给错例子）
 * @param {boolean}[opts.emptyAsObject] 空请求体是否当成 `{}` 交给字段校验
 *        （收藏接口要这样：空体应当一次性点名所有缺失字段，而不是只说「体是空的」）
 * @returns {Promise<{error: string|null, body: object}>} error 非空时是中文说明
 */
async function parseBody(req, opts) {
  const o = opts || {};
  const example = o.example || '{"id":"20260924-nba-01","status":"已结束"}';

  let raw = '';
  try {
    raw = await readBody(req);
  } catch (e) {
    // ⚠️ 这里以前写的是 '无法读取请求体：' + e.message —— e.message 是 Node 的
    //    英文原文（'aborted' / 'stream destroyed'），不该给用户看。
    //    只有「超过上限」那一句是我们自己抛的中文，可以照说。
    const tooBig = /上限/.test(String(e && e.message));
    return {
      error: tooBig
        ? '请求体过大（上限 ' + Math.round(BODY_LIMIT / 1024) + 'KB），请精简后重试。'
        : '请求体读取失败（连接中断），请重试。',
      body: null
    };
  }
  if (!raw || !raw.trim()) {
    if (o.emptyAsObject) return { error: null, body: {} };
    return { error: '请求体是空的。请提交 JSON，例如 ' + example + '。', body: null };
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { error: '请求体应为 JSON 对象（不是数组或其它类型）。', body: null };
    }
    return { error: null, body: body };
  } catch (e) {
    return { error: '请求体不是合法 JSON，请检查格式（应为 ' + example + '）。', body: null };
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

/**
 * 【Day 23】从 req.url 的路径后缀里取 id（`DELETE /api/matches/<id>` 用）。
 *
 * 为什么单独抽一个函数：`decodeURIComponent` 遇到**不完整的百分号转义**会抛
 *   URIError（例如 `/api/matches/%E4%B8`）。这是「用户传的地址有问题」，
 *   但以前它会一路冒到最外层兜底，被当成 500「服务端开小差了」——
 *   责任说反了，而且用户拿不到任何可操作的信息。
 *   现在就地拦下，交回 inputError 报 400。
 *
 * @param {string} rawUrl      req.url
 * @param {string[]} [exclude] 不算 id 的路径词（如 ['api','matches']）——
 *        本地直连时 req.url 是 /api/matches，别把 'matches' 当成 id。
 * @returns {{error: string|null, id: string}}
 */
function idFromPathSuffix(rawUrl, exclude) {
  const ex = exclude || ['api'];
  const suffix = String(rawUrl || '/').split('?')[0].replace(/^\/+/, '');
  const seg = suffix.split('/').filter(Boolean).pop() || '';
  if (!seg || ex.indexOf(seg) >= 0) return { error: null, id: '' };
  try {
    return { error: null, id: decodeURIComponent(seg) };
  } catch (e) {
    return {
      error: 'id 里的百分号转义不完整（收到「' + seg + '」），无法解析地址，请检查后重试。',
      id: ''
    };
  }
}

/**
 * 【Day 23】从一次删除请求里取出 id：**请求体优先，路径后缀兜底**。
 *
 * 为什么收上来：matches 与 news 两个删除接口原本各写了一份一模一样的 25 行
 *   （读 body → JSON.parse → 失败 400 → 没有 body 就回头找路径后缀 → normalizeId）。
 *   两份「看起来一样」的实现迟早有一份改漏，而且两份都踩了同一个坑：
 *   路径后缀那段的 decodeURIComponent 会把畸形地址抛成 500。
 *   现在统一走这里。
 *
 * @param {object} [opts]
 * @param {string}   [opts.example] 报错文案里的 JSON 示例
 * @param {string[]} [opts.exclude] 路径里不算 id 的词
 * @returns {Promise<{error: string|null, id: string, from: string}>}
 */
async function readDeleteId(req, opts) {
  const o = opts || {};
  const example = o.example || '{"id":"20260924-nba-01"}';

  let rawId = '';
  let from = '';

  let raw = '';
  try { raw = await readBody(req); } catch (e) { raw = ''; }

  if (raw && raw.trim()) {
    let b;
    try {
      b = JSON.parse(raw);
    } catch (e) {
      return { error: '请求体不是合法 JSON，请检查格式（应为 ' + example + '）。', id: '', from: '' };
    }
    if (b && typeof b === 'object' && !Array.isArray(b) && b.id !== undefined) {
      rawId = b.id;
      from = 'body';
    }
  }

  if (!rawId) {
    const suffix = idFromPathSuffix(req.url, o.exclude);
    if (suffix.error) return { error: suffix.error, id: '', from: '' };
    if (suffix.id) { rawId = suffix.id; from = 'path'; }
  }

  const check = normalizeId(rawId);
  if (check.error) return { error: check.error, id: '', from: from };
  return { error: null, id: check.id, from: from };
}

// ---------- 服务与启动 ----------
//
// 统一错误兜底：任何未捕获异常都落成三类错误里的中文说明，
// 绝不让客户端看到一个裸堆栈。

function createServer(handler, opts) {
  const options = opts || {};
  const allowedMethods = options.allowedMethods || ['GET', 'HEAD'];

  return http.createServer(async (req, res) => {
    const started = Date.now();
    let logPath = String(req.url || '/').split('?')[0];

    // 【Day 23 加练】一条请求日志：时间、方法、路径、结果（状态码）、耗时。
    // 为什么挂在 res 的 finish/close 上：正常分支、405、兜底 500 —— 无论走哪条，
    //   一次请求只会落到这里一次，不必在每个 return 前各写一行（写漏是迟早的事）。
    // 只记这些字段：不记请求体、不记请求头，免得把 Key 或用户内容带进日志。
    let logged = false;
    const logOnce = () => {
      if (logged) return;
      logged = true;
      log('request', {
        method: req.method,
        path: logPath,
        status: res.statusCode,
        ms: Date.now() - started
      });
    };
    res.on('finish', logOnce);
    res.on('close', logOnce);

    // 先安全地解析 URL。这行以前放在 try 之外 —— 一旦 req.url 畸形，
    // 抛出的异常没有任何人接，请求会挂住或直接断连。
    let u;
    try {
      u = new URL(req.url || '/', 'http://localhost');
      logPath = u.pathname;
    } catch (e) {
      return inputError(res, '请求地址无法解析，请检查后重试。');
    }

    // 预检交给网关处理（网关自动回 CORS 头），这里只回一个干净的空响应，
    // 免得 OPTIONS 走到业务分支被判成 405。
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Content-Length': 0 });
      return res.end();
    }

    if (allowedMethods.indexOf(req.method) < 0) {
      // 不再单独打一行：上面的 request 日志已经带 status=405 与路径，够回溯了。
      return fail(res, 405, 'METHOD_NOT_ALLOWED',
        '该接口支持 ' + allowedMethods.join(' / ') + '，收到的是 ' + req.method + '。');
    }

    try {
      return await handler(req, res, u);
    } catch (err) {
      return failUnexpected(res, err, {
        method: req.method, path: u.pathname
      });
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
  BODY_LIMIT: BODY_LIMIT,
  KINDS: KINDS,
  PUBLIC_MESSAGE: PUBLIC_MESSAGE,
  sendJSON: sendJSON,
  ok: ok,
  fail: fail,
  inputError: inputError,
  classify: classify,
  failUnexpected: failUnexpected,
  log: log,
  timer: timer,
  readBody: readBody,
  parseBody: parseBody,
  normalizeId: normalizeId,
  idFromPathSuffix: idFromPathSuffix,
  readDeleteId: readDeleteId,
  ID_PATTERN: ID_PATTERN,
  createServer: createServer,
  start: start
};
