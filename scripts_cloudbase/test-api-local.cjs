// ============================================================
// 本地验证云函数的分支逻辑（Day 17 建，Day 18 扩收藏线）
//
// 用法：
//   node scripts_cloudbase/test-api-local.cjs            # 只跑不连库的分支（默认，快）
//   node scripts_cloudbase/test-api-local.cjs --with-db  # 额外跑真连库的 写入/重复/读回
//
// 说明（Day 18 架构）：
//   /api/hot       → cloudfunctions/api       （读热搜）
//   /api/favorites → cloudfunctions/favorites （收藏线，POST 写 + GET 读）
//   两个路由各一个函数，因此本脚本要分别起两个进程来测。
// ============================================================
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const PORT_API = 9101;        // api 函数（hot）
const PORT_FAV = 9102;        // favorites 函数（收藏）
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

function startFn(name, port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'cloudfunctions', name, 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), CB_API_KEY: API_KEY }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => process.stdout.write('[' + name + '] ' + d));
  child.stderr.on('data', d => process.stdout.write('[' + name + '!] ' + d));
  return child;
}

const apiChild = startFn('api', PORT_API);
const favChild = startFn('favorites', PORT_FAV);

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

// 生成一个不会撞库的唯一 URL（按时间戳）
function uniqUrl() {
  return 'https://example.com/day18-test-' + Date.now();
}

(async () => {
  await new Promise(r => setTimeout(r, 900));
  const results = [];
  const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

  // ================= 第一组：hot（不连库分支） =================

  const r1 = await request(PORT_API, 'GET', '/api/hot?platform=weibo');
  const b1 = safeParse(r1.body) || {};
  check('GET /api/hot?platform=weibo → 400 BAD_REQUEST',
    r1.status === 400 && b1.error && b1.error.code === 'BAD_REQUEST',
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
  const m2 = (fb2.error && fb2.error.message) || '';
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
  const m3 = (fb3.error && fb3.error.message) || '';
  check('缺 sourceUrl → 400 且只点名 sourceUrl',
    f3.status === 400 && /缺少必填字段/.test(m3) && /sourceUrl/.test(m3) && !/title/.test(m3),
    f3.status + ' ' + m3.slice(0, 160));

  // 日期格式错 → 400 且提示正确格式
  const f4 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026/10/06'
  });
  const fb4 = safeParse(f4.body) || {};
  const m4 = (fb4.error && fb4.error.message) || '';
  check('digestDate 格式错 → 400 且提示 YYYY-MM-DD',
    f4.status === 400 && /digestDate/.test(m4) && /YYYY-MM-DD/.test(m4),
    f4.status + ' ' + m4.slice(0, 160));

  // 不存在的日期（2026-02-30）→ 400
  const f4b = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026-02-30'
  });
  const fb4b = safeParse(f4b.body) || {};
  const m4b = (fb4b.error && fb4b.error.message) || '';
  check('digestDate 为不存在的日期 → 400',
    f4b.status === 400 && /不是有效日期/.test(m4b),
    f4b.status + ' ' + m4b.slice(0, 140));

  // section 非白名单 → 400 且列出允许值
  const f5 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '不存在的板块', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'https://example.com/x', digestDate: '2026-10-06'
  });
  const fb5 = safeParse(f5.body) || {};
  const m5 = (fb5.error && fb5.error.message) || '';
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
  const m6 = (fb6.error && fb6.error.message) || '';
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
  const m7 = (fb7.error && fb7.error.message) || '';
  check('summary 超 60 字 → 400',
    f7.status === 400 && /summary/.test(m7) && /60/.test(m7),
    f7.status + ' ' + m7.slice(0, 160));

  // sourceUrl 非 http(s) → 400
  const f8 = await request(PORT_FAV, 'POST', '/api/favorites', {
    title: '测试标题', summary: '测试摘要', section: '头条', league: 'NBA',
    sourceName: '测试来源', sourceUrl: 'ftp://example.com/x', digestDate: '2026-10-06'
  });
  const fb8 = safeParse(f8.body) || {};
  const m8 = (fb8.error && fb8.error.message) || '';
  check('sourceUrl 非 http(s) → 400',
    f8.status === 400 && /sourceUrl/.test(m8),
    f8.status + ' ' + m8.slice(0, 150));

  // body 非合法 JSON → 400
  const f9 = await request(PORT_FAV, 'POST', '/api/favorites', '{ this is not json');
  const fb9 = safeParse(f9.body) || {};
  check('POST body 非合法 JSON → 400',
    f9.status === 400 && fb9.error && /JSON/.test(fb9.error.message),
    f9.status + ' ' + ((fb9.error && fb9.error.message) || '').slice(0, 120));

  // 校验通过、但服务端没 Key → 500 且中文说明（证明「校验在连库之前」）
  if (!WITH_DB) {
    const f10 = await request(PORT_FAV, 'POST', '/api/favorites', {
      title: '合法标题', summary: '合法摘要，含背景与后续安排。', section: '头条', league: 'NBA',
      sourceName: '测试来源', sourceUrl: 'https://example.com/valid-no-key', digestDate: '2026-10-06'
    });
    const fb10 = safeParse(f10.body) || {};
    check('校验通过但无 API Key → 500 且中文说明',
      f10.status === 500 && fb10.ok === false && /API Key/.test((fb10.error && fb10.error.message) || ''),
      f10.status + ' ' + ((fb10.error && fb10.error.message) || '').slice(0, 120));
  }

  // ================= 第三组：真连库（--with-db 才跑） =================
  if (WITH_DB && API_KEY) {
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

  apiChild.kill();
  favChild.kill();
  process.exit(allPass ? 0 : 1);
})();
