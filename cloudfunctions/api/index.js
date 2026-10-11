/**
 * ============================================================
 * api/index.js — 每日体坛速览 · 业务读接口云函数（Day 17 建，Day 19 分层重构）
 * ------------------------------------------------------------
 * 今日实现：GET /api/hot —— 首页三平台热搜榜
 *
 * 【Day 23 改动】错误提示统一 —— 本文件不再自己写 sendJSON / ok / fail / log /
 *   自己起 http 服务，改用 cloudfunctions/shared/httpKit.js 这一份公共零件
 *   （matches / news / favorites 早在 Day 22 就接上了，今天把 api 与 health 补齐，
 *   至此 5 个云函数对外的错误话术、响应包络、405 文案全部同源）。
 *   路由、字段、状态码、包络形状一律未动。
 *   另：500 兜底不再把 err.message 拼给客户端 —— 那是内部原文
 *   （Node 英文 / PostgREST 返回体），只进日志。
 *
 * 【Day 20 改动】只有一处：meta.updatedAt 由 new Date()（接口被调用的时刻）
 *   改为 hot_items.fetched_at 的最新值（三平台官网最后一次被抓取的时间）。
 *   原因：前端要在页面上显示「真实抓取时间」，拿请求时刻顶替是假的新鲜。
 *   路由、字段、状态码、包络形状一律未动。
 *
 * 【Day 19 分层重构】本文件现在只做三件事：**接请求、调函数、返响应**。
 *   数据库怎么连、hot_items 怎么查、「行 → 接口字段」怎么映射，
 *   全搬到数据访问层了：
 *     - cloudfunctions/shared/pg.js                 —— 连接底座（怎么连库）
 *     - cloudfunctions/shared/hotItemsRepository.js —— 热搜表查询（怎么查 hot_items）
 *   职责边界：
 *     - 本文件：路由判定、参数校验、状态码/错误码、响应包络、日志
 *     - repository：表名/列名、查询条件、行↔字段映射
 *   好处（今天要掌握的那句话）：改「查数据库」不再需要翻接口文件；
 *   接口只描述「对外的行为」，数据只描述「怎么取」，两边可以各改各的。
 *
 * 【Day 18 重要发现】为什么收藏接口没并进本函数：
 *   CloudBase 网关转发时会**剥掉路由前缀**，且**不把原始路径放进任何请求头**
 *   （Day 18 实测：请求头只有 x-scf-* / x-cloudbase-* / forwarded 等，没有
 *   original-path / forwarded-uri 一类字段）。结果外部访问 /api/hot 与
 *   /api/favorites，函数内收到的 req.url **都是 "/"**，无法区分。
 *   → 解法：**一个路由一个云函数**。本函数只服务 /api/hot（下方恒为根路径），
 *     /api/favorites 独立为 cloudfunctions/favorites（Day 18 新建）。
 *
 * 数据链路：
 *   浏览器 → 网关 /api/hot → 本云函数 → hotItemsRepository → 连接底座 pg.js
 *                                     → CloudBase PG 的 HTTP API（PostgREST）
 *
 * 鉴权：API Key（服务端密钥）由 pg.js 从环境变量 CB_API_KEY 读取，
 *   代码里不留、不提交仓库（在 CloudBase 控制台配置）。
 *
 * 安全（清单要求 3：SQL 必须参数化，禁止拼接）：
 *   本层与 repository 层都不拼 SQL —— 查询条件全部走 PostgREST 的查询参数
 *   （?platform=eq.hupu），由平台侧编译成参数化 SQL；项目名/字段名一律来自
 *   白名单常量，用户输入只允许通过白名单校验后使用，杜绝注入。
 *
 * 路径坑（实测）：
 *   网关会把路由前缀剥掉再转发 —— 外部访问 /api/hot，函数内 req.url 是 "/"。
 *   因此路由判断同时认 "/api/hot" / "/hot" / "/"（后者用于云端，前者本地直连）。
 * ============================================================
 */

const hotRepo = require('../shared/hotItemsRepository');
const pg = require('../shared/pg');
const kit = require('../shared/httpKit');

// 平台白名单（契约 2.1：hupu / tencent / cctv5）
const PLATFORMS = {
  hupu: { name: '虎扑', desc: '步行街 24 小时榜', order: 1 },
  tencent: { name: '腾讯体育', desc: '首页要闻热榜', order: 2 },
  cctv5: { name: '央视体育', desc: '官方要闻', order: 3 }
};

// ---------- 业务：GET /api/hot ----------

/**
 * 三平台热搜。
 * 契约 2.1：platform（选填，白名单）；limit（选填，默认 10，每个平台条数）
 *
 * 本函数只做「校验参数 → 调 repository 取数 → 组装响应」，
 * 不出现任何表名、列名或 HTTPS 调用。
 */
