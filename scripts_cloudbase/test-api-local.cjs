// ============================================================
// 本地验证云函数的分支逻辑（Day 17 建，Day 18 扩收藏线，Day 23 扩三类错误）
//
// 用法：
//   node scripts_cloudbase/test-api-local.cjs            # 只跑不连库的分支（默认，快）
//   node scripts_cloudbase/test-api-local.cjs --with-db  # 额外跑真连库的 写入/重复/读回
//
// 说明（Day 18 架构）：
//   /api/hot       → cloudfunctions/api       （读热搜）
//   /api/favorites → cloudfunctions/favorites （收藏线，POST 写 + GET 读）
//   /api/matches   → cloudfunctions/matches   （Day 22 改删）
//   /api/news      → cloudfunctions/news      （Day 22 改删）
//   一个路由一个函数，因此本脚本要分别起进程来测。
//
// 【Day 23 加的那一组：三类错误】
//   输入错 / 网络错 / 服务端错 三种情况各起一个真实进程来打，断言：
//     · 状态码与 code 对得上（400 BAD_REQUEST / 503 UPSTREAM_UNREACHABLE / 500 INTERNAL_ERROR）
//     · message 是中文，且**一个内部词都不许出现**（API Key / 环境变量 / ENOTFOUND / 数据库…）
//   网络错怎么造假：把 CB_ENV_ID 换成一个 DNS 查不到的名字
//     （pg.js 里 host = CB_ENV_ID + '.api.tcloudbasegateway.com'，非法字符 → ENOTFOUND）。
//   服务端错怎么造假：不给 CB_API_KEY（真实场景是控制台环境变量没配上）。
// ============================================================
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const PORT_API = 9101;        // api 函数（hot）
const PORT_FAV = 9102;        // favorites 函数（收藏）
const PORT_MATCH = 9103;      // matches 函数（赛程改删）
const PORT_NEWS = 9104;       // news 函数（资讯改删）
const PORT_NET = 9105;        // api 函数（故意配一个连不上的环境，测「网络错」）
const PORT_NOKEY_API = 9106;  // api 函数（故意不给 CB_API_KEY，测「服务端错」）
const PORT_NOKEY_FAV = 9107;  // favorites 函数（同上）
const WITH_DB = process.argv.indexOf('--with-db') >= 0;

// 从 .env 读 CB_API_KEY（仅 --with-db 时用；文件被 .gitignore 忽略）
function readApiKey() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = txt.match(/^CB_API_KEY=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch (e) { return ''; }
}

const API_KEY = WITH_DB ? readApiKey() : '';

function startFn(name, port, extraEnv) {
  const child = spawn(process.execPath, [path.join(ROOT, 'cloudfunctions', name, 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), CB_API_KEY: API_KEY }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => process.stdout.write('[' + name + ':' + port + '] ' + d));
  child.stderr.on('data', d => process.stdout.write('[' + name + ':' + port + '!] ' + d));
  return child;
}

const apiChild = startFn('api', PORT_API);
const favChild = startFn('favorites', PORT_FAV);
const matchChild = startFn('matches', PORT_MATCH);
const newsChild = startFn('news', PORT_NEWS);
// 「网络错」专用实例：CB_ENV_ID 含非法字符 → host 查不到 → ENOTFOUND
const netChild = startFn('api', PORT_NET, {
  CB_ENV_ID: 'local!host',
  CB_API_KEY: API_KEY || 'dummy-key-for-network-test'
});
// 「服务端错」专用实例：不给 CB_API_KEY（真实场景＝控制台环境变量漏配）
const noKeyApiChild = startFn('api', PORT_NOKEY_API, { CB_API_KEY: '' });
const noKeyFavChild = startFn('favorites', PORT_NOKEY_FAV, { CB_API_KEY: '' });
const children = [apiChild, favChild, matchChild, newsChild, netChild, noKeyApiChild, noKeyFavChild];

function request(port, method, pathname, bodyObj) {
  return new Promise(resolve => {
    const data = bodyObj === undefined ? null : (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj));
    const opts = {
      host: '127.0.0.1', port: port, path: pathname, method: method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', e => resolve({ status: 0, body: String(e.message) }));
    if (data) req.write(data);
    req.end();
  });
}

