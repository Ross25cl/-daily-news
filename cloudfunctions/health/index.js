/**
 * ============================================================
 * health/index.js — 每日体坛速览 · 健康检查云函数（Day 15 建）
 * ------------------------------------------------------------
 * 作用：这是项目接入 CloudBase 的**第一个云函数**，只做一件事——
 *   证明「函数能部署上去、公网能访问到、能返回 JSON」这条链路是通的。
 *
 * 边界（Day 15 明确不做）：
 *   - 不连数据库（数据库建表是 Day 16–20）
 *   - 不写任何业务逻辑（真实业务接口是后续几天）
 *   - 不处理跨域（接口还没接，前端暂不调它）
 *
 * 形态：HTTP 云函数
 *   用 Node 原生 http 模块起一个服务，监听 9000 端口。
 *   CloudBase 要求 HTTP 云函数必须带一个可执行的 scf_bootstrap 启动脚本，
 *   由它拉起这个文件（见同目录 scf_bootstrap）。
 *
 * 为什么用原生 http 而不用 Express：
 *   零依赖。HTTP 云函数不支持云端自动装依赖（installDependency 不生效），
 *   用 Express 就得把 node_modules 一起打包上传，没必要。
 *   这个函数只有一个路由，原生 http 足够。
 * ============================================================
 */

const http = require('node:http');

// CloudBase HTTP 云函数固定监听 9000 端口（不可改）
const PORT = 9000;

// 服务基本信息。改动这里即可，无需动路由逻辑。
const SERVICE_NAME = 'Daily Sports Express';   // 产品英文名
const SERVICE_CN = '每日体坛速览';               // 产品中文名
const VERSION = 'v0.1.0';                        // 云函数自身版本号

/**
 * 构造统一的 JSON 响应。
 * 约定（与 api-contract.md 第 0 节一致）：成功 { ok: true, data }；
 * 出错 { ok: false, error: { code, message } }。
 */
function sendJSON(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // 跨域今天不配，但先把常用的响应头写上，接入前端时不用回头改函数。
    // 注：真正生效需要网关/安全域名配置，Day 15 不处理。
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  // 只解析「路径」，忽略查询串（健康检查不带参数）
  const path = (req.url || '/').split('?')[0];

  // ---- 路由 1：GET /api/health —— 今天唯一实现的接口 ----
  if (path === '/api/health' || path === '/' || path === '/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJSON(res, 405, {
        ok: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET' }
      });
      return;
    }
    sendJSON(res, 200, {
      ok: true,
      service: SERVICE_NAME
    });
    return;
  }

  // ---- 兜底：其它路径一律 404 ----
  // 未来新增接口在路由区往上加，这里保持「不认识就 404」的明确语义。
  sendJSON(res, 404, {
    ok: false,
    error: { code: 'NOT_FOUND', message: '接口不存在：' + path }
  });
});

server.listen(PORT, () => {
  // 启动日志会进 CloudBase 函数日志，排查部署问题时先看这里
  console.log('[' + SERVICE_CN + '] health 云函数已启动，监听端口 ' + PORT + '（' + VERSION + '）');
});

// 优雅处理进程异常：打印出来，方便在函数日志里定位
process.on('uncaughtException', err => {
  console.error('[health] 未捕获异常：', err);
});
