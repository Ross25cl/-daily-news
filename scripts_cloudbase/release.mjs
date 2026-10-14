#!/usr/bin/env node
// ============================================================
// release.mjs — 发布 / 回退的确定性工具（Day 26 建，Day 27 修订上传范围）
// ------------------------------------------------------------
// Day 27 修订（上传目录排除）：
//   v1.0 发上去之后实测发现，公网可直接读到站点根目录下的
//   release.json / manifest.sha256（内容只有版本号、提交短 SHA、文件数，
//   **不含任何密钥**，但它们是"发布内部账本"，本就该只留本机）。
//   原因：deploy 上传的是整个 .releases/<版本>/，而这两份文件正是写在那里面的。
//   现在 deploy 改为「按清单摆一份上传目录，只传清单里列出的站点文件」——
//   结构上排除，不靠人记得删。详见 stageForDeploy()。
// 为什么需要它：CloudBase 的静态托管**没有版本管理**
//   （`tcb hosting deploy --help` 原文：file upload only, no build,
//    no version management）。所以「回退到上一版」这件事，产品本身
//   不提供，只能靠我们自己把「每一版的产物」存下来、再传回去。
//   这个脚本就是那条路径的可执行化。
//
// 它做三件事：
//   snapshot <版本>  —— 构建这一版的发布产物 + 逐文件 sha256 清单
//   verify   <版本>  —— 把线上文件拉回来，与快照逐字节比对
//   deploy   <版本>  —— 先校验快照完整（对比 manifest），再上传到静态托管
//
// 用法（项目根目录）：
//   node scripts_cloudbase/release.mjs snapshot v1.0
//   node scripts_cloudbase/release.mjs verify   v1.0
//   node scripts_cloudbase/release.mjs deploy   v1.0
//   node scripts_cloudbase/release.mjs deploy   v0.9 --prune   # 连线上多余文件一起清掉
//   node scripts_cloudbase/release.mjs list
//
// 环境 ID 取值顺序： 命令行 --env-id  >  环境变量 TCB_ENV_ID  >  .env 里的 TCB_ENV_ID
//
// 设计纪律（和 skills/verify-project 同一套）：
//   1) 先自检再下结论：快照自身坏了（缺文件 / 哈希不符）就拒绝部署，不给假的成功。
//   2) 不猜：线上取不到、清单对不上，一律显式报错并以非 0 退出。
// ============================================================

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, resolve, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISH_DIR = join(ROOT, '.cloudbase-publish');
const RELEASES_DIR = join(ROOT, '.releases');

// 站点文件 = 这些目录 + 根目录的 *.html（与 build-publish.mjs 保持一致）
const SITE_DIRS = ['css', 'js', 'data'];

// 发布元数据：只留本机（.releases/<版本>/ 里留档），**永远不上传**
const META_FILES = ['manifest.sha256', 'release.json'];