async function handleHot(res, params) {
  const elapsed = kit.timer();

  // ---- 参数校验（契约 2.1 错误表：platform 不在白名单 → 400） ----
  const platformParam = params.get('platform');
  let targets;
  if (platformParam) {
    if (!PLATFORMS[platformParam]) {
      kit.log('hot.reject', { reason: 'platform 非白名单', platform: platformParam, ms: elapsed() });
      // 走三类错误里的「输入错」唯一出口（Day 23）：状态码 400 + 固定前缀 + 说清允许值
      return kit.inputError(res,
        '参数 platform 取值无效，只支持 hupu / tencent / cctv5，收到的是「' + platformParam + '」。');
    }
    targets = [platformParam];
  } else {
    targets = Object.keys(PLATFORMS);
  }

  let limit = parseInt(params.get('limit') || '10', 10);
  if (isNaN(limit) || limit < 1) limit = 10;
  if (limit > 50) limit = 50;   // 上限护栏，防止一次拉爆

  // ---- 按平台查库（每日同步任务写入的真实数据）----
  // 「怎么查」交给数据访问层，这里只说「取哪个平台、几条」。
  const platforms = [];
  for (const p of targets) {
    const rows = await hotRepo.findByPlatform(p, limit);
    platforms.push({
      id: p,
      name: PLATFORMS[p].name,
      desc: PLATFORMS[p].desc,
      items: rows.map(hotRepo.toItemJSON)
    });
  }

  // ---- 空态（契约 2.1：当天无数据 → 404，前端显示整页空态） ----
  const total = platforms.reduce((n, p) => n + p.items.length, 0);
  if (total === 0) {
    kit.log('hot.empty', { targets: targets.join('/'), ms: elapsed() });
    return kit.fail(res, 404, 'NOT_FOUND', '今日暂无热搜数据');
  }

  // ---- meta.updatedAt = 真实抓取时间（Day 20 修正） ----
  // 以前这里写的是 new Date()（= 接口被调用的时刻）。那是「假的新鲜」：
  // 页面会显示「最近更新 刚刚」，而数据可能还是前一天的。
  // 现在改成读 hot_items.fetched_at 的最新值 —— 页面上的「最近更新」
  // 就是「三平台官网最后一次被我们抓取的时间」，与数据一致。
  // 取不到（表空/查询失败）才退回当前时间，且不因此让接口失败。
  let updatedAt = '';
  try {
    updatedAt = await hotRepo.latestFetchedAt();
  } catch (e) {
    // 这里吞掉异常是刻意的：拿不到「真实抓取时间」不该让整页数据失败。
    // 但要注意，吞掉的是**这条附加信息**，不是数据本身（数据在上面已经取到了）。
    kit.log('hot.fetched_at_failed', { reason: (e && e.message) || '' });
  }
  if (!updatedAt) updatedAt = new Date().toISOString();

  kit.log('hot.ok', {
    targets: targets.join('/'), limit: limit, count: total,
    updatedAt: updatedAt, ms: elapsed()
  });

  kit.ok(res, { platforms: platforms }, {
    count: total,
    updatedAt: updatedAt
  });
}

// ---------- 路由 ----------
//
// 本函数只服务 /api/hot 一个路由（Day 18 起：收藏线独立为 favorites 函数）。
// 网关是前缀匹配：剥掉路由前缀（/api/hot）后，剩余部分留在 req.url。
// 本路由不带后缀，所以线上收到的就是 "/"；本地直连则收到完整 "/api/hot"。
// （2026-10-06 更正：此前注释写「恒为 /」，实为前缀剥净后的特例，
//   带后缀的请求会把后缀留在 req.url，见 docs/data-source-status.md §5.1。）

const server = kit.createServer(async (req, res, u) => {
  const path = u.pathname;

  // ---- 路径兼容（重要，实测坑）----
  // CloudBase 网关是**前缀匹配**：转发时剥掉路由前缀（/api/hot），
  // 剩余部分原样留在 req.url —— 本路由无后缀，故线上收到 "/"。
  // 为兼容本地直连测试（此时收到的是完整 /api/hot），两种形态都认。
  const isHot = path === '/api/hot' || path === '/' || path === '/hot';

  if (isHot) {
    return await handleHot(res, u.searchParams);
  }

  // ---- 兜底 404 ----
  kit.log('not_found', { method: req.method, path: path });
  return kit.fail(res, 404, 'NOT_FOUND', '接口不存在：' + path);
}, { allowedMethods: ['GET', 'HEAD'] });

kit.start(server, 'api', pg.connectionInfo());

process.on('uncaughtException', err => {
  kit.log('uncaught_exception', { message: err && err.message, stack: err && err.stack });
});
