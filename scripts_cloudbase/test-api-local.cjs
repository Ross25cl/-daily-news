// 本地验证 api 云函数的分支逻辑（Day 17）
// 用 Node 原生 http 起服务、打真实请求，断言各分支返回是否符合契约
// 用法：node scripts_cloudbase/test-api-local.cjs
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9101;

// 用假 Key 起函数（只验参数校验/路由分支，不真连库）
const child = spawn(process.execPath, [path.join(ROOT, 'cloudfunctions', 'api', 'index.js')], {
  env: Object.assign({}, process.env, { PORT: String(PORT), CB_API_KEY: '' }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => process.stdout.write('[fn] ' + d));
child.stderr.on('data', d => process.stdout.write('[fn!] ' + d));

function get(pathname) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET' }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', e => resolve({ status: 0, body: String(e.message) }));
    req.end();
  });
}

function post(pathname) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'POST' }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', e => resolve({ status: 0, body: String(e.message) }));
    req.end();
  });
}

// 安全解析：服务没起来时 body 是错误文本，不能让 JSON.parse 抛异常打断整个测试
function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

(async () => {
  await new Promise(r => setTimeout(r, 700));
  const results = [];
  const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

  // 1. 非白名单 platform → 400 BAD_REQUEST（不碰数据库，本地可验）
  const r1 = await get('/api/hot?platform=weibo');
  check('platform 非白名单 → 400 BAD_REQUEST',
    r1.status === 400 && (safeParse(r1.body) || {}).error && safeParse(r1.body).error.code === 'BAD_REQUEST',
    r1.status + ' ' + r1.body.replace(/\s+/g, ' ').slice(0, 120));

  // 2. 未知路径 → 404 NOT_FOUND
  const r2 = await get('/api/nope');
  check('未知路径 → 404 NOT_FOUND',
    r2.status === 404 && (safeParse(r2.body) || {}).error && safeParse(r2.body).error.code === 'NOT_FOUND', r2.status);

  // 3. POST → 405 METHOD_NOT_ALLOWED
  const r3 = await post('/api/hot');
  check('POST → 405 METHOD_NOT_ALLOWED',
    r3.status === 405 && (safeParse(r3.body) || {}).error && safeParse(r3.body).error.code === 'METHOD_NOT_ALLOWED', r3.status);

  // 4. 合法请求但没 Key → 500 INTERNAL_ERROR，且错误说明是中文可读
  const r4 = await get('/api/hot?platform=hupu&limit=3');
  const b4 = safeParse(r4.body);
  check('无 API Key 时合法请求 → 500 且中文说明',
    r4.status === 500 && b4 && b4.ok === false && /API Key/.test(b4.error.message),
    r4.status + ' ' + (b4 ? b4.error.message : r4.body.slice(0, 120)));

  // 5. limit 非法值被兜底（仍走到查库，同样是 500，但不应 400）
  const r5 = await get('/api/hot?limit=abc');
  check('limit 非法值被兜底（不报 400）', r5.status === 500, r5.status);

  console.log('\n===== 本地分支验证 =====');
  let allPass = true;
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '   → ' + r.detail);
    if (!r.pass) allPass = false;
  }
  console.log('\n结果：' + (allPass ? '全部通过 (' + results.length + '/' + results.length + ')' : '存在失败项'));

  child.kill();
  process.exit(allPass ? 0 : 1);
})();
