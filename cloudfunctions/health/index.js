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
 * 【Day 23 改动】错误提示统一 —— 本文件不再自己起 http 服务、自己写
 *   405/404 文案，改用 cloudfunctions/shared/httpKit.js：
 *     · 405 文案与其余 4 个云函数同源（'该接口支持 GET / HEAD，收到的是 POST。'）
 *     · 多了统一兜底：万一 handler 抛异常，回 500「服务端开小差了，请稍后重试。」
 *       而不是让请求挂住（以前这里没有 try/catch）。
 *     · OPTIONS 预检统一回 204。
 *   成功响应一字未动：仍是 `{ ok: true, service: 'Daily Sports Express' }`
 *   —— 它没有 data，是契约 §0.2 里唯一的例外，Day 15 起就如此，今天不动它。
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

const kit = require('../shared/httpKit');

// 服务基本信息。改动这里即可，无需动路由逻辑。
const SERVICE_NAME = 'Daily Sports Express';   // 产品英文名
const SERVICE_CN = '每日体坛速览';               // 产品中文名
const VERSION = 'v0.1.0';                        // 云函数自身版本号

const server = kit.createServer((req, res, u) => {
  const path = u.pathname;

  // ---- 路由 1：GET /api/health —— 今天唯一实现的接口 ----
  // （方法白名单已由 kit.createServer 处理，走到这里一定是 GET / HEAD）
  if (path === '/api/health' || path === '/' || path === '/health') {
    // 注意这一条不是契约 §0.2 的 { ok, data, meta }：健康检查没有 data，
    // 从 Day 15 起就是 { ok, service }，checkup.html 直接展示这段原文。
    kit.sendJSON(res, 200, {
      ok: true,
      service: SERVICE_NAME
    });
    return;
  }

  // ---- 兜底：其它路径一律 404 ----
  // 未来新增接口在路由区往上加，这里保持「不认识就 404」的明确语义。
  kit.fail(res, 404, 'NOT_FOUND', '接口不存在：' + path);
}, { allowedMethods: ['GET', 'HEAD'] });

kit.start(server, 'health');

// 优雅处理进程异常：打印出来，方便在函数日志里定位
process.on('uncaughtException', err => {
  console.error('[' + SERVICE_CN + '] 未捕获异常：', err);
});

console.log('[' + SERVICE_CN + '] health 版本 ' + VERSION);
