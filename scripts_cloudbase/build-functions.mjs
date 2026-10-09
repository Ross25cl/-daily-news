// ============================================================
// build-functions.mjs — 组装云函数部署目录（Day 20 建）
// ------------------------------------------------------------
// 解决什么问题：Day 19 把「查数据库」抽到 cloudfunctions/shared/ 后，
//   两个接口文件里写的是 `require('../shared/pg')` —— 本地跑没问题，
//   但**云端跑不了**：CloudBase CLI 打包云函数时，
//   压缩包的根目录就是「函数目录」本身（源码见 CLI 的 FunctionPacker：
//   `this.funcPath = functionPath ? functionPath : resolve(root, name)`，
//   然后 `zipDir(this.funcPath, ...)`）。也就是说 `../shared` 永远在包外，
//   函数一启动就 `Cannot find module '../shared/pg'` → 网关回 443 空响应。
//   （Day 19 记的「用 -r 参数以项目根为根目录」是错的：CLI 3.8.5 没有 -r 这个参数。）
//
// 做法：为每个函数生成一个自包含的部署目录
//     .cloudbase-build/<函数名>/
//       ├── index.js        ← 从 cloudfunctions/<函数名>/ 拷来
//       ├── package.json
//       ├── scf_bootstrap
//       └── shared/         ← 从 cloudfunctions/shared/ 拷来
//   并把**拷贝件**里的 `require('../shared/x')` 改写成 `require('./shared/x')`。
//   源码保持原样（本地 `node cloudfunctions/api/index.js` 照样跑得通）。
//
// 用法（项目根目录）：
//     node scripts_cloudbase/build-functions.mjs
//     tcb fn deploy api       --httpFn --dir .cloudbase-build/api       -e <envId> --force
//     tcb fn deploy favorites --httpFn --dir .cloudbase-build/favorites -e <envId> --force
//     tcb fn deploy matches   --httpFn --dir .cloudbase-build/matches   -e <envId> --force
//     tcb fn deploy news      --httpFn --dir .cloudbase-build/news      -e <envId> --force
//     tcb fn deploy health    --httpFn --dir .cloudbase-build/health    -e <envId> --force
//     tcb deploy --only gateway -e <envId>
// ============================================================

import { readdirSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'cloudfunctions');
const OUT = join(ROOT, '.cloudbase-build');

// 需要 shared/ 的函数写在前面；health 不连库，拉进来只为「一条命令造齐」
const FUNCTIONS = ['api', 'favorites', 'matches', 'news', 'health'];

// 只改拷贝件：../shared/x → ./shared/x
const REQUIRE_FIX = /require\((['"])\.\.\/shared\//g;

function stageFunction(name) {
  const srcDir = join(SRC, name);
  const dstDir = join(OUT, name);

  if (!statSync(srcDir).isDirectory()) throw new Error('没有这个函数目录：' + srcDir);

  mkdirSync(dstDir, { recursive: true });
  cpSync(srcDir, dstDir, { recursive: true });

  // 跨函数共用的数据访问层，整份拷进函数目录（包内自包含）
  const sharedSrc = join(SRC, 'shared');
  const sharedDst = join(dstDir, 'shared');
  if (statSync(sharedSrc).isDirectory()) {
    cpSync(sharedSrc, sharedDst, { recursive: true });
  }

  // 改写拷贝件里的相对引用
  let patched = 0;
  for (const f of readdirSync(dstDir)) {
    if (!f.endsWith('.js')) continue;                 // shared/ 内部的相对引用不用动
    const p = join(dstDir, f);
    const before = readFileSync(p, 'utf8');
    const after = before.replace(REQUIRE_FIX, (m, q) => "require(" + q + "./shared/");
    if (after !== before) {
      writeFileSync(p, after, 'utf8');
      patched++;
    }
  }

  const files = [];
  (function walk(d, base) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, rel); else files.push(rel);
    }
  })(dstDir, '');

  console.log('  ' + name + '：' + files.length + ' 个文件（改写引用 ' + patched + ' 处）');
  files.forEach(f => console.log('      ' + f));
}

function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  console.log('组装云函数部署目录 → ' + OUT);
  FUNCTIONS.forEach(stageFunction);

  console.log('');
  console.log('下一步（每个函数一条）：');
  FUNCTIONS.forEach(n => console.log(
    '  tcb fn deploy ' + n + ' --httpFn --dir .cloudbase-build/' + n + ' -e <envId> --force'));
  console.log('  tcb deploy --only gateway -e <envId>');
  console.log('');
  console.log('注意：.cloudbase-build/ 已在 .gitignore 里，不会进仓库。');
}

main();
