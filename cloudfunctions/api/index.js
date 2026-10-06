/**
 * ============================================================
 * api/index.js — 每日体坛速览 · 业务读接口云函数（Day 17 建）
 * ------------------------------------------------------------
 * 今日实现：GET /api/hot —— 首页三平台热搜榜
 *
 * 数据链路（重要，和 Day 15 的 health 不同）：
 *   浏览器 → 网关 /api/hot → 本云函数 → CloudBase PG 的 HTTP API
 *                                    （PostgREST，走 https，非 TCP 直连）
 *
 * 为什么走 HTTP API 而不是 pg 驱动：
 *   CloudBase 体验版（个人版）**不支持数据库 TCP 直连**——内网互联不开放、
 *   公网直连开关也打不开。云函数访问 PG 只能走平台的 HTTP API（PostgREST）。
 *   另：HTTP 云函数不能在云端自动装依赖，pg / @cloudbase/node-sdk 都用不了，
 *   所以本函数**零依赖**：只用 Node 原生 https 发请求。
 *
 * 鉴权：API Key（服务端密钥，拥有本环境读写权限）
 *   - 通过环境变量 CB_API_KEY 注入，**绝不写进代码、绝不提交仓库**
 *   - 在 CloudBase 控制台配置：环境 → 云函数 → api → 环境变量
 *
 * 安全（清单要求 3：SQL 必须参数化，禁止拼接）：
 *   本层不拼 SQL —— 查询条件全部走 PostgREST 的查询参数（?platform=eq.hupu），
 *   由平台侧编译成参数化 SQL；项目名/字段名一律来自白名单常量，
 *   用户输入只允许通过白名单校验后使用，杜绝注入。
 *
 * 路径坑（实测）：
 *   网关会把路由前缀剥掉再转发 —— 外部访问 /api/hot，函数内 req.url 是 "/"。
 *   因此路由判断同时认 "/api/hot" / "/hot" / "/"（后者用于云端，前者本地直连）。
 * ============================================================
 */

const https = require('node:https');

// CloudBase HTTP 云函数固定监听 9000 端口（不可改）
// 允许环境变量覆盖，仅为本地测试；云端由 scf_bootstrap 注入 PORT=9000
const PORT = Number(process.env.PORT || 9000);

const ENV_ID = process.env.CB_ENV_ID || 'ross-d2gimwy406e0d6812';
const API_KEY = process.env.CB_API_KEY || '';           // 控制台注入，代码里不留
const REST_HOST = ENV_ID + '.api.tcloudbasegateway.com';
const REST_BASE = '/v1/rdb/rest';

// 平台白名单（契约 2.1：hupu / tencent / cctv5）
const PLATFORMS = {
  hupu: { name: '虎扑', desc: '步行街 24 小时榜', order: 1 },
  tencent: { name: '腾讯体育', desc: '首页要闻热榜', order: 2 },
  cctv5: { name: '央视体育', desc: '官方要闻', order: 3 }
};

// 契约 0.1：接口输出 camelCase（数据库是 snake_case，在这一层做映射）
const FIELD_MAP = {
  rank: 'rank',
  title: 'title',
  heat: 'heat',
  url: 'url',
  tag: 'tag',
  is_video: 'video'
};

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

// ---------- PostgREST 查询 ----------

/**
 * 调 CloudBase PG 的 HTTP API 查一张表。
 * @param {string} table  表名（只允许调用方传字面量，不来自用户输入）
 * @param {object} query  查询参数对象，如 {platform:'eq.hupu', order:'rank.asc', limit:10}
 * @returns {Promise<Array>} 行数组
 */
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
      host: REST_HOST,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Accept': 'application/json'
      },
      timeout: 8000
    }, resp => {
      let raw = '';
      resp.setEncoding('utf8');
      resp.on('data', c => { raw += c; });
      resp.on('end', () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          return reject(new Error('数据库返回 HTTP ' + resp.statusCode + '：' + raw.slice(0, 300)));
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

// ---------- 业务：GET /api/hot ----------

/**
 * 三平台热搜。
 * 契约 2.1：platform（选填，白名单）；limit（选填，默认 10，每个平台条数）
 */
async function handleHot(res, params) {
  // ---- 参数校验（契约 2.1 错误表：platform 不在白名单 → 400） ----
  const platformParam = params.get('platform');
  let targets;
  if (platformParam) {
    if (!PLATFORMS[platformParam]) {
      return fail(res, 400, 'BAD_REQUEST',
        'platform 取值无效，只支持 hupu / tencent / cctv5');
    }
    targets = [platformParam];
  } else {
    targets = Object.keys(PLATFORMS);
  }

  let limit = parseInt(params.get('limit') || '10', 10);
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 50) limit = 50;   // 上限护栏，防止一次拉爆

  // ---- 按平台查库（每日同步任务写入的真实数据） ----
  const platforms = [];
  for (const p of targets) {
    const rows = await queryTable('hot_items', {
      select: 'rank,title,heat,url,tag,is_video',
      platform: 'eq.' + p,          // 值来自白名单常量，不是用户原始输入
      order: 'rank.asc',
      limit: limit
    });
    platforms.push({
      id: p,
      name: PLATFORMS[p].name,
      desc: PLATFORMS[p].desc,
      items: rows.map(r => ({
        rank: Number(r.rank),
        title: r.title,
        heat: Number(r.heat),
        url: r.url,
        tag: r.tag || '综合',
        video: !!r.is_video
      }))
    });
  }

  // ---- 空态（契约 2.1：当天无数据 → 404，前端显示整页空态） ----
  const total = platforms.reduce((n, p) => n + p.items.length, 0);
  if (total === 0) {
    return fail(res, 404, 'NOT_FOUND', '今日暂无热搜数据');
  }

  // 用最早一条抓取时间做 meta.updatedAt 更准确，但需额外查询；这里取当前时间
  ok(res, { platforms: platforms }, {
    count: total,
    updatedAt: new Date().toISOString()
  });
}

// ---------- 路由 ----------

const server = http_createServer();

function http_createServer() {
  const http = require('node:http');
  return http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://localhost');
    const path = u.pathname;

    // ---- 路径兼容（重要，实测坑）----
    // CloudBase 网关转发到函数时会**剥掉路由前缀**：外部访问 /api/hot，
    // 函数内收到的 req.url 是 "/"（Day 15 的 health 也遇到过，见其注释）。
    // 为兼容本地直连测试（此时收到的是完整 /api/hot），两种形态都认。
    const isHot = path === '/api/hot' || path === '/' || path === '/hot';

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return fail(res, 405, 'METHOD_NOT_ALLOWED', '仅支持 GET');
    }

    try {
      // ---- GET /api/hot ----
      if (isHot) {
        return await handleHot(res, u.searchParams);
      }

      // ---- 兜底 404 ----
      return fail(res, 404, 'NOT_FOUND', '接口不存在：' + path);
    } catch (err) {
      // 错误信息给中文可读说明（契约 0.3：500 INTERNAL_ERROR）
      console.error('[api] 处理失败：', err);
      return fail(res, 500, 'INTERNAL_ERROR',
        '服务端开小差了，请稍后重试。' + (err && err.message ? '（' + err.message + '）' : ''));
    }
  });
}

server.listen(PORT, () => {
  console.log('[每日体坛速览] api 云函数已启动，监听端口 ' + PORT +
    '（env=' + ENV_ID + '，API Key ' + (API_KEY ? '已注入' : '缺失！') + '）');
});

process.on('uncaughtException', err => {
  console.error('[api] 未捕获异常：', err);
});
