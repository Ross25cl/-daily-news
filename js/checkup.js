// ============================================================
// checkup.js — 接口检查台（Day 20 建）
// ------------------------------------------------------------
// 三件事，都是「点一下就知道通不通」：
//   ① GET /api/health            云函数活着吗
//   ② GET /api/hot               核心表 hot_items 的真实数据（含真实抓取时间）
//      GET /api/favorites        核心表 news_items 的真实数据
//   ③ POST /api/favorites        真写一行进去，再读回来
//
// 所有数字都来自公网接口的实时返回；页面里不含密钥（密钥只在云函数环境变量）。
// 接口地址统一由 js/api-config.js 给出（线上绝对域名 / 本地走 serve.mjs 同源代理）。
// ============================================================

// ---------- 工具 ----------

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

function apiUrl(path) {
  return (window.API_ORIGIN || '') + path;
}

function $(id) { return document.getElementById(id); }

function setBadge(id, kind, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'badge badge-' + kind;
  el.textContent = text;
}

function heatText(n) {
  n = Number(n) || 0;
  return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);
}

// "2026-10-05T23:30:58+08:00" → "2026-10-05 23:30:58"
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function todayLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * 统一取数：返回整个响应体（含 ok / data / meta），失败抛错。
 * 刻意不做任何回落 —— 检查台要看到的就是「接口此刻的真实回答」，
 * 一旦静默回落，检查台本身就成了假证据。
 */
async function callAPI(path, options) {
  const res = await fetch(apiUrl(path), Object.assign({ cache: 'no-store' }, options || {}));
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* 非 JSON 时下面统一报错 */ }
  if (!body) throw new Error('HTTP ' + res.status + '，返回的不是 JSON：' + text.slice(0, 200));
  if (!res.ok || body.ok !== true) {
    const msg = (body.error && body.error.message) || ('HTTP ' + res.status);
    const err = new Error(msg);
    err.body = body;
    throw err;
  }
  return body;
}

// ---------- ① 健康状态 ----------

async function checkHealth() {
  const url = apiUrl('/api/health');
  $('health-url').textContent = url;
  setBadge('health-badge', 'wait', '检查中…');
  const t0 = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    const ms = Date.now() - t0;
    $('health-ms').textContent = ms + ' ms';
    $('health-body').innerHTML = '<code>' + esc(text.trim()) + '</code>';
    if (res.ok) setBadge('health-badge', 'ok', '正常 ' + res.status);
    else setBadge('health-badge', 'bad', '异常 ' + res.status);
  } catch (err) {
    $('health-ms').textContent = (Date.now() - t0) + ' ms';
    $('health-body').textContent = '请求失败：' + err.message;
    setBadge('health-badge', 'bad', '失败');
  }
}

// ---------- ② 核心表真实数据 ----------

async function loadHot() {
  $('hot-url').textContent = apiUrl('/api/hot?limit=5');
  setBadge('hot-badge', 'wait', '读取中…');
  try {
    const body = await callAPI('/api/hot?limit=5');
    const platforms = body.data.platforms || [];
    const meta = body.meta || {};

    $('hot-count').textContent = meta.count != null ? meta.count : '—';
    $('hot-fetched').textContent = formatTime(meta.updatedAt);

    const rows = [];
    platforms.forEach(p => {
      (p.items || []).forEach(it => {
        rows.push(
          '<tr>' +
            '<td><span class="tag-chip">' + esc(p.name || p.id) + '</span></td>' +
            '<td class="num">' + esc(it.rank) + '</td>' +
            '<td class="title">' + esc(it.title) + '</td>' +
            '<td class="num">' + esc(heatText(it.heat)) + '</td>' +
            '<td>' + esc(it.tag || '') + '</td>' +
          '</tr>'
        );
      });
    });

    $('hot-table').innerHTML = rows.length
      ? '<table class="data"><thead><tr>' +
          '<th>平台</th><th>名次</th><th>标题</th><th>热度</th><th>标签</th>' +
        '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'
      : '<p class="empty-cell">接口正常返回，但这个筛选条件下没有数据。</p>';

    setBadge('hot-badge', 'ok', '正常 · ' + rows.length + ' 条');
  } catch (err) {
    $('hot-table').innerHTML = '<p class="empty-cell">读取失败：' + esc(err.message) + '</p>';
    setBadge('hot-badge', 'bad', '失败');
  }
}

