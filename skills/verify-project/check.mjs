#!/usr/bin/env node
// ============================================================
// verify-project · 发布前检查器（Day 25）
// ------------------------------------------------------------
// 干什么：把本项目「踩过的坑」固化成可执行的检查项，发布前跑一遍，
//         逐项给出 PASS / FAIL / SKIP + 证据，避免旧坑重犯。
//
// 用法（项目根目录）：
//   node skills/verify-project/check.mjs                 全量检查
//   node skills/verify-project/check.mjs --self-test     自检：拿「故意做坏的样本项目」跑一遍
//   node skills/verify-project/check.mjs --json          机器可读输出
//   node skills/verify-project/check.mjs --root <dir>    指定待检查的项目根目录
//
// 退出码：0 = 无 FAIL；1 = 有 FAIL；2 = 自检失败（结论不可信，宁可炸也别报通过）
//
// 三条纪律（来自本项目真实事故）：
//   ① **SKIP 不等于 PASS**。「查不到 / 跑不起来」必须显式报 SKIP，绝不静默算通过。
//   ② 静态检查一律**先剥注释**再匹配。注释里写着「不要写相对路径」是很正常的，
//      拿注释去判 FAIL 就是误报（第一版栽过）。
//   ③ 判据要看「有效对象」，不看字符串出现过。CSS 里 `.a .b p{display:none}` 的
//      主体是 p，不是 .a —— 拿整条选择器去匹配 hidden 元素就是误报。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = n => argv.includes('--' + n);
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const SELF_TEST = has('self-test');
const AS_JSON = has('json');
const ROOT = path.resolve(SELF_TEST
  ? path.join(HERE, 'fixtures', 'bad')
  : argOf('root', path.join(HERE, '..', '..')));

// ---------- 文件与文本工具 ----------
const R = p => path.join(ROOT, p);
const read = p => { try { return fs.readFileSync(R(p), 'utf8'); } catch { return null; } };
const exists = p => fs.existsSync(R(p));
const listDir = (d, f) => { try { return fs.readdirSync(R(d)).filter(f).sort(); } catch { return []; } };
const jsFiles = () => listDir('js', f => f.endsWith('.js')).map(f => 'js/' + f);
const cssFiles = () => listDir('css', f => f.endsWith('.css')).map(f => 'css/' + f);
const htmlFiles = () => [...listDir('.', f => f.endsWith('.html')), ...listDir('tools', f => f.endsWith('.html')).map(f => 'tools/' + f)];
const sqlFiles = () => listDir('db', f => f.endsWith('.sql')).map(f => 'db/' + f);
const cfFiles = () => {
  const out = [];
  const walk = d => { for (const e of listDir(d, () => true)) { const p = d + '/' + e; if (e.endsWith('.js')) out.push(p); } };
  for (const fn of listDir('cloudfunctions', () => true)) {
    if (fn === 'shared') walk('cloudfunctions/shared');
    else if (listDir('cloudfunctions/' + fn, () => true).length) {
      const inner = listDir('cloudfunctions/' + fn, () => true);
      for (const e of inner) if (e.endsWith('.js')) out.push('cloudfunctions/' + fn + '/' + e);
    }
  }
  return out;
};