function die(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

function readEnvId(argv) {
  const i = argv.indexOf('--env-id');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (process.env.TCB_ENV_ID) return process.env.TCB_ENV_ID;
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*TCB_ENV_ID\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  die('拿不到 TCB_ENV_ID：请用 --env-id 传入，或在环境变量 / .env 里配置');
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// 递归列出目录下所有文件，返回相对路径（posix 风格，排序）
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

function releaseDir(version) {
  return join(RELEASES_DIR, version);
}

function isMeta(rel) {
  return META_FILES.includes(rel);
}

// ---------------------------------------------------------------
// stageForDeploy：把「这一次要上传的东西」单独摆成一份目录
//   —— 上传范围 = 清单里列出的站点文件，一个不多一个不少。
//   这样 release.json / manifest.sha256 这类发布账本天然不会被传上去，
//   也不需要谁记得在删除步骤里补一刀。
//   （.cloudbase-publish/ 本来就是可重建的临时目录，已在 .gitignore）
// ---------------------------------------------------------------
function stageForDeploy(version, manifest) {
  const dir = releaseDir(version);
  rmSync(PUBLISH_DIR, { recursive: true, force: true });
  mkdirSync(PUBLISH_DIR, { recursive: true });
  for (const rel of manifest.keys()) {
    const dst = join(PUBLISH_DIR, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(dir, rel), dst);
  }
  return PUBLISH_DIR;
}

function readManifest(version) {
  const p = join(releaseDir(version), 'manifest.sha256');
  if (!existsSync(p)) die(`快照不存在或没有清单：.releases/${version}/manifest.sha256`);
  const map = new Map();
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '(非 git 工作区)';
  }
}

// ---------------------------------------------------------------
// snapshot：构建 + 落快照 + 写清单
// ---------------------------------------------------------------
function cmdSnapshot(version) {
  if (!version) die('用法：release.mjs snapshot <版本，如 v1.0>');

  console.log(`▶ 构建发布产物（build-publish.mjs）…`);
  execFileSync(process.execPath, [join(ROOT, 'scripts_cloudbase', 'build-publish.mjs')], {
    cwd: ROOT, stdio: 'inherit',
  });

  const dest = releaseDir(version);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(PUBLISH_DIR, dest, { recursive: true });

  const files = walk(dest).filter(f => f !== 'manifest.sha256' && f !== 'release.json');
  const lines = [];
  for (const rel of files) {
    lines.push(sha256(readFileSync(join(dest, rel))) + '  ' + rel);
  }
  writeFileSync(join(dest, 'manifest.sha256'), lines.join('\n') + '\n', 'utf8');

  const meta = {
    version,
    gitCommit: gitHead(),
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    dirs: SITE_DIRS,
  };
  writeFileSync(join(dest, 'release.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  console.log('');
  console.log(`✓ 快照就绪：.releases/${version}（${files.length} 个文件）`);
  console.log(`  git commit : ${meta.gitCommit}`);
  console.log(`  built at   : ${meta.builtAt}`);
  console.log('');
  console.log(`下一步：node scripts_cloudbase/release.mjs deploy ${version}`);
}

// ---------------------------------------------------------------
// verify：线上 vs 快照 逐字节比对
// ---------------------------------------------------------------
async function fetchBytes(url) {
  // 静态托管有 CDN 缓存：校验时必须显式绕开，否则会拿旧副本判"不一致"，
  // 或者更糟——拿旧副本判"一致"（明明没发上去却说成功了）。
  const res = await fetch(url, {
    redirect: 'follow',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache' },
  });
  if (!res.ok) return { ok: false, status: res.status, buf: null };
  const ab = await res.arrayBuffer();
  return { ok: true, status: res.status, buf: Buffer.from(ab) };
}

// ---------------------------------------------------------------
// probePublicMeta：自检「发布账本」有没有被公网读到（Day 27 新增）
//   只报告，不影响退出码（CDN 有缓存，刚清完也可能仍打得开一会儿）。
// ---------------------------------------------------------------
async function probePublicMeta(base) {
  console.log('');
  console.log('▶ 检查发布元数据是否可从公网读到（应为不可读）');
  for (const f of META_FILES) {
    const { ok, status } = await fetchBytes(`${base}/${f}`);
    if (ok) {
      console.log(`  ✖ 仍可公开读取：${f}（http ${status}）`);
      console.log(`      → 这是上一版遗留在线上的老文件（本次上传范围已不含它，但不会被自动删掉）。`);
      console.log(`        要清请点名删（每次只接一个路径）：`);
      console.log(`          tcb hosting delete ${f} -e <envId>`);
      console.log(`        ⚠ 不要用 --prune 来清：它的语义是"删掉线上不属于本次发布的所有文件"，`);
      console.log(`          会把托管根目录里的 __auth/ 、cloud-admin/ 等系统文件一起删掉。`);
    } else {
      console.log(`  ✓ 已不可公开读取：${f}（http ${status}）`);
    }
  }
}

async function cmdVerify(version, argv) {
  if (!version) die('用法：release.mjs verify <版本> [--base <静态托管地址>]');
  const manifest = readManifest(version);
  const baseIdx = argv.indexOf('--base');
  const base = (baseIdx >= 0 && argv[baseIdx + 1]) || defaultBase();

  console.log(`▶ 校验 .releases/${version} 是否等于线上 ${base}`);
  console.log(`  共 ${manifest.size} 个文件`);

  let same = 0, diff = 0, missing = 0;
  for (const [rel, want] of manifest) {
    const { ok, status, buf } = await fetchBytes(`${base}/${rel}`);
    if (!ok) {
      console.log(`  ✖ MISSING ${rel}  (http ${status})`);
      missing++;
      continue;
    }
    const got = sha256(buf);
    if (got === want) {
      same++;
    } else {
      console.log(`  ✖ DIFF    ${rel}`);
      console.log(`      期望 ${want}`);
      console.log(`      实际 ${got}`);
      diff++;
    }
  }

  console.log('');
  console.log(`  一致 ${same} · 不一致 ${diff} · 取不到 ${missing}`);
  await probePublicMeta(base);
  console.log('');
  if (diff === 0 && missing === 0) {
    console.log(`✓ 线上与 .releases/${version} 逐字节一致`);
    process.exit(0);
  }
  console.log(`✖ 线上与 .releases/${version} 不一致（这不算失败——回退时它正是我们要看到的现象）`);
  process.exit(1);
}

// ---------------------------------------------------------------
// deploy：先校验快照自洽 → 摆上传目录（只含站点文件）→ 上传 → 探测元数据
// ---------------------------------------------------------------
async function cmdDeploy(version, argv) {
  if (!version) die('用法：release.mjs deploy <版本> [--prune] [--dry-run] [--base <地址>]');
  const dryRun = argv.includes('--dry-run');
  const prune = argv.includes('--prune');
  const dir = releaseDir(version);
  const manifest = readManifest(version);

  // 1) 快照自检：文件齐不齐、有没有被人手改过
  let bad = 0;
  for (const [rel, want] of manifest) {
    const full = join(dir, rel);
    if (!existsSync(full)) { console.log(`  ✖ 缺文件 ${rel}`); bad++; continue; }
    const got = sha256(readFileSync(full));
    if (got !== want) { console.log(`  ✖ 哈希不符 ${rel}`); bad++; }
  }
  const onDisk = walk(dir).filter(f => !isMeta(f));
  if (onDisk.length !== manifest.size) {
    console.log(`  ✖ 文件数不符：清单 ${manifest.size}，实际 ${onDisk.length}`);
    bad++;
  }
  if (bad) die(`快照 .releases/${version} 自身不自洽，拒绝部署（${bad} 处问题）`);
  console.log(`✓ 快照自检通过（${manifest.size} 个文件与清单一致）`);

  // 2) 摆上传目录：只放清单里的站点文件（结构上排除 release.json / manifest.sha256）
  const staged = stageForDeploy(version, manifest);
  const stagedFiles = walk(staged);
  if (stagedFiles.length !== manifest.size) {
    die(`上传目录异常：摆了 ${stagedFiles.length} 个文件，应为 ${manifest.size} 个`);
  }
  console.log(`✓ 上传目录就绪：${staged}（${stagedFiles.length} 个站点文件）`);
  console.log(`  已排除：${META_FILES.join(' / ')}（只留 .releases/${version}/ 本机留档）`);

  if (dryRun) {
    console.log('');
    console.log('▶ --dry-run：以下文件本会随上传进入站点根目录');
    for (const f of stagedFiles) console.log('    ' + f);
    console.log('');
    console.log(prune
      ? '▶ --prune 已指定：线上多余文件（含上一版遗留的 release.json / manifest.sha256）会被清掉'
      : '▶ 未指定 --prune：这次只覆盖同名文件，线上遗留的 release.json / manifest.sha256 不会被清');
    console.log('（dry-run：没有连 CloudBase，没有改动线上任何东西）');
    return;
  }

  // 3) 上传
  const envId = readEnvId(argv);
  const args = ['hosting', 'deploy', staged, '-e', envId, '--safe', '--verify'];
  if (prune) args.push('--prune');
  console.log(`▶ tcb ${args.join(' ')}`);
  try {
    execFileSync('tcb', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  } catch (e) {
    die('部署失败：' + e.message);
  }
  console.log('');
  console.log(`✓ 已部署 .releases/${version}（上传范围：${stagedFiles.length} 个站点文件）`);

  // 4) 上传后自检：发布账本不该再从公网读到
  const baseIdx = argv.indexOf('--base');
  const base = (baseIdx >= 0 && argv[baseIdx + 1]) || `https://${envId}-1499705719.tcloudbaseapp.com`;
  await probePublicMeta(base);

  console.log('');
  console.log(`下一步：node scripts_cloudbase/release.mjs verify ${version}`);
}

function defaultBase() {
  const envId = process.env.TCB_ENV_ID || (() => {
    const p = join(ROOT, '.env');
    if (!existsSync(p)) return null;
    const m = /^\s*TCB_ENV_ID\s*=\s*(.+?)\s*$/m.exec(readFileSync(p, 'utf8'));
    return m ? m[1].replace(/^["']|["']$/g, '') : null;
  })();
  // 静态托管默认域名 = <envId>-<bucketHash>.tcloudbaseapp.com，hash 存在 release.json 里
  const cache = join(RELEASES_DIR, '.hosting-base.txt');
  if (existsSync(cache)) return readFileSync(cache, 'utf8').trim();
  if (!envId) die('拿不到静态托管地址：请用 --base 传入');
  return `https://${envId}-1499705719.tcloudbaseapp.com`;
}

// ---------------------------------------------------------------
// manifest：给「已经存在的快照目录」补一张清单
//   用途：把线上现状原样抓下来当基线时（抓取脚本不产生清单），
//   在这里补一次，之后 verify / deploy 就能认识它。
// ---------------------------------------------------------------
function cmdManifest(version) {
  if (!version) die('用法：release.mjs manifest <版本>');
  const dir = releaseDir(version);
  if (!existsSync(dir)) die(`快照目录不存在：.releases/${version}/`);
  const files = walk(dir).filter(f => !isMeta(f));
  const lines = files.map(rel => sha256(readFileSync(join(dir, rel))) + '  ' + rel);
  writeFileSync(join(dir, 'manifest.sha256'), lines.join('\n') + '\n', 'utf8');

  const metaPath = join(dir, 'release.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  meta.version = version;
  meta.fileCount = files.length;
  meta.gitCommit = meta.gitCommit || gitHead();
  meta.builtAt = meta.builtAt || new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');

  console.log(`✓ 已为 .releases/${version} 生成清单（${files.length} 个文件）`);
}

function cmdList() {
  if (!existsSync(RELEASES_DIR)) { console.log('（还没有任何快照）'); return; }
  const items = readdirSync(RELEASES_DIR).filter(n => statSync(join(RELEASES_DIR, n)).isDirectory());
  if (!items.length) { console.log('（还没有任何快照）'); return; }
  console.log('本地快照：');
  for (const v of items.sort()) {
    const metaPath = join(RELEASES_DIR, v, 'release.json');
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
    console.log(`  ${v.padEnd(10)} ${String(meta.fileCount ?? '?').padStart(3)} 个文件  commit ${meta.gitCommit ?? '?'}  ${meta.builtAt ?? ''}`);
  }
}

// ---------------------------------------------------------------
const [, , cmd, version, ...rest] = process.argv;
switch (cmd) {
  case 'snapshot': cmdSnapshot(version); break;
  case 'manifest': cmdManifest(version); break;
  case 'verify': await cmdVerify(version, rest); break;
  case 'deploy': cmdDeploy(version, rest); break;
  case 'list': cmdList(); break;
  default:
    console.log('release.mjs — 发布 / 回退工具（Day 26 建，Day 27 修订上传范围）');
    console.log('');
    console.log('  node scripts_cloudbase/release.mjs snapshot <版本>   构建快照 + sha256 清单');
    console.log('  node scripts_cloudbase/release.mjs manifest <版本>   给已存在的快照目录补清单');
    console.log('  node scripts_cloudbase/release.mjs verify   <版本>   拉线上文件与快照逐字节比对');
    console.log('  node scripts_cloudbase/release.mjs deploy   <版本>   自检快照后部署（可加 --prune）');
    console.log('  node scripts_cloudbase/release.mjs list             列出本地快照');
    console.log('');
    console.log('  deploy 选项：');
    console.log('    --dry-run   只摆上传目录并列出会上传的文件，不连 CloudBase、不改线上');
    console.log('    --prune     连线上多余文件一起清掉（清上一版遗留的 release.json 等）');
    console.log('');
    console.log('  上传范围：只有清单里的站点文件（css/ js/ data/ + 根目录 *.html）。');
    console.log('            release.json / manifest.sha256 只留 .releases/<版本>/ 本机留档。');
    process.exit(cmd ? 1 : 0);
}
