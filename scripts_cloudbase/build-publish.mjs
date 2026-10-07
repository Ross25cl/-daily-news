// ============================================================
// build-publish.mjs — 组装静态托管发布目录（Day 20 建）
// ------------------------------------------------------------
// 为什么要有这一步：项目根目录里混着文档（*.md）、云函数源码、db 脚本、
//   设计稿、skills/ 等，**不该随页面上公网**。静态托管只需要
//   「浏览器要的东西」：根目录的 *.html + css/ + js/ + data/。
//
// 与 Day 15 的 scripts_cloudbase/deploy-hosting.ps1 是同一件事，
//   换成 Node 实现的原因：那个 .ps1 在本机实测跑不通（套壳 powershell
//   会重置工作目录，$PSScriptRoot 取到空值），而 Node 是零依赖、跨平台、
//   项目里本来就用它跑 serve.mjs。
//
// 用法（项目根目录）：
//    node scripts_cloudbase/build-publish.mjs
//    tcb hosting deploy .cloudbase-publish -e <envId> --safe
// ============================================================

import { readdirSync, mkdirSync, rmSync, cpSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.cloudbase-publish');

// 只发布这些目录（其余一概不上传）
const DIRS = ['css', 'js', 'data'];

// 明确不进发布目录的 html（本页是给开发者看的自检页？不是——检查台要能分享，
// 所以也发布。这里只留空列表，方便以后排除某个页面。）
const EXCLUDE_HTML = [];

function main() {
  if (statSync(ROOT).isDirectory() === false) throw new Error('项目根目录不对：' + ROOT);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let n = 0;

  const htmls = readdirSync(ROOT).filter(f => f.endsWith('.html') && !EXCLUDE_HTML.includes(f));
  for (const f of htmls) {
    cpSync(join(ROOT, f), join(OUT, f));
    console.log('  + ' + f);
    n++;
  }

  for (const d of DIRS) {
    const src = join(ROOT, d);
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    cpSync(src, join(OUT, d), { recursive: true });
    const inner = readdirSync(src).length;
    console.log('  + ' + d + '/ (' + inner + ' 个文件)');
    n += inner;
  }

  console.log('');
  console.log('发布目录就绪：' + OUT + '（' + n + ' 个文件）');
  console.log('下一步：tcb hosting deploy .cloudbase-publish -e <envId> --safe');
  console.log('');
  console.log('注意：.cloudbase-publish/ 已在 .gitignore 里，不会进仓库。');
}

main();