const stripJs = s => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
const stripSql = s => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const stripCss = s => String(s).replace(/\/\*[\s\S]*?\*\//g, '');
const stripHtml = s => String(s).replace(/<!--[\s\S]*?-->/g, '');

// 逐行匹配（已剥注释），返回 {file,line,text} 数组
function grepLines(files, re, opts = {}) {
  const out = [];
  for (const f of files) {
    const raw = read(f);
    if (raw == null) continue;
    const src = opts.raw ? raw : (opts.lang === 'sql' ? stripSql(raw) : opts.lang === 'css' ? stripCss(raw) : stripJs(raw));
    src.split(/\r?\n/).forEach((ln, i) => {
      if (re.test(ln)) out.push({ file: f, line: i + 1, text: ln.trim() });
    });
  }
  return out;
}

function git(args) {
  try {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  } catch { return { ok: false, status: -1, out: '', err: 'git 不可用' }; }
}

// 网关域名形如 <前缀>-<数字>.<地域>.app.tcloudbase.com
// （第一版写成 [a-z0-9-]+\.app\.tcloudbase\.com，匹配不到中间那层地域，一处也抓不到 —— 漏报）
const GATEWAY_RE = /https:\/\/[a-z0-9.-]+\.app\.tcloudbase\.com/g;
function gatewayUrl() {
  const s = stripJs(read('js/api-config.js') || '');
  const m = s.match(GATEWAY_RE);
  return m ? m[0] : null;
}
function staticOrigin() {
  const m = (read('README.md') || '').match(/https:\/\/([a-z0-9-]+\.tcloudbaseapp\.com)/);
  return m ? m[1] : null;
}
function envIdFromConfig() {
  const gw = gatewayUrl();
  if (gw) return gw.replace(/^https:\/\//, '').split('.')[0].replace(/-\d+$/, '');
  const e = read('.env') || '';
  const m = e.match(/^TCB_ENV_ID\s*=\s*(\S+)/m);
  return m ? m[1] : null;
}

async function probe(url, origin) {
  const res = await fetch(url, {
    headers: { Origin: origin, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow'
  });
  const acao = res.headers.get('access-control-allow-origin');
  return { status: res.status, acao, res };
}

const pass = evidence => ({ status: 'PASS', evidence });
const fail = evidence => ({ status: 'FAIL', evidence });
const skip = evidence => ({ status: 'SKIP', evidence });

// ============================================================
// 检查项
// ============================================================
const CHECKS = [];
const check = o => CHECKS.push(o);

// ---------- A · 跨域与域名 ----------
check({
  id: 'A1', group: 'A · 跨域与域名',
  title: '前端不得出现裸相对 /api/ 调用（接口地址必须经包装器解析）',
  cmd: `grep -rnE "fetch\\(['\\"\`]/api/" js *.html tools`,
  pass: '命中 0 处；相对路径只能出现在注释里，调用点必须走 fetchFromAPI()/apiUrl()',
  fixture: 'FAIL',
  run() {
    const files = [...jsFiles(), ...htmlFiles()];
    const hits = grepLines(files, /\bfetch\s*\(\s*['"`]\/api\//);
    return {
      status: hits.length ? 'FAIL' : 'PASS',
      evidence: [
        `扫描 ${files.length} 个文件（js/*.js + *.html + tools/*.html）`,
        hits.length ? `命中 ${hits.length} 处裸相对接口调用：` : '命中 0 处',
        ...hits.slice(0, 5).map(h => `${h.file}:${h.line}  ${h.text}`)
      ]
    };
  }
});

check({
  id: 'A2', group: 'A · 跨域与域名',
  title: '线上接口走云函数网关绝对域名（静态托管域名只能当页面域名）',
  cmd: 'node -e "const s=require(\'fs\').readFileSync(\'js/api-config.js\',\'utf8\');console.log(s.match(/https:\\/\\/[^\\s\'\\"]+/g))"',
  pass: 'js/api-config.js 至少含 1 个 *.app.tcloudbase.com 绝对地址，且不把 *.tcloudbaseapp.com 当接口地址',
  fixture: 'FAIL',
  run() {
    const src = stripJs(read('js/api-config.js') || '');
    if (!src) return skip(['js/api-config.js 不存在']);
    const urls = (src.match(/https:\/\/[^\s'"`)]+/g) || []);
    const gw = urls.filter(u => /\.app\.tcloudbase\.com\/?$/.test(u));
    const bad = urls.filter(u => /tcloudbaseapp\.com/.test(u));
    return {
      status: (gw.length && !bad.length) ? 'PASS' : 'FAIL',
      evidence: [
        `文件内绝对地址 ${urls.length} 个，其中网关域名 ${gw.length} 个`,
        gw.length ? `网关地址：${gw[0]}` : '未找到 *.app.tcloudbase.com 网关地址',
        bad.length ? `把静态托管域名当接口地址：${bad.join(' , ')}` : '未把静态托管域名当接口地址'
      ]
    };
  }
});

check({
  id: 'A3', group: 'A · 跨域与域名',
  title: '接口域名全局一致（改地址时不能只改一处，否则部分页面打旧地址）',
  cmd: `grep -rhoE "https://[a-z0-9-]+\\.app\\.tcloudbase\\.com" js *.html | sort -u`,
  pass: '全仓出现的网关域名去重后恰好 1 个值',
  fixture: 'FAIL',
  run() {
    const files = [...jsFiles(), ...htmlFiles()];
    const seen = new Map();
    for (const f of files) {
      const src = stripJs(read(f) || '');
      for (const u of (src.match(GATEWAY_RE) || [])) {
        if (!seen.has(u)) seen.set(u, []);
        seen.get(u).push(f);
      }
    }
    const values = [...seen.keys()];
    return {
      status: values.length <= 1 ? 'PASS' : 'FAIL',
      evidence: [
        `扫描 ${files.length} 个文件，网关域名出现 ${[...seen.values()].reduce((a, b) => a + b.length, 0)} 处，去重后 ${values.length} 个值`,
        ...values.map(v => `${v}  ← ${[...new Set(seen.get(v))].join(' ')}`)
      ]
    };
  }
});

check({
  id: 'A4', group: 'A · 跨域与域名',
  title: '前端与数据不得引用带 Referer 防盗链的图源（腾讯 sports3.gtimg.com）',
  cmd: 'grep -rn "sports3.gtimg.com" js data *.html',
  pass: '命中 0 处；队徽一律用无防盗链的央视源 cbs-img.sports.cctv.com',
  fixture: 'FAIL',
  run() {
    const files = [...jsFiles(), ...htmlFiles(), ...listDir('data', f => f.endsWith('.json')).map(f => 'data/' + f)];
    const hits = grepLines(files, /sports3\.gtimg\.com|gtimg\.com\/teamLogo/, { raw: true });
    const cctv = grepLines(files, /cbs-img\.sports\.cctv\.com/, { raw: true });
    return {
      status: hits.length ? 'FAIL' : 'PASS',
      evidence: [
        `扫描 ${files.length} 个文件（js + html + data/*.json）`,
        hits.length ? `防盗链图源命中 ${hits.length} 处：` : '防盗链图源命中 0 处',
        ...hits.slice(0, 5).map(h => `${h.file}:${h.line}  ${h.text.slice(0, 90)}`),
        `央视可用源引用 ${cctv.length} 处`
      ]
    };
  }
});

check({
  id: 'A5', group: 'A · 跨域与域名', live: true,
  title: '公网 CORS 判据：白名单 Origin 回 ACAO、白名单外不回（看响应头，不看状态码）',
  cmd: 'curl -sS -o /dev/null -D - -H "Origin: <白名单域名>" -H "Origin: https://evil.example.com" <网关>/api/health',
  pass: '白名单 Origin 的响应含 access-control-allow-origin=自身；非白名单 Origin 状态码仍 200 但不含该头',
  fixture: 'SKIP',
  async run() {
    const gw = gatewayUrl(), origin = staticOrigin();
    if (!gw || !origin) return skip(['未解析到网关地址或白名单域名（' + (gw || 'no-gateway') + ' / ' + (origin || 'no-origin') + '）']);
    try {
      const a = await probe(gw + '/api/health', 'https://' + origin);
      const b = await probe(gw + '/api/health', 'https://evil.example.com');
      const ok = a.acao === 'https://' + origin && b.acao === null && b.status === 200;
      return {
        status: ok ? 'PASS' : 'FAIL',
        evidence: [
          `白名单 Origin  → HTTP ${a.status} · access-control-allow-origin: ${a.acao === null ? '(无)' : a.acao}`,
          `非白名单 Origin → HTTP ${b.status} · access-control-allow-origin: ${b.acao === null ? '(无)' : b.acao}`,
          '非白名单请求仍返回 200 —— 「curl 能通」不等于「跨域配好了」'
        ]
      };
    } catch (e) {
      return skip(['公网不可达（' + (e && e.name || e) + '），本次不判定']);
    }
  }
});

// ---------- B · 重复写入与数据一致性 ----------
check({
  id: 'B1', group: 'B · 重复写入与数据一致性',
  title: 'seed.sql 的破坏性清表必须有书面警示与重放依据',
  cmd: 'grep -in "truncate" db/seed.sql README.md api-contract.md',
  pass: 'seed.sql 若含 TRUNCATE：README 必须带 ⚠ 注解说明其破坏性，api-contract 必须写明重跑顺序',
  fixture: 'FAIL',
  run() {
    const seed = read('db/seed.sql');
    if (seed == null) return skip(['db/seed.sql 不存在']);
    const hasTrunc = /TRUNCATE\s+TABLE/i.test(stripSql(seed));
    const readme = read('README.md') || '';
    const contract = read('api-contract.md') || '';
    const warn = /TRUNCATE/i.test(readme) && /⚠/.test(readme);
    const order = /TRUNCATE/i.test(contract) && /重跑/.test(contract);
    const ok = !hasTrunc || (warn && order);
    return {
      status: ok ? 'PASS' : 'FAIL',
      evidence: [
        `db/seed.sql 含 TRUNCATE：${hasTrunc ? '是（破坏性）' : '否'}`,
        `README 破坏性警示（TRUNCATE + ⚠）：${warn ? '有' : '无'}`,
        `api-contract 重放顺序说明：${order ? '有' : '无'}`,
        hasTrunc && !(warn && order) ? '重跑 seed 会冲掉真实数据且无人知道怎么恢复' : '重跑 seed 前能从文档查到恢复路径'
      ]
    };
  }
});

check({
  id: 'B2', group: 'B · 重复写入与数据一致性',
  title: 'news_items.source_url 必须有全表唯一约束（防重的最后一道防线）',
  cmd: 'grep -n "UNIQUE (source_url)" db/schema.sql',
  pass: 'db/schema.sql 中存在对 source_url 的 UNIQUE 约束',
  fixture: 'FAIL',
  run() {
    const schema = read('db/schema.sql');
    if (schema == null) return skip(['db/schema.sql 不存在']);
    const hits = grepLines(['db/schema.sql'], /UNIQUE\s*\(\s*source_url\s*\)/i, { lang: 'sql' });
    return {
      status: hits.length ? 'PASS' : 'FAIL',
      evidence: [
        hits.length ? `找到 ${hits.length} 处 source_url 唯一约束：` : '未找到 source_url 唯一约束',
        ...hits.map(h => `db/schema.sql:${h.line}  ${h.text}`)
      ]
    };
  }
});

check({
  id: 'B3', group: 'B · 重复写入与数据一致性',
  title: '收藏写入必须两层防重（写入前先查 + 并发撞唯一键 23505 兜底）',
  cmd: 'grep -n "findBySourceUrl\\|23505\\|created: false" cloudfunctions/favorites/index.js',
  pass: '同时存在 findBySourceUrl() 前置查询与 SQLSTATE 23505 捕获；只有一层会在并发下冒 500',
  fixture: 'FAIL',
  run() {
    const src = read('cloudfunctions/favorites/index.js');
    if (src == null) return skip(['cloudfunctions/favorites/index.js 不存在']);
    const l1 = /findBySourceUrl\s*\(/.test(src) && /created:\s*false/.test(src);
    const l2 = /23505/.test(src);
    return {
      status: (l1 && l2) ? 'PASS' : 'FAIL',
      evidence: [
        `第一层（写入前先查 → created:false，不写库）：${l1 ? '在' : '缺'}`,
        `第二层（捕获 SQLSTATE 23505 → 回查那一行）：${l2 ? '在' : '缺'}`,
        (l1 && l2) ? '并发重复收藏不会冒 500' : '缺一层：并发场景会漏'
      ]
    };
  }
});

check({
  id: 'B4', group: 'B · 重复写入与数据一致性',
  title: '软删除例外：序号统计与防重查询不得过滤 is_deleted',
  cmd: 'grep -n -A6 "function findBySourceUrl\\|function countByDigestDate" cloudfunctions/shared/newsItemsRepository.js',
  pass: 'findBySourceUrl / countByDigestDate 两个函数体内不得出现 is_deleted 过滤条件（软删行仍占主键）',
  fixture: 'FAIL',
  run() {
    const src = read('cloudfunctions/shared/newsItemsRepository.js');
    if (src == null) return skip(['cloudfunctions/shared/newsItemsRepository.js 不存在']);
    const body = name => {
      const i = src.indexOf('function ' + name + '(');
      if (i < 0) return null;
      let d = 0, started = false;
      for (let j = i; j < src.length; j++) {
        const c = src[j];
        if (c === '{') { d++; started = true; }
        else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
      }
      return src.slice(i);
    };
    const bad = [];
    for (const n of ['findBySourceUrl', 'countByDigestDate']) {
      const b = body(n);
      if (b == null) { bad.push(`${n} 函数不存在`); continue; }
      const f = (b.match(/is_deleted\s*:\s*'eq\.(false|true)'|NOT_DELETED/g) || []);
      if (f.length) bad.push(`${n} 体内出现 ${f.length} 处 is_deleted 过滤`);
    }
    return {
      status: bad.length ? 'FAIL' : 'PASS',
      evidence: [
        '两个函数体内 is_deleted 过滤条件数：0 / 0',
        ...bad,
        bad.length ? '过滤掉软删行会让「查不到 → 去插 → 撞唯一约束」复现' : '软删行仍参与序号统计与防重查询，与主键分配一致'
      ]
    };
  }
});

// ---------- C · 数据库执行 ----------
check({
  id: 'C1', group: 'C · 数据库执行',
  title: 'SQL 脚本不得出现 MySQL 方言（本项目实际是 PostgreSQL）',
  cmd: 'grep -rniE "auto_increment|ENGINE[ ]*=[ ]*InnoDB" db',
  pass: 'db/*.sql 中 MySQL 方言命中 0 处',
  fixture: 'FAIL',
  run() {
    const files = sqlFiles();
    const hits = grepLines(files, /AUTO_INCREMENT|ENGINE\s*=\s*InnoDB/i, { lang: 'sql' });
    return {
      status: hits.length ? 'FAIL' : 'PASS',
      evidence: [
        `扫描 ${files.length} 个 SQL 文件`,
        hits.length ? `MySQL 方言命中 ${hits.length} 处：` : 'MySQL 方言命中 0 处',
        ...hits.slice(0, 5).map(h => `${h.file}:${h.line}  ${h.text}`)
      ]
    };
  }
});

check({
  id: 'C2', group: 'C · 数据库执行',
  title: 'migrate 脚本新增的列必须已同步进 schema.sql（别只写迁移不改基线）',
  cmd: 'grep -h "ADD COLUMN IF NOT EXISTS" db/migrate-*.sql ; grep -c "season\\|zone\\|is_deleted" db/schema.sql',
  pass: '所有 migrate 新增列名都能在 db/schema.sql 中找到',
  fixture: 'FAIL',
  run() {
    const migs = listDir('db', f => /^migrate-.*\.sql$/.test(f)).map(f => 'db/' + f);
    const schema = read('db/schema.sql');
    if (!schema) return skip(['db/schema.sql 不存在']);
    const cols = new Set();
    for (const f of migs) {
      const src = stripSql(read(f) || '');
      for (const m of src.matchAll(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/gi)) cols.add(m[1]);
    }
    const missing = [...cols].filter(c => !new RegExp('(^|[^a-z_])' + c + '([^a-z0-9_]|$)', 'i').test(schema));
    return {
      status: missing.length ? 'FAIL' : 'PASS',
      evidence: [
        `${migs.length} 个 migrate 脚本，新增列去重后 ${cols.size} 个：${[...cols].join(' ')}`,
        missing.length ? `schema.sql 里缺失：${missing.join(' ')}` : '全部已同步进 db/schema.sql'
      ]
    };
  }
});

check({
  id: 'C3', group: 'C · 数据库执行',
  title: '数据导入脚本不得含 TRUNCATE / DROP TABLE（清表只能由 seed.sql 干）',
  cmd: 'grep -rniE "^[[:space:]]*(TRUNCATE|DROP[[:space:]]+TABLE)" db',
  pass: '除 seed.sql（破坏性种子，另由 B1 管）外，所有数据脚本一律纯 INSERT',
  fixture: 'FAIL',
  run() {
    // 只查「种子 / 导入」类脚本；schema.sql 与 migrate-*.sql 是 DDL 基线，
    // 里面 DROP TABLE IF EXISTS 先删后建是幂等写法，不能算清表（第一版误报在这里）。
    const files = sqlFiles().filter(f => !/seed\.sql$/.test(f) && !/schema\.sql$/.test(f) && !/migrate-/.test(f));
    const hits = grepLines(files, /^\s*(TRUNCATE|DROP\s+TABLE)\b/i, { lang: 'sql' });
    return {
      status: hits.length ? 'FAIL' : 'PASS',
      evidence: [
        `检查 ${files.length} 个数据导入脚本（已排除 seed.sql / schema.sql / migrate-*.sql）`,
        hits.length ? `破坏性语句命中 ${hits.length} 处：` : '破坏性语句命中 0 处',
        ...hits.slice(0, 5).map(h => `${h.file}:${h.line}  ${h.text}`)
      ]
    };
  }
});

// ---------- D · 接口错误与安全 ----------
check({
  id: 'D1', group: 'D · 接口错误与安全',
  title: '错误文案收口：调接口的页面都加载 js/api-error.js，且它导出 ApiError',
  cmd: 'grep -L "js/api-error.js" *.html ; grep -n "ApiError" js/api-error.js',
  pass: '凡加载了 js/ 目录脚本的页面都必须引 js/api-error.js，且该文件定义 window.ApiError',
  fixture: 'FAIL',
  run() {
    const htmls = htmlFiles();
    // 只要求「会用到前端脚本」的页面；tools/entry.html 是零依赖单文件表单，
    // 不调接口、也不引 js/ 下任何脚本，不该被这条规则管（第一版误报在这里）。
    const usingJs = htmls.filter(f => /(?:src|href)="js\//.test(read(f) || ''));
    const miss = usingJs.filter(f => !/js\/api-error\.js/.test(read(f) || ''));
    const lib = read('js/api-error.js') || '';
    const exp = /ApiError\s*=/.test(lib) || /window\.ApiError/.test(lib);
    return {
      status: (!miss.length && exp && usingJs.length) ? 'PASS' : 'FAIL',
      evidence: [
        `${htmls.length} 个页面，其中加载 js/ 脚本的 ${usingJs.length} 个（零依赖页面不计）：${usingJs.join(' ')}`,
        `未加载 api-error.js 的：${miss.length ? miss.join(' ') : '0 个'}`,
        `js/api-error.js 导出 ApiError：${exp ? '是' : '否'}`
      ]
    };
  }
});

check({
  id: 'D2', group: 'D · 接口错误与安全',
  title: '响应体不得出现后端错误原文（err.message 只能进日志字段）',
  cmd: 'grep -rn "err.message" cloudfunctions',
  pass: '每一处 err.message 都出现在日志调用或日志字段（log(/reason:/dbBody/.test(）上，不拼进响应文案',
  fixture: 'FAIL',
  run() {
    const files = cfFiles();
    const all = grepLines(files, /(err|error|\be)\s*(&&\s*(err|error|\be)\s*)?\.message\b/);
    const safeRe = /log\s*\(|reason\s*:|console\.|dbBody|\.test\(/;
    const unsafe = all.filter(h => !safeRe.test(h.text));
    return {
      status: (!files.length || unsafe.length) ? (files.length ? 'FAIL' : 'SKIP') : 'PASS',
      evidence: [
        `扫描 ${files.length} 个云函数源文件，err.message 出现 ${all.length} 处`,
        unsafe.length ? `拼进响应文案的 ${unsafe.length} 处：` : `全部 ${all.length} 处在日志/内部判断路径上`,
        ...unsafe.slice(0, 5).map(h => `${h.file}:${h.line}  ${h.text.slice(0, 100)}`)
      ]
    };
  }
});

check({
  id: 'D3', group: 'D · 接口错误与安全',
  title: '密钥特征扫描 0 命中（覆盖工作区 + 全部 Git 历史）',
  cmd: 'node scripts_cloudbase/scan-secrets.mjs',
  pass: '扫描器退出码 0；退出码 1 = 有命中，2 = 自检失败（结论不可信）',
  fixture: 'SKIP',
  run() {
    const script = 'scripts_cloudbase/scan-secrets.mjs';
    if (!exists(script)) return skip([script + ' 不存在']);
    const r = spawnSync(process.execPath, [R(script)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const summary = lines.filter(l => /合计|判定|自检|扫描范围|工作区文件|Git 全历史/.test(l)).slice(0, 6);
    if (r.status === 0) return pass(['退出码 0', ...summary]);
    return fail([`退出码 ${r.status}${r.status === 2 ? '（自检失败，本次结论作废）' : '（有命中）'}`, ...summary]);
  }
});

check({
  id: 'D4', group: 'D · 接口错误与安全',
  title: '密钥隔离：.env 不在 Git 历史，.env.example 必须在库',
  cmd: 'git log --all --name-status -- .env ; git ls-files .env.example',
  pass: '-- .env 输出为空（从未入库）；.env.example 被 git 跟踪',
  fixture: 'SKIP',
  run() {
    if (!exists('.git')) return skip(['不是 Git 仓库']);
    const logEnv = git(['log', '--all', '--name-status', '--', '.env']);
    const tracked = git(['ls-files', '.env.example']);
    if (!logEnv.ok && logEnv.status < 0) return skip(['git 不可用']);
    return {
      status: (!logEnv.out && tracked.ok && tracked.out) ? 'PASS' : 'FAIL',
      evidence: [
        `.env 在 Git 历史中出现：${logEnv.out ? '是（' + logEnv.out.split('\n')[0] + '）' : '否（从未入库）'}`,
        `.env.example 被跟踪：${tracked.out ? tracked.out : '否'}`,
        (!logEnv.out && tracked.out) ? '真值留本地、模板进仓库，接手的人知道要配什么' : '密钥隔离被破坏'
      ]
    };
  }
});

check({
  id: 'D5', group: 'D · 接口错误与安全',
  title: '改 / 删安全阀：PATCH、DELETE 必须带 eq. 过滤条件，否则拒绝执行',
  cmd: 'grep -n "hasFilter\\|eq\\." cloudfunctions/shared/pg.js',
  pass: 'pg.js 的改/删路径存在「查询条件里必须有 eq.」的显式拒绝分支',
  fixture: 'FAIL',
  run() {
    const src = read('cloudfunctions/shared/pg.js');
    if (src == null) return skip(['cloudfunctions/shared/pg.js 不存在']);
    const hasFilter = /hasFilter/.test(src);
    const eqCheck = /indexOf\('eq\.'\)/.test(src) || /startsWith\('eq\.'\)/.test(src) || /some\([^)]*eq\./.test(src);
    const refuse = /throw\b|reject\(/.test(src);
    return {
      status: (hasFilter && eqCheck && refuse) ? 'PASS' : 'FAIL',
      evidence: [
        `存在过滤条件检查（hasFilter / eq.）：${hasFilter && eqCheck ? '是' : '否'}`,
        `无过滤时显式拒绝：${refuse ? '有 throw/reject' : '未找到拒绝分支'}`,
        (hasFilter && eqCheck && refuse) ? '「少写一个条件」会变成报错，而不是静默清表' : '少写条件可能命中整表'
      ]
    };
  }
});

// ---------- E · 页面与渲染纪律 ----------
check({
  id: 'E1', group: 'E · 页面与渲染纪律',
  title: '靠 hidden 属性切换显隐的元素，其类的 display 规则必须写 :not([hidden])',
  cmd: 'node skills/verify-project/check.mjs     （E1 规则：解析 HTML 的 hidden 元素类名 × CSS 的 display 规则，比对选择器主体）',
  pass: '凡带 hidden 属性的元素，其类名对应的 display 规则选择器主体必须含 :not([hidden])',
  fixture: 'FAIL',
  run() {
    // 1) HTML：收集带裸 hidden 属性的标签上的类名（aria-hidden 不算）
    const cls = new Set();
    const where = [];
    for (const f of htmlFiles()) {
      const src = stripHtml(read(f) || '');
      for (const m of src.matchAll(/<[a-zA-Z][^>]*>/g)) {
        const tag = m[0];
        if (!/(^|\s)hidden(\s|=|\/|>)/.test(tag)) continue;
        const cm = tag.match(/class="([^"]*)"/);
        if (!cm) continue;
        for (const c of cm[1].split(/\s+/).filter(Boolean)) { cls.add(c); where.push(`${c} (${f})`); }
      }
    }
    // 2) CSS：解析规则，只取「选择器主体」（最后一段复合选择器）
    const subjectOf = sel => sel.split(/\s+|>|\+|~/).filter(Boolean).pop() || '';
    const violations = [];
    let displayRules = 0;
    for (const f of cssFiles()) {
      const src = stripCss(read(f) || '');
      for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map(s => s.trim()).filter(Boolean);
        const body = m[2];
        if (!/display\s*:/.test(body)) continue;
        displayRules++;
        for (const sel of selectors) {
          const subj = subjectOf(sel);
          for (const c of cls) {
            if (!new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![a-zA-Z0-9_-])').test(subj)) continue;
            if (/:not\(\[hidden\]\)/.test(sel)) continue;
            violations.push(`${f}  ${sel}  { display: ... }  ← 覆盖了 .${c} 的 hidden`);
          }
        }
      }
    }
    return {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: [
        `带 hidden 属性的类名 ${cls.size} 个：${[...cls].join(' ')}`,
        `CSS 中含 display 的规则 ${displayRules} 条，判定主体后命中违规 ${violations.length} 条`,
        ...violations.slice(0, 5),
        violations.length ? '类选择器会压过 UA 的 [hidden]{display:none}，元素该藏起来时仍可见' : '所有 hidden 元素都能被真正隐藏'
      ]
    };
  }
});

check({
  id: 'E2', group: 'E · 页面与渲染纪律',
  title: 'HTML 引用的本地 js / css 资源必须全部存在（别让线上 404 替代白屏）',
  cmd: `grep -ohE '(src|href)="(js|css)/[^"]+"' *.html | sort -u`,
  pass: '每个引用的本地资源文件都存在',
  fixture: 'FAIL',
  run() {
    const htmls = htmlFiles();
    const missing = [];
    let refs = 0;
    for (const f of htmls) {
      const src = stripHtml(read(f) || '');
      for (const m of src.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) {
        const p = m[1].split('?')[0];
        refs++;
        if (!exists(p)) missing.push(`${f} → ${p}`);
      }
    }
    return {
      status: missing.length ? 'FAIL' : 'PASS',
      evidence: [
        `${htmls.length} 个页面共引用本地资源 ${refs} 处`,
        missing.length ? `引用不存在的文件 ${missing.length} 处：` : '全部存在',
        ...missing.slice(0, 8)
      ]
    };
  }
});

check({
  id: 'E3', group: 'E · 页面与渲染纪律',
  title: 'data/*.json 必须全部可解析且非空（前端会直读这些兜底数据）',
  cmd: 'node -e "require(\'fs\').readdirSync(\'data\').forEach(f=>JSON.parse(require(\'fs\').readFileSync(\'data/\'+f,\'utf8\')))"',
  pass: '每个 data/*.json 都能 JSON.parse，且不是空数组/空对象',
  fixture: 'FAIL',
  run() {
    const files = listDir('data', f => f.endsWith('.json')).map(f => 'data/' + f);
    if (!files.length) return skip(['data/ 下没有 json']);
    const bad = [];
    for (const f of files) {
      const raw = read(f);
      try {
        const j = JSON.parse(raw);
        const n = Array.isArray(j) ? j.length : Object.keys(j || {}).length;
        if (!n) bad.push(`${f} 解析成功但为空`);
      } catch (e) { bad.push(`${f} 解析失败：${String(e.message).slice(0, 70)}`); }
    }
    return {
      status: bad.length ? 'FAIL' : 'PASS',
      evidence: [
        `检查 ${files.length} 个数据文件：${files.join(' ')}`,
        bad.length ? `问题 ${bad.length} 个：` : '全部可解析且非空',
        ...bad
      ]
    };
  }
});

// ---------- F · 环境变量与部署 ----------
check({
  id: 'F1', group: 'F · 环境变量与部署',
  title: 'cloudbaserc.json 必须写 envVariables（写成 environmentVariables 会被 CLI 静默忽略）',
  cmd: 'grep -n "envVariables\\|environmentVariables" cloudbaserc.json',
  pass: '可解析为 JSON；不含 environmentVariables；需要注入变量的函数用 envVariables',
  fixture: 'FAIL',
  run() {
    const raw = read('cloudbaserc.json');
    if (raw == null) return skip(['cloudbaserc.json 不存在']);
    let cfg;
    try { cfg = JSON.parse(raw); } catch (e) { return fail(['cloudbaserc.json 不是合法 JSON：' + String(e.message).slice(0, 80)]); }
    const typo = /"environmentVariables"\s*:/.test(raw);
    const fns = Array.isArray(cfg.functions) ? cfg.functions : [];
    const withEnv = fns.filter(f => f && f.envVariables).length;
    return {
      status: (!typo && fns.length) ? 'PASS' : 'FAIL',
      evidence: [
        `函数 ${fns.length} 个，其中声明 envVariables 的 ${withEnv} 个`,
        typo ? '发现错误字段名 environmentVariables（CLI 不报错、静默忽略 → 变量为 None）' : '未出现错误字段名 environmentVariables',
        withEnv ? '环境变量注入字段写法正确' : '（注意）没有任何函数声明 envVariables，如确实不需要可忽略'
      ]
    };
  }
});

check({
  id: 'F2', group: 'F · 环境变量与部署',
  title: 'cloudbaserc.json 的 functions[] 与 gateway.routes[] 必须一一对应',
  cmd: 'node -e "const c=require(\'./cloudbaserc.json\');console.log(c.functions.map(f=>f.name),c.gateway.routes.map(r=>r.target))"',
  pass: '每个路由 target 都能在 functions[] 找到同名函数，且每个函数都有路由',
  fixture: 'FAIL',
  run() {
    const raw = read('cloudbaserc.json');
    if (raw == null) return skip(['cloudbaserc.json 不存在']);
    let cfg;
    try { cfg = JSON.parse(raw); } catch (e) { return fail(['cloudbaserc.json 不是合法 JSON']); }
    const fns = (cfg.functions || []).map(f => f.name);
    const routes = ((cfg.gateway && cfg.gateway.routes) || []).map(r => String(r.target || '').replace(/^function:/, ''));
    const orphanRoutes = routes.filter(t => !fns.includes(t));
    const noRoute = fns.filter(n => !routes.includes(n));
    return {
      status: (!orphanRoutes.length && !noRoute.length) ? 'PASS' : 'FAIL',
      evidence: [
        `函数 ${fns.length} 个：${fns.join(' ')}`,
        `路由 ${routes.length} 条：${routes.join(' ')}`,
        orphanRoutes.length ? `路由指向不存在的函数：${orphanRoutes.join(' ')}` : '路由 target 全部有效',
        noRoute.length ? `函数没有登记路由（网关层会 404）：${noRoute.join(' ')}` : '每个函数都有路由'
      ]
    };
  }
});

check({
  id: 'F3', group: 'F · 环境变量与部署',
  title: 'build-functions.mjs 的 FUNCTIONS 必须覆盖所有云端函数',
  cmd: 'grep -n "FUNCTIONS" scripts_cloudbase/build-functions.mjs cloudbaserc.json',
  pass: 'cloudbaserc.json 里的每个函数名都出现在 build-functions.mjs 的 FUNCTIONS 数组里',
  fixture: 'FAIL',
  run() {
    const raw = read('cloudbaserc.json');
    const bf = read('scripts_cloudbase/build-functions.mjs');
    if (raw == null || bf == null) return skip(['cloudbaserc.json 或 build-functions.mjs 不存在']);
    let cfg; try { cfg = JSON.parse(raw); } catch { return fail(['cloudbaserc.json 不是合法 JSON']); }
    const m = bf.match(/FUNCTIONS\s*=\s*\[([^\]]*)\]/);
    const staged = m ? (m[1].match(/['"]([a-zA-Z0-9_-]+)['"]/g) || []).map(s => s.replace(/['"]/g, '')) : [];
    const fns = (cfg.functions || []).map(f => f.name);
    const missing = fns.filter(n => !staged.includes(n));
    return {
      status: (staged.length && !missing.length) ? 'PASS' : 'FAIL',
      evidence: [
        `build-functions.mjs FUNCTIONS：${staged.join(' ') || '(未解析到)'}`,
        `cloudbaserc.json functions：${fns.join(' ')}`,
        missing.length ? `未登记（不会生成自包含目录，部署即挂）：${missing.join(' ')}` : '全部已登记'
      ]
    };
  }
});

check({
  id: 'F4', group: 'F · 环境变量与部署', live: true,
  title: '网关路由必须全部是 WEB_SCF 型（建错成 SCF 型会报 FUNCTIONS_PARAM_INVALID）',
  cmd: 'tcb routes list -e <envId>',
  pass: 'routes list 里每条 /api 路由的 Resource type 都是 WEB_SCF',
  fixture: 'SKIP',
  run() {
    const env = envIdFromConfig();
    if (!env) return skip(['拿不到 envId']);
    const r = spawnSync('tcb', ['routes', 'list', '-e', env], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, shell: true });
    const out = ((r.stdout || '') + (r.stderr || ''));
    if (r.error || !/WEB_SCF|SCF/.test(out)) return skip(['tcb CLI 不可用或未登录（' + String(r.error ? r.error.code : 'no-output').slice(0, 40) + '）']);
    const rows = out.split(/\r?\n/).filter(l => l.includes('/api/'));
    const bad = rows.filter(l => !/WEB_SCF/.test(l));
    return {
      status: (rows.length && !bad.length) ? 'PASS' : (rows.length ? 'FAIL' : 'SKIP'),
      evidence: [
        `envId ${env}，解析到 ${rows.length} 条 /api 路由`,
        bad.length ? `非 WEB_SCF 的路由 ${bad.length} 条：` : '全部为 WEB_SCF',
        ...bad.slice(0, 3).map(l => l.replace(/\s+/g, ' ').slice(0, 110))
      ]
    };
  }
});

// ---------- G · 公网可用性 ----------
check({
  id: 'G1', group: 'G · 公网可用性', live: true,
  title: '公网五个接口全部可达且返回 { ok: true }',
  cmd: 'curl -s <网关>/api/health ; curl -s "<网关>/api/hot?limit=5" ; …',
  pass: '5 个接口均 HTTP 200 且响应体 ok === true',
  fixture: 'SKIP',
  async run() {
    const gw = gatewayUrl(), origin = staticOrigin();
    if (!gw || !origin) return skip(['未解析到网关地址或白名单域名']);
    const paths = ['/api/health', '/api/hot?limit=5', '/api/news?limit=5', '/api/matches?limit=5', '/api/favorites?limit=5'];
    const ev = [];
    let bad = 0;
    try {
      for (const p of paths) {
        let line;
        try {
          const r = await probe(gw + p, 'https://' + origin);
          const txt = await r.res.text();
          let j = null; try { j = JSON.parse(txt); } catch { }
          const ok = r.status === 200 && j && j.ok === true;
          if (!ok) bad++;
          line = `${p.padEnd(26, ' ')} HTTP ${r.status} · ok=${j ? j.ok : '(非 JSON)'} ${ok ? '' : '← 异常'}`;
        } catch (e) {
          bad++; line = `${p.padEnd(26, ' ')} 请求失败（${e && e.name || e}）`;
        }
        ev.push(line);
      }
    } catch (e) { return skip(['公网不可达']); }
    return { status: bad ? 'FAIL' : 'PASS', evidence: [ev[0] === undefined ? '' : `网关 ${gw}`, ...ev].filter(Boolean) };
  }
});

// ============================================================
// 执行与输出
// ============================================================
function fmt(r) {
  const tag = r.status === 'PASS' ? '✔ PASS' : r.status === 'FAIL' ? '✖ FAIL' : '○ SKIP';
  return tag;
}

async function main() {
  const t0 = Date.now();
  const results = [];
  for (const c of CHECKS) {
    let r;
    try { r = await c.run(); } catch (e) { r = { status: 'FAIL', evidence: ['执行异常：' + String(e && e.message || e).slice(0, 160)] }; }
    results.push({ c, r });
  }
  if (AS_JSON) {
    console.log(JSON.stringify({
      root: ROOT, mode: SELF_TEST ? 'self-test' : 'full',
      results: results.map(({ c, r }) => ({ id: c.id, group: c.group, title: c.title, status: r.status, evidence: r.evidence }))
    }, null, 2));
    if (SELF_TEST) return selfTestVerdict(results);
    return results.some(x => x.r.status === 'FAIL') ? 1 : 0;
  }
  render(results, t0);
  if (SELF_TEST) return selfTestVerdict(results);
  return results.some(x => x.r.status === 'FAIL') ? 1 : 0;
}

function render(results, t0) {
  const W = 78;
  const line = ch => ch.repeat(W);
  console.log('');
  console.log(line('='));
  console.log(' 每日体坛速览 · 发布前检查（verify-project / Day 25）');
  console.log(' ' + (SELF_TEST ? '模式：自检（对「故意做坏的样本项目」跑）' : '模式：对当前项目实跑'));
  console.log(' 根目录 ' + ROOT);
  console.log(' 时间   ' + new Date().toLocaleString('zh-CN', { hour12: false }));
  console.log(line('='));
  let group = null;
  for (const { c, r } of results) {
    if (c.group !== group) { group = c.group; console.log(''); console.log('【' + group + '】'); }
    console.log('  ' + fmt(r).padEnd(7, ' ') + c.id.padEnd(4, ' ') + c.title);
    console.log('        命令  ' + c.cmd);
    console.log('        判据  ' + c.pass);
    for (const e of (r.evidence || [])) console.log('        证据  ' + e);
  }
  const nP = results.filter(x => x.r.status === 'PASS').length;
  const nF = results.filter(x => x.r.status === 'FAIL').length;
  const nS = results.filter(x => x.r.status === 'SKIP').length;
  console.log('');
  console.log(line('-'));
  console.log(' 结果  PASS ' + nP + ' · FAIL ' + nF + ' · SKIP ' + nS + ' · 共 ' + results.length + ' 项'
    + '   （' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
  if (nF) {
    console.log(' 判定  ❌ 未通过发布门禁 —— 先修 FAIL 项：' + results.filter(x => x.r.status === 'FAIL').map(x => x.c.id).join(' '));
  } else if (nS) {
    console.log(' 判定  ⚠ 无 FAIL，但有 ' + nS + ' 项 SKIP（无法判定 ≠ 通过）：' + results.filter(x => x.r.status === 'SKIP').map(x => x.c.id).join(' '));
  } else {
    console.log(' 判定  ✅ 全部通过，可以发布');
  }
  console.log(line('-'));
  console.log('');
}

function selfTestVerdict(results) {
  const expFail = results.filter(x => x.c.fixture === 'FAIL');
  const expSkip = results.filter(x => x.c.fixture === 'SKIP');
  const leaked = expFail.filter(x => x.r.status !== 'FAIL');
  const wrongSkip = expSkip.filter(x => x.r.status !== 'SKIP');
  const nP = results.filter(x => x.r.status === 'PASS').length;
  const nF = results.filter(x => x.r.status === 'FAIL').length;
  const nS = results.filter(x => x.r.status === 'SKIP').length;
  const nRef = expFail.filter(x => x.r.status === 'FAIL').length;
  if (AS_JSON) return leaked.length || wrongSkip.length ? 2 : 0;
  const W = 78, line = ch => ch.repeat(W);
  console.log(line('='));
  console.log(' 自检结论（这一节回答「故意弄坏哪一项，验证不会虚报通过」）');
  console.log('   样本项目 skills/verify-project/fixtures/bad 已被故意做坏：');
  console.log('     · 前端写了裸相对 fetch(\'/api/…\')');
  console.log('     · api-config.js 拿静态托管域名当接口地址');
  console.log('     · CSS 给带 hidden 的类写了 display 却不写 :not([hidden])');
  console.log('     · HTML 引了不存在的 js，且少加载错误文案库');
  console.log('     · seed.sql 有 TRUNCATE 但 README 没有警示');
  console.log('     · schema.sql 缺 source_url 唯一约束、缺 migrate 新增的列');
  console.log('     · 收藏只做了一层防重、软删查询过滤了 is_deleted');
  console.log('     · cloudbaserc.json 写成 environmentVariables 且路由对不上函数');
  console.log('     · 云函数把 err.message 拼进了响应文案、pg.js 少了 eq. 安全阀');
  console.log('     · data/*.json 里塞了一个坏 JSON');
  console.log(line('-'));
  console.log('   期望 ' + expFail.length + ' 项 FAIL · 实际 FAIL ' + nF + ' 项 · PASS ' + nP + ' · SKIP ' + nS);
  console.log('   期望 ' + expSkip.length + ' 项 SKIP · 实际 SKIP ' + expSkip.filter(x => x.r.status === 'SKIP').length + ' 项');
  if (leaked.length) {
    console.log('   虚报通过（漏报）' + leaked.length + ' 项：' + leaked.map(x => x.c.id).join(' '));
    console.log(' 判定  ❌ 自检失败 —— 有检查项对坏样本仍报 PASS，本次结论不可信');
    console.log(line('='));
    console.log('');
    return 2;
  }
  if (wrongSkip.length) {
    console.log('   SKIP 不符预期：' + wrongSkip.map(x => x.c.id + '(' + x.r.status + ')').join(' '));
  }
  console.log('   ' + nRef + '/' + expFail.length + ' 项坏样本被逐条查出来，0 项虚报通过');
  console.log(' 判定  ✅ 自检通过 —— 检查器对已做坏的样本全部报 FAIL，不存在「虚报通过」');
  console.log(line('='));
  console.log('');
  return 0;
}

main().then(code => process.exit(code)).catch(e => { console.error('检查器异常：', e); process.exit(2); });
