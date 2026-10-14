#!/usr/bin/env node
/**
 * ============================================================
 * export-data.mjs — 把 CloudBase PG 里的业务表整表导出成 JSON（Day 27）
 * ------------------------------------------------------------
 * 为什么要有这个脚本（Day 26 已知缺口）：
 *   本环境是 CloudBase **PostgreSQL**（库 postgres-emxo9nse），
 *   而 `tcb db backup` 是 **MySQL 专用** → 我们**没有一键备份**。
 *   环境是「体验版」，到期（2027-04-03）后环境会被回收，
 *   所以「能在到期前把数据捞出来」这件事必须有一条**跑得通**的路。
 *
 * 走哪条路：
 *   和云函数完全相同的一条 —— PostgREST（HTTP），
 *   因为体验版**不支持 PG 的 TCP 直连**（见 shared/pg.js 顶部注释）。
 *   零依赖：只用 Node 原生 https / fs，不引任何 npm 包。
 *
 * 安全：
 *   密钥只从 `.env`（已被 gitignore）或环境变量读，**只打印「有/无」，绝不打印值**；
 *   本脚本不写文件到仓库跟踪目录以外（默认输出到 db/exports/，已 gitignore）。
 *
 * 用法：
 *   node scripts_cloudbase/export-data.mjs
 *   node scripts_cloudbase/export-data.mjs --out db/exports
 *   node scripts_cloudbase/export-data.mjs --tables news_items,matches
 *   node scripts_cloudbase/export-data.mjs --dry-run        # 只报行数，不写文件
 *
 * 退出码：0 全部表导出成功且行数与库内 count(*) 一致；1 有任一表不一致或失败。
 * ============================================================
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 10 张业务表（Day 16 建库时的全部表；表清单由 information_schema 核对过，见 docs/cloudbase-resource-day27.md）
const ALL_TABLES = [
  'hot_items', 'news_items', 'matches', 'leagues',
  'league_schedule', 'league_standings', 'league_players', 'league_brackets',
  'push_log', 'subscribers'
];

// 每页拉多少行（PostgREST 用 limit/offset 分页；顺序固定按主键 id，全部表的主键都叫 id）
const PAGE = 500;
const TIMEOUT_MS = 20000;

// ---------- 读 .env（只认键名，值不落日志） ----------

function readDotEnv() {
  const p = path.join(ROOT, '.env');
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return out;
}

const dotenv = readDotEnv();
const ENV_ID = process.env.TCB_ENV_ID || dotenv.TCB_ENV_ID || '';
// 云函数里这个变量叫 CB_ENV_ID（见 shared/pg.js），本地 .env 里叫 TCB_ENV_ID —— 两个都认
const API_KEY = process.env.CB_API_KEY || dotenv.CB_API_KEY || '';

if (!ENV_ID || !API_KEY) {
  console.error('拿不到连接信息：需要 TCB_ENV_ID 与 CB_API_KEY（写进 .env，或设为环境变量）。');
  console.error(`  当前：TCB_ENV_ID=${ENV_ID ? '有' : '缺'}，CB_API_KEY=${API_KEY ? '有' : '缺'}`);
  process.exit(1);
}

const REST_HOST = ENV_ID + '.api.tcloudbasegateway.com';
const REST_BASE = '/v1/rdb/rest';

// ---------- 一个 HTTP GET ----------

function restGet(table, query, extraHeaders) {
  const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const p = `${REST_BASE}/${table}` + (qs ? '?' + qs : '');
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: REST_HOST,
      path: p,
      method: 'GET',
      headers: Object.assign({
        Authorization: 'Bearer ' + API_KEY,
        Accept: 'application/json'
      }, extraHeaders || {}),
      timeout: TIMEOUT_MS
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}：${raw.slice(0, 200)}`));
        }
        let rows;
        try { rows = JSON.parse(raw); } catch (e) { return reject(new Error('返回的不是 JSON')); }
        resolve({ rows, contentRange: res.headers['content-range'] || '' });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`请求超时（${TIMEOUT_MS / 1000} 秒）`)));
    req.on('error', reject);
    req.end();
  });
}

/** 拉一整张表：先要总数（count=exact），再按 id 升序分页拉全。 */
async function exportTable(table) {
  const first = await restGet(table, { select: '*', limit: PAGE, offset: 0, order: 'id.asc' },
    { Prefer: 'count=exact' });
  // Content-Range 形如 `0-499/3891`，斜杠后就是整表行数（PostgREST 计数，不用自己写 SQL）
  const total = Number((first.contentRange.split('/')[1] || '').trim()) || first.rows.length;
  const rows = first.rows.slice();

  while (rows.length < total) {
    const page = await restGet(table, { select: '*', limit: PAGE, offset: rows.length, order: 'id.asc' });
    if (page.rows.length === 0) break;   // 防御：上游不再给数据就停，别死循环
    rows.push(...page.rows);
  }
  return { table, total, rows };
}

