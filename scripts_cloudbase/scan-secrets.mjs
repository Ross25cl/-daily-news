// ============================================================
// scripts_cloudbase/scan-secrets.mjs — 仓库密钥特征扫描（Day 23 建）
// ------------------------------------------------------------
// 一件事：确认「真实凭据的值」没有出现在仓库里 —— 包括**全部 Git 历史**。
//
// 为什么单独写个脚本，而不是每次手敲 grep：
//   ① 特征要成体系（JWT / GitHub token / 云厂商 AK / 私钥 / 硬编码口令…），
//      手敲记不全，漏一条就等于没扫；
//   ② 「历史上提交过、后来删掉了」是最容易被忽略的一类泄漏 —— 删文件不等于
//      删记录，旧的 blob 还在 .git 里。本脚本把每个提交的每个版本都过一遍；
//   ③ 退出码可以接 CI / 提交前钩子：命中就非 0 退出。
//
// 用法（项目根目录）：
//   node scripts_cloudbase/scan-secrets.mjs
//
// 退出码：0 = 干净；1 = 有命中；2 = 自检失败（结论不可信，宁可炸也别报 0）
//
// ⚠️ 扫描的是「值」不是「变量名」：
//   CB_API_KEY=xxx 这种**声明**是正常的、必须存在的（cloudbaserc.json 里的
//   {{env.CB_API_KEY}} 就是这么用的）。真正要拦的是「值」——
//   一段看起来就是密钥本身的字符串。所以下面的规则全部按值的形态写。
//
// ⚠️ 两条防「假 0 条」的自检（写这个脚本时踩过）：
//   ① 正则必须同时满足两套引擎：JS 的 RegExp（扫工作区）和 POSIX ERE
//      （git grep 用的是 ERE，不支持 (?:…) 和 \s —— 第一版就栽在这，
//       git grep 直接 fatal，而错误被当成「没命中」吞了，输出一个假的 0）。
//       → 每条规则都带一个 sample，跑之前先验证「这条规则真的能命中它」。
//   ② 历史扫描之外再跑一个控制查询（找一个必然存在的字符），
//      控制查询返回空就说明 git grep 这条路本身不通 → 退出码 2，不下结论。
// ============================================================

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 不用 execFileSync：要区分「退出码 1 = 没命中」和「其它非 0 = 真出错」
function gitRaw(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function gitOk(args) {
  const r = gitRaw(args);
  if (r.status !== 0) throw new Error('git ' + args.slice(0, 3).join(' ') + ' 失败：' + r.stderr.trim());
  return r.stdout;
}

// ---------- 特征规则（值级） ----------
// re     ：JS 用（扫工作区文件内容）
// gre    ：git grep 用（POSIX ERE；不要出现 (?:…) 与 \s，用 (…) 和 [[:space:]]）
// sample ：必须能被 re 命中，用作规则自检
//
// ⚠️ sample 一律**拆成两段拼接**（`'eyJ' + 'hbGci…'`），且拆分点故意落在
//    「特征前缀」与「后续 10 个字符」之间 —— 否则这个自检样例本身就是一段
//    形似密钥的字符串，会被本扫描器自己命中（第一版就是这样自己报了 11 条 HIT）。
//    拼接后的运行时值仍是完整的样例，自检照样成立。
const RULES = [
  {
    name: 'JWT / CloudBase API Key',
    re: /eyJ[A-Za-z0-9_-]{10,}/g, gre: 'eyJ[A-Za-z0-9_-]{10,}',
    sample: 'eyJ' + 'hbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9'
  },
  {
    name: 'GitHub 令牌',
    re: /gh[pousr]_[A-Za-z0-9]{20,}/g, gre: 'gh[pousr]_[A-Za-z0-9]{20,}',
    sample: 'gh' + 'o_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  },
  {
    name: 'OpenAI 风格 Key',
    re: /sk-[A-Za-z0-9]{16,}/g, gre: 'sk-[A-Za-z0-9]{16,}',
    sample: 'sk' + '-abcdefghijklmnop123456'
  },
  {
    name: '腾讯云 SecretId',
    re: /AKID[A-Za-z0-9]{10,}/g, gre: 'AKID[A-Za-z0-9]{10,}',
    sample: 'AK' + 'IDabcdefghij1234567890'
  },
  {
    name: '阿里云 AccessKeyId',
    re: /LTAI[A-Za-z0-9]{12,}/g, gre: 'LTAI[A-Za-z0-9]{12,}',
    sample: 'LT' + 'AIabcdefghijklmnop'
  },
  {
    name: 'Slack 令牌',
    re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, gre: 'xox[baprs]-[A-Za-z0-9-]{10,}',
    sample: 'xox' + 'b-123456789012-abcdefghij'
  },
  {
    name: 'OpenSSH/PKCS 私钥块',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, gre: '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    sample: '-----BEGIN RSA ' + 'PRIVATE KEY-----'
  },
  {
    name: '硬编码 Bearer 令牌',
    re: /Bearer [A-Za-z0-9._-]{24,}/g, gre: 'Bearer [A-Za-z0-9._-]{24,}',
    sample: 'Bearer ' + 'abcdefghijklmnopqrstuvwxyz0123456789'
  },
  {
    name: '硬编码口令赋值',
    re: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi,
    gre: "(password|passwd|pwd|secret)[[:space:]]*[:=][[:space:]]*['\"][^'\"[:space:]]{8,}['\"]",
    sample: "password = '" + "abcd1234efgh'"
  }
];

// 只跳过**已知的二进制**扩展名（黑名单），其余一律当文本扫。
//
// ⚠️ 这里原本是「文本扩展名白名单」，Day 23 复查时发现它会**静默漏文件**：
//    仓库里的 4 个 .py 不在白名单内，被当成非文本跳过 —— 而 .py 里完全可能
//    写死连接串或密钥。会漏文件的密钥扫描器比没有还危险（它给你一个假的 0）。
//    现在的规则是：只有明确知道是二进制的才跳过，认不出来的一律扫，宁可多扫。
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.zip', '.gz', '.tgz', '.7z',
  '.rar', '.pdf', '.mp3', '.mp4', '.mov', '.webm', '.wasm', '.exe', '.dll',
  '.so', '.dylib', '.class', '.jar', '.psd', '.ai'
]);