// 安全解析：服务没起来时 body 是错误文本，不能让 JSON.parse 抛异常打断整个测试
function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

// 响应体里绝不允许出现的内部词（Day 23 的硬断言）
const LEAK_WORDS = /API Key|CB_API_KEY|环境变量|ENOTFOUND|getaddrinfo|PostgREST|SELECT |INSERT |relation |stack|at Object\.|node:internal/i;

// 生成一个不会撞库的唯一 URL（按时间戳）
function uniqUrl() {
  return 'https://example.com/day18-test-' + Date.now();
}

(async () => {
  await new Promise(r => setTimeout(r, 1100));
  const results = [];
  const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail });
  const msgOf = b => (b && b.error && b.error.message) || '';

  // ================= 第一组：hot（不连库分支） =================

  const r1 = await request(PORT_API, 'GET', '/api/hot?platform=weibo');
  const b1 = safeParse(r1.body) || {};
  check('GET /api/hot?platform=weibo → 400 BAD_REQUEST（输入错）',
    r1.status === 400 && b1.error && b1.error.code === 'BAD_REQUEST' && /输入有误/.test(msgOf(b1)),
    r1.status + ' ' + r1.body.replace(/\s+/g, ' ').slice(0, 110));

  const r2 = await request(PORT_API, 'GET', '/api/nope');
  const b2 = safeParse(r2.body) || {};
  check('GET /api/nope → 404 NOT_FOUND',
    r2.status === 404 && b2.error && b2.error.code === 'NOT_FOUND', r2.status);

  const r3 = await request(PORT_API, 'POST', '/api/hot', {});
  const b3 = safeParse(r3.body) || {};
  check('POST /api/hot → 405 METHOD_NOT_ALLOWED',
    r3.status === 405 && b3.error && b3.error.code === 'METHOD_NOT_ALLOWED', r3.status);

  // ================= 第二组：favorites（不连库分支） =================

  // PUT → 405（方法不对）
  const f1 = await request(PORT_FAV, 'PUT', '/api/favorites', {});
  const fb1 = safeParse(f1.body) || {};
  check('PUT /api/favorites → 405 METHOD_NOT_ALLOWED',
    f1.status === 405 && fb1.error && fb1.error.code === 'METHOD_NOT_ALLOWED',
    f1.status + ' ' + (fb1.error ? fb1.error.message : ''));

  // 空 body → 400，中文点名全部缺失字段
  const f2 = await request(PORT_FAV, 'POST', '/api/favorites', {});
  const fb2 = safeParse(f2.body) || {};
  const m2 = msgOf(fb2);
  check('POST /api/favorites 空 body → 400 且中文点名缺失字段',
    f2.status === 400 && fb2.error && fb2.error.code === 'BAD_REQUEST' &&
    /缺少必填字段/.test(m2) && /title/.test(m2) && /sourceUrl/.test(m2),
    f2.status + ' ' + m2.slice(0, 170));

  // 只缺 sourceUrl → 400，只点名它
  const f3 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', digestDate: '2026-10-06'
  });
  const fb3 = safeParse(f3.body) || {};
  const m3 = msgOf(fb3);
  check('缺 sourceUrl → 400 且只点名 sourceUrl',
    f3.status === 400 && /缺少必填字段/.test(m3) && /sourceUrl/.test(m3) && !/title/.test(m3),
    f3.status + ' ' + m3.slice(0, 160));

  // 日期格式错 → 400 且提示正确格式
  const f4 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026/10/06'
  });
  const fb4 = safeParse(f4.body) || {};
  const m4 = msgOf(fb4);
  check('digestDate 格式错 → 400 且提示 YYYY-MM-DD',
    f4.status === 400 && /digestDate/.test(m4) && /YYYY-MM-DD/.test(m4),
    f4.status + ' ' + m4.slice(0, 160));

  // 不存在的日期（2026-02-30）→ 400
  const f4b = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026-02-30'
  });
  const fb4b = safeParse(f4b.body) || {};
  const m4b = msgOf(fb4b);
  check('digestDate 为不存在的日期 → 400',
    f4b.status === 400 && /不是有效日期/.test(m4b),
    f4b.status + ' ' + m4b.slice(0, 140));

  // section 非白名单 → 400 且列出允许值
  const f5 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '不存在的板块', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026-10-06'
  });
  const fb5 = safeParse(f5.body) || {};
  const m5 = msgOf(fb5);
  check('section 非白名单 → 400 且列出允许值',
    f5.status === 400 && /section/.test(m5) && /头条/.test(m5),
    f5.status + ' ' + m5.slice(0, 170));

  // title 超 30 字 → 400 且报出当前字数
  const f6 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '这是一个非常非常非常非常非常非常非常非常长的标题超过三十个字的限制',
    summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026-10-06'
  });
  const fb6 = safeParse(f6.body) || {};
  const m6 = msgOf(fb6);
  check('title 超 30 字 → 400 且报出当前字数',
    f6.status === 400 && /title/.test(m6) && /30/.test(m6),
    f6.status + ' ' + m6.slice(0, 160));

  // summary 超 60 字 → 400
  const f7 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题',
    summary: '这是一段非常长的摘要用来验证超过六十字上限是否会被正确拦下来所以我要继续写很多很多字直到超过六十字为止这样肯定够长了真的够长了',
    section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026-10-06'
  });
  const fb7 = safeParse(f7.body) || {};
  const m7 = msgOf(fb7);
  check('summary 超 60 字 → 400',
    f7.status === 400 && /summary/.test(m7) && /60/.test(m7),
    f7.status + ' ' + m7.slice(0, 160));

  // sourceUrl 非 http(s) → 400
  const f8 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'ftp://example.com/x', digestDate: '2026-10-06'
  });
  const fb8 = safeParse(f8.body) || {};
  const m8 = msgOf(fb8);
  check('sourceUrl 非 http(s) → 400',
    f8.status === 400 && /sourceUrl/.test(m8),
    f8.status + ' ' + m8.slice(0, 150));

  // body 非合法 JSON → 400
  const f9 = await request(PORT_FAV, 'POST', '/api/favorites', '{ this is not json');
  const fb9 = safeParse(f9.body) || {};
  check('POST body 非合法 JSON → 400',
    f9.status === 400 && fb9.error && /JSON/.test(fb9.error.message),
    f9.status + ' ' + msgOf(fb9).slice(0, 120));

  // ================= 第三组：三类错误（Day 23） =================

  // ---- 输入错：畸形百分号转义（回归！改前这里会冒成 500「服务端开小差了」） ----
  const e1 = await request(PORT_MATCH, 'DELETE', '/api/matches/%E4%B8');
  const eb1 = safeParse(e1.body) || {};
  check('【输入错】DELETE /api/matches/%E4%B8 → 400（改前是 500）',
    e1.status === 400 && eb1.error && eb1.error.code === 'BAD_REQUEST' &&
    /输入有误/.test(msgOf(eb1)),
    e1.status + ' ' + msgOf(eb1).slice(0, 130));

  // ---- 输入错：DELETE 没给 id ----
  const e2 = await request(PORT_MATCH, 'DELETE', '/api/matches', {});
  const eb2 = safeParse(e2.body) || {};
  check('【输入错】DELETE /api/matches 无 id → 400 且说清缺什么',
    e2.status === 400 && /缺少参数 id/.test(msgOf(eb2)),
    e2.status + ' ' + msgOf(eb2).slice(0, 130));

  // ---- 输入错：id 形态不合法 ----
  const e3 = await request(PORT_NEWS, 'PATCH', '/api/news', { id: 'bad id!', title: 'x' });
  const eb3 = safeParse(e3.body) || {};
  check('【输入错】PATCH /api/news id 形态不合法 → 400 且给出正确形态',
    e3.status === 400 && /输入有误/.test(msgOf(eb3)) && /格式不合法/.test(msgOf(eb3)),
    e3.status + ' ' + msgOf(eb3).slice(0, 140));

  // ---- 输入错：PATCH 空 body（真的一个字节都不发） ----
  const e4 = await request(PORT_MATCH, 'PATCH', '/api/matches');
  const eb4 = safeParse(e4.body) || {};
  check('【输入错】PATCH /api/matches 空 body → 400（中文，带 JSON 示例）',
    e4.status === 400 && /请求体是空的/.test(msgOf(eb4)),
    e4.status + ' ' + msgOf(eb4).slice(0, 140));

  // ---- 输入错：DELETE body 不是合法 JSON ----
  const e5 = await request(PORT_NEWS, 'DELETE', '/api/news', '{ not json');
  const eb5 = safeParse(e5.body) || {};
  check('【输入错】DELETE /api/news body 非 JSON → 400',
    e5.status === 400 && /JSON/.test(msgOf(eb5)),
    e5.status + ' ' + msgOf(eb5).slice(0, 130));

  // ---- 网络错：数据库网关连不上（CB_ENV_ID 配了个查不到的名字） ----
  const e6 = await request(PORT_NET, 'GET', '/api/hot');
  const eb6 = safeParse(e6.body) || {};
  check('【网络错】GET /api/hot（上游连不上）→ 503 UPSTREAM_UNREACHABLE + 中文',
    e6.status === 503 && eb6.error && eb6.error.code === 'UPSTREAM_UNREACHABLE' &&
    /暂时连不上数据服务/.test(msgOf(eb6)),
    e6.status + ' ' + msgOf(eb6).slice(0, 130));

  check('【网络错】响应体里没有内部细节（ENOTFOUND / getaddrinfo …）',
    !LEAK_WORDS.test(e6.body),
    '泄漏词命中：' + (e6.body.match(LEAK_WORDS) || ['无'])[0]);

  // ---- 服务端错：我们自己没配 API Key（真实场景＝控制台环境变量漏配） ----
  const e7 = await request(PORT_NOKEY_FAV, 'POST', '/api/favorites', {
    title: '合法标题', summary: '合法摘要，含背景与后续安排。', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/valid-no-key', digestDate: '2026-10-06'
  });
  const eb7 = safeParse(e7.body) || {};
  check('【服务端错】校验通过但未配 API Key → 500 INTERNAL_ERROR + 中文',
    e7.status === 500 && eb7.error && eb7.error.code === 'INTERNAL_ERROR' &&
    /服务端开小差了/.test(msgOf(eb7)),
    e7.status + ' ' + msgOf(eb7).slice(0, 130));

  check('【服务端错】响应体里不再出现「API Key / 环境变量」（改前会带出来）',
    !LEAK_WORDS.test(e7.body),
    '泄漏词命中：' + (e7.body.match(LEAK_WORDS) || ['无'])[0]);

  const e8 = await request(PORT_NOKEY_API, 'GET', '/api/hot?platform=hupu&limit=1');
  const eb8 = safeParse(e8.body) || {};
  check('【服务端错】GET /api/hot 未配 Key → 500 + 中文（api 函数也走同一套）',
    e8.status === 500 && /服务端开小差了/.test(msgOf(eb8)) && !LEAK_WORDS.test(e8.body),
    e8.status + ' ' + msgOf(eb8).slice(0, 130));

  // ---- 三类错误的文案必须互不相同（否则等于没分类） ----
  const threeMessages = [msgOf(eb1), msgOf(eb6), msgOf(eb7)];
  check('三类错误的对外文案互不相同',
    new Set(threeMessages).size === 3, threeMessages.join(' | ').slice(0, 200));

  // ================= 第四组：真连库（--with-db 才跑） =================
  if (WITH_DB && API_KEY) {
    // ---- Day 20：meta.updatedAt 必须是「真实抓取时间」，不是接口被调用的时刻 ----
    // 判法：拿 updatedAt 与当前时刻比。若实现还在用 new Date()，两者会几乎相等（< 1 秒）。
    // 只有真的读了 hot_items.fetched_at，才会与「现在」差出明显的量级。
    const h1 = await request(PORT_API, 'GET', '/api/hot?platform=hupu&limit=2');
    const hb1 = safeParse(h1.body) || {};
    const updatedAt = (hb1.meta && hb1.meta.updatedAt) || '';
    const gapMs = updatedAt ? Math.abs(Date.now() - new Date(updatedAt).getTime()) : -1;
    check('GET /api/hot → meta.updatedAt 是真实抓取时间（与此刻相差 > 5 秒）',
      h1.status === 200 && hb1.ok === true && !isNaN(new Date(updatedAt).getTime()) && gapMs > 5000,
      'updatedAt=' + updatedAt + '，距此刻 ' + Math.round(gapMs / 1000) + ' 秒');

    const url = uniqUrl();
    const payload = {
      title: '【Day 18 实测】湖人加时险胜',
      summary: '加时赛最后时刻绝杀，影响西部排名格局，下一场回到主场。',
      section: '头条',
      league: 'NBA',
      sourceName: 'Day 18 测试',
      sourceUrl: url,
      digestDate: '2026-10-06'
    };

    // 正常 POST → 200 { ok:true } 且形状与契约一致
    const w1 = await request(PORT_FAV, 'POST', '/api/favorites', payload);
    const wb1 = safeParse(w1.body) || {};
    const d1 = wb1.data || {};
    check('正常 POST → 200 ok:true + data 形状符合契约',
      w1.status === 200 && wb1.ok === true &&
      typeof d1.id === 'string' && d1.title === payload.title &&
      d1.sourceUrl === url && d1.digestDate === '2026-10-06' &&
      d1.section === '头条' && d1.league === 'NBA' &&
      d1.sourceName === 'Day 18 测试' && d1.status === 'published' &&
      typeof d1.createdAt === 'string' &&
      wb1.meta && wb1.meta.created === true,
      w1.status + ' id=' + d1.id + ' createdAt=' + d1.createdAt);
    const createdId = d1.id;

    // 重复 POST（同 sourceUrl）→ 返回已有记录，created:false
    const w2 = await request(PORT_FAV, 'POST', '/api/favorites', payload);
    const wb2 = safeParse(w2.body) || {};
    check('重复 POST（同 sourceUrl）→ 200 且 meta.created:false，id 与首次相同',
      w2.status === 200 && wb2.ok === true && wb2.meta && wb2.meta.created === false &&
      (wb2.data || {}).id === createdId,
      w2.status + ' created=' + (wb2.meta && wb2.meta.created) + ' id=' + ((wb2.data || {}).id));

    // 读回：GET /api/favorites 能找到刚写入的那条
    const g1 = await request(PORT_FAV, 'GET', '/api/favorites?limit=50');
    const gb1 = safeParse(g1.body) || {};
    const found = (gb1.data || []).filter(x => x.sourceUrl === url);
    check('GET /api/favorites 能读回刚写入的记录',
      g1.status === 200 && gb1.ok === true && found.length === 1 && found[0].id === createdId,
      g1.status + ' 命中 ' + found.length + ' 条');

    // 重复提交后，库里仍然只有一行
    check('重复提交未产生第二行（同 sourceUrl 仅 1 条）',
      found.length === 1, '命中 ' + found.length + ' 条（应为 1）');

    console.log('\n>>> 本次测试写入的记录 id = ' + createdId + '，sourceUrl = ' + url);
    console.log('>>> 清理：到 CloudBase 控制台 SQL 编辑器执行');
    console.log(">>> DELETE FROM public.news_items WHERE source_url = '" + url + "';");
  } else if (WITH_DB && !API_KEY) {
    console.log('\n!! --with-db 需要 .env 里的 CB_API_KEY，未读到，跳过连库用例');
  }

  console.log('\n===== 本地分支验证 =====');
  let allPass = true;
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '   → ' + r.detail);
    if (!r.pass) allPass = false;
  }
  console.log('\n结果：' + (allPass ? '全部通过 (' + results.length + '/' + results.length + ')' : '存在失败项'));

  children.forEach(c => c.kill());
  process.exit(allPass ? 0 : 1);
})();