// ---------- main ----------

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const tables = (arg('--tables', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const TARGETS = tables.length ? tables : ALL_TABLES;
const DRY = process.argv.includes('--dry-run');
const outRoot = path.resolve(ROOT, arg('--out', 'db/exports'));

console.log(`环境 ${ENV_ID}（API Key：有，长度 ${API_KEY.length} — 不打印值）`);
console.log(`表 ${TARGETS.length} 张${DRY ? '（dry-run：只报行数）' : ''}\n`);

// 目录名用**本地时间**（UTC 会在半夜跨日，看不出是哪天导的）
const _d = new Date();
const _p = n => String(n).padStart(2, '0');
const stamp = `${_d.getFullYear()}${_p(_d.getMonth() + 1)}${_p(_d.getDate())}-${_p(_d.getHours())}${_p(_d.getMinutes())}${_p(_d.getSeconds())}`;
const outDir = path.join(outRoot, stamp);
if (!DRY) mkdirSync(outDir, { recursive: true });

const summary = [];
let bad = 0;

for (const t of TARGETS) {
  try {
    const { total, rows } = await exportTable(t);
    const json = JSON.stringify(rows, null, 2) + '\n';
    const sha = createHash('sha256').update(json).digest('hex').slice(0, 16);
    if (!DRY) writeFileSync(path.join(outDir, `${t}.json`), json, 'utf8');
    const ok = rows.length === total;
    if (!ok) bad++;
    summary.push({ table: t, rows: rows.length, total, bytes: Buffer.byteLength(json), sha256: sha, ok });
    console.log(`${ok ? '✓' : '✗'} ${t.padEnd(17)} ${String(rows.length).padStart(5)} / ${String(total).padStart(5)} 行  ${(Buffer.byteLength(json) / 1024).toFixed(1).padStart(8)} KB  ${sha}`);
  } catch (e) {
    bad++;
    summary.push({ table: t, error: String(e.message || e) });
    console.log(`✗ ${t.padEnd(17)} 失败：${e.message}`);
  }
}

const totalRows = summary.reduce((n, s) => n + (s.rows || 0), 0);
const totalBytes = summary.reduce((n, s) => n + (s.bytes || 0), 0);

if (!DRY) {
  writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify({
    envId: ENV_ID,
    exportedAt: new Date().toISOString(),
    source: 'CloudBase PostgreSQL via PostgREST /v1/rdb/rest',
    tables: summary,
    totalRows,
    totalBytes,
    note: '本文件不含任何密钥。导出的 JSON 是「此刻库里的原样数据」，可用于重建或核对。'
  }, null, 2) + '\n', 'utf8');
  console.log(`\n输出目录：${path.relative(ROOT, outDir).replace(/\\/g, '/')}`);
}

console.log(`合计 ${summary.filter(s => !s.error).length} 张表 / ${totalRows} 行 / ${(totalBytes / 1024).toFixed(1)} KB`);
if (bad) { console.log(`有 ${bad} 张表拿不到或行数对不上 —— 这次导出**不可信**，别拿它当备份。`); process.exit(1); }
console.log('全部表行数与库内计数一致。');
