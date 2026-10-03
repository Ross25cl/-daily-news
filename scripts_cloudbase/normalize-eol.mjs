/**
 * ============================================================
 * normalize-eol.mjs — 把 scf_bootstrap 的换行符强制改回 LF
 * ------------------------------------------------------------
 * 用途：本机 git 是 core.autocrlf=true，Windows 上编辑器保存或
 *   git 检出都可能把 scf_bootstrap 变成 CRLF，导致 CloudBase
 *   云函数启动失败。部署前跑一次本脚本即可确保 LF。
 *
 * 用法（项目根目录）：
 *   node scripts_cloudbase/normalize-eol.mjs
 *
 * 说明：.gitattributes 已声明 cloudfunctions/**\/scf_bootstrap 为
 *   eol=lf，正常情况无需手动跑；本脚本是双保险 + 排查工具。
 * ============================================================
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'cloudfunctions', 'health', 'scf_bootstrap');

const raw = await readFile(target);
const hadCRLF = raw.includes(Buffer.from('\r\n'));

// 只保留 LF：先把 CRLF 压成 LF，再处理可能残留的孤立 CR
const normalized = Buffer.from(
  raw.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
  'utf8'
);

await writeFile(target, normalized);

console.log('scf_bootstrap 处理完成：');
console.log('  之前含 CRLF：' + (hadCRLF ? '是（已修复）' : '否'));
console.log('  现在字节数：' + normalized.length);
console.log('  结果：' + (normalized.includes(Buffer.from('\r\n')) ? '⚠ 仍含 CRLF' : '✓ 纯 LF'));