// 掩码：命中内容不原样打印（免得日志本身变成第二份泄漏）
function mask(s) {
  const v = String(s);
  if (v.length <= 12) return v.slice(0, 3) + '***';
  return v.slice(0, 6) + '…' + v.slice(-4) + '（共 ' + v.length + ' 字符，已掩码）';
}

// 只有「已知二进制扩展名」才跳过；其余（含无扩展名、含没见过的扩展名）都要扫。
// 这样新增一种文本文件时不会悄悄漏掉 —— 漏掉是沉默的，多扫只是多花几毫秒。
function isBinary(file) {
  return BINARY_EXT.has(extname(file).toLowerCase());
}
const binarySkipped = [];

// ============================================================
// 第 0 步：规则自检 —— 一条规则如果连自己的样例都命不中，它就是废的
// ============================================================
const failedRules = RULES.filter(r => {
  r.re.lastIndex = 0;
  return !r.re.test(r.sample);
});
if (failedRules.length) {
  console.log('规则自检失败：' + failedRules.map(r => r.name).join('、'));
  process.exit(2);
}

// ============================================================
// 第 1 步：工作区（受控文件 + 未忽略的待提交文件）
// ============================================================
// --exclude-standard 会让 .gitignore 生效 → .env 天然不在扫描范围内。
const files = gitOk(['ls-files', '--cached', '--others', '--exclude-standard'])
  .split('\n').map(s => s.trim()).filter(Boolean);

const hits = [];
const skipped = [];
for (const f of files) {
  if (isBinary(f)) { binarySkipped.push(f); continue; }
  let st;
  try { st = statSync(resolve(ROOT, f)); } catch (e) { continue; }
  if (!st.isFile() || st.size > 4 * 1024 * 1024) { skipped.push(f); continue; }
  // 按 latin1 读字节：即使文件不是 UTF-8 文本，正则也能在字节上跑，
  // 不会因为解码失败把整篇内容吞掉（规则全是 ASCII 形态，不受影响）。
  const text = readFileSync(resolve(ROOT, f), 'latin1');
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      hits.push({ rule: rule.name, where: f, sample: mask(m[0]) });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }
}

// ============================================================
// 第 2 步：Git 全历史（每个提交的每个版本）
// ============================================================
const revs = gitOk(['rev-list', '--all']).split('\n').map(s => s.trim()).filter(Boolean);
if (!revs.length) { console.log('拿不到任何提交，历史扫描不可信'); process.exit(2); }