async function loadNews() {
  $('news-url').textContent = apiUrl('/api/favorites?limit=5');
  setBadge('news-badge', 'wait', '读取中…');
  try {
    const body = await callAPI('/api/favorites?limit=5');
    const list = body.data || [];
    $('news-count').textContent = list.length;

    $('news-table').innerHTML = list.length
      ? '<table class="data"><thead><tr>' +
          '<th>id</th><th>标题</th><th>板块</th><th>联赛</th><th>归属日期</th><th>写入时间</th>' +
        '</tr></thead><tbody>' +
        list.map(x => (
          '<tr>' +
            '<td><code>' + esc(x.id) + '</code></td>' +
            '<td class="title">' + esc(x.title) + '</td>' +
            '<td>' + esc(x.section) + '</td>' +
            '<td>' + esc(x.league) + '</td>' +
            '<td>' + esc(x.digestDate) + '</td>' +
            '<td>' + esc(formatTime(x.createdAt)) + '</td>' +
          '</tr>'
        )).join('') + '</tbody></table>'
      : '<p class="empty-cell">核心表 news_items 目前是空的。</p>';

    setBadge('news-badge', 'ok', '正常 · ' + list.length + ' 条');
  } catch (err) {
    $('news-table').innerHTML = '<p class="empty-cell">读取失败：' + esc(err.message) + '</p>';
    setBadge('news-badge', 'bad', '失败');
  }
}

// ---------- ③ 写入测试 ----------

function initWriteForm() {
  const form = $('write-form');
  const urlInput = form.elements.sourceUrl;
  const dateInput = form.elements.digestDate;

  // 唯一链接：带毫秒时间戳，重复点不会撞上前一次（要测「重复」就把链接手动改回上一笔）
  urlInput.value = 'https://example.com/checkup-' + Date.now();
  dateInput.value = todayLocal();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    setBadge('write-badge', 'wait', '写入中…');

    const payload = {
      title: form.elements.title.value.trim(),
      summary: form.elements.summary.value.trim(),
      section: form.elements.section.value,
      league: form.elements.league.value.trim(),
      sourceName: form.elements.sourceName.value.trim(),
      sourceUrl: urlInput.value.trim(),
      digestDate: dateInput.value
    };

    const out = $('write-result');
    out.hidden = false;
    const t0 = Date.now();
    try {
      const body = await callAPI('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const created = !!(body.meta && body.meta.created);
      out.textContent = 'POST ' + apiUrl('/api/favorites') + '\n' +
        '耗时 ' + (Date.now() - t0) + ' ms\n\n' + JSON.stringify(body, null, 2);
      setBadge('write-badge', 'ok', created ? '新写入 1 条' : '已存在，未重复写');
      await loadNews();     // 写完立刻读回来，眼见为实
    } catch (err) {
      out.textContent = '写入失败：' + err.message + '\n\n' +
        JSON.stringify(err.body || {}, null, 2);
      setBadge('write-badge', 'bad', '失败');
    } finally {
      btn.disabled = false;
    }
  });

  $('write-refresh').addEventListener('click', () => loadNews());
}

// ---------- 启动 ----------

function init() {
  $('api-origin').textContent = (window.API_ORIGIN || '') === ''
    ? '（本地同源代理 /api → 云函数网关）'
    : window.API_ORIGIN;
  $('page-origin').textContent = location.origin;

  initWriteForm();
  checkHealth();
  loadHot();
  loadNews();
}

init();