// 2.0 控制查询：找一个必然存在的字符（数字）。它要是 0 命中，
//     说明 git grep 这条路本身不通 —— 此时「0 条」是假结论，必须炸。
const control = gitRaw(['grep', '-l', '-E', '-e', '[0-9]'].concat(revs));
if (control.status !== 0 || !control.stdout.trim()) {
  console.log('自检失败：控制查询（数字字符）在历史里 0 命中 —— git grep 没跑通，本次结论作废');
  console.log('stderr: ' + control.stderr.trim().slice(0, 300));
  process.exit(2);
}

// 2.1 逐条规则扫历史。**退出码 2 以上一定要抛**，
//     不能像第一版那样把 fatal 当成「没命中」吞掉。
const histByRule = {};
for (const rule of RULES) {
  // -e 把模式与选项分开：私钥规则的模式以 '-' 开头，不加 -e 会被当成命令行选项
  const r = gitRaw(['grep', '-n', '-I', '-i', '-E', '-e', rule.gre].concat(revs));
  if (r.status === 0) histByRule[rule.name] = r.stdout.split('\n').filter(Boolean);
  else if (r.status === 1) histByRule[rule.name] = [];        // 退出码 1 = 真的没命中
  else throw new Error('git grep [' + rule.name + '] 出错（退出码 ' + r.status + '）：' + r.stderr.trim());
}

// ============================================================
// 输出
// ============================================================
const rulePad = 24;
console.log('');
console.log('==========================================================');
console.log(' 每日体坛速览 · 密钥特征扫描（Day 23）');
console.log('==========================================================');
console.log(' 扫描范围');
console.log('   · 工作区文件（受控 + 未忽略待提交）：' + files.length + ' 个');
console.log('   · Git 全历史：' + revs.length + ' 个提交的每个版本');
console.log('   · 已排除（.gitignore 生效）：.env / node_modules / .cloudbase-* / _day*_tmp');
console.log('   · 已知二进制跳过：' + binarySkipped.length + ' 个' +
  (binarySkipped.length ? '（' + [...new Set(binarySkipped.map(f => extname(f).toLowerCase()))].join(' ') + '）' : ''));
if (skipped.length) console.log('   · ⚠️ 因体积/读取问题跳过：' + skipped.length + ' 个 → ' + skipped.slice(0, 5).join(' '));
console.log('');
console.log(' 自检');
console.log('   · 规则自检：' + RULES.length + '/' + RULES.length + ' 条规则能命中自己的样例');
console.log('   · 控制查询：git grep 在历史里确实能命中（数字字符 ≥1 个文件）');
console.log('     → 说明「历史里 0 命中」是真的没有，不是命令没跑起来');
console.log('');
console.log(' 扫描结果');
let totalWork = 0, totalHist = 0;
for (const r of RULES) {
  const nw = hits.filter(h => h.rule === r.name).length;
  const nh = (histByRule[r.name] || []).length;
  totalWork += nw; totalHist += nh;
  const clean = (nw + nh) === 0;
  console.log('   ' + (clean ? 'OK ' : 'HIT') + ' ' + r.name.padEnd(rulePad, ' ') +
    ' 工作区 ' + nw + ' 条 · 历史 ' + nh + ' 行');
}
console.log('   ' + '-'.repeat(58));
console.log('   合计：工作区 ' + totalWork + ' 条 · 历史 ' + totalHist + ' 行');
console.log('');

if (totalWork || totalHist) {
  console.log(' 命中明细（已掩码）：');
  hits.slice(0, 20).forEach(h => console.log('   · [工作区] [' + h.rule + '] ' + h.where + ' → ' + h.sample));
  Object.keys(histByRule).forEach(k => {
    histByRule[k].slice(0, 20).forEach(l => console.log('   · [历史] [' + k + '] ' + l.slice(0, 130)));
  });
  console.log('');
  console.log('判定：❌ 有命中 —— 逐条确认是不是真实凭据。');
  console.log('      一旦是真实凭据：先**作废并重新生成**，再去改代码。只删代码等于没改，');
  console.log('      旧 blob 仍在 .git 里，任何拿到仓库的人都能翻出来。');
  process.exit(1);
}

console.log('判定：✅ 干净 —— 工作区与全部 Git 历史里都没有真实凭据的值');
console.log('      （.env 里当然有真 Key，但它被 .gitignore 拦在仓库之外，本次扫描天然看不到它）');
console.log('');
process.exit(0);
