// ============================================================
// checkup.js — 接口检查台（Day 20 建；Day 22 增「修改与删除」）
// ------------------------------------------------------------
// 四件事，都是「点一下就知道通不通」：
//   ① GET /api/health            云函数活着吗
//   ② GET /api/hot               核心表 hot_items 的真实数据（含真实抓取时间）
//      GET /api/favorites        核心表 news_items 的真实数据
//   ③ POST /api/favorites        真写一行进去，再读回来
//   ④ PATCH / DELETE             （Day 22 新增）改一条、删一条，
//                                **删除带二次确认弹窗**
//
// 所有数字都来自公网接口的实时返回；页面里不含密钥（密钥只在云函数环境变量）。
// 接口地址统一由 js/api-config.js 给出（线上绝对域名 / 本地走 serve.mjs 同源代理）。
//
// 【Day 22 掌握项：删除为什么比新增更容易出事？】
//   新增出错 → 多一条脏数据，看得见、能改能删，损失可逆；
//   删除出错 → 数据**直接没了**，没有回收站，损失不可逆。
//   所以删除这条路上放了三道确认：后端「先查再删 + 无过滤条件拒绝」，
//   前端这一层就是下面那个 <dialog> 二次确认 —— 人手点下去的那一下。
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

// ---------- ④ 修改与删除（Day 22） ----------

/**
 * 面板状态：当前取到的记录（GET 的结果）。
 * 不做任何本地缓存到 localStorage —— 检查台要看的永远是「库里此刻的值」。
 */
const mutateState = {
  table: 'matches',
  id: '',
  row: null
};

/**
 * 记录类型 → 接口路径 + 该类型下「允许修改哪些字段」+ 字段标签。
 * 这张表是前端唯一知道「哪个接口改什么」的地方，
 * 与后端 repository 的 PATCHABLE 白名单一一对应（后端才是权威，前端只是少让用户白填）。
 */
const MUTATE_SCHEMA = {
  matches: {
    path: '/api/matches',
    label: '比赛记录',
    fields: [
      { key: 'status', label: '赛事状态', type: 'select', options: ['未开始', '进行中', '已结束', '延期', '取消'] },
      { key: 'homeScore', label: '主队最终比分', type: 'number' },
      { key: 'awayScore', label: '客队最终比分', type: 'number' },
      { key: 'homeTeam', label: '主队名（标题的一部分）', type: 'text' },
      { key: 'awayTeam', label: '客队名（标题的一部分）', type: 'text' },
      { key: 'round', label: '轮次', type: 'text' },
      { key: 'venue', label: '场地', type: 'text' },
      { key: 'note', label: '备注', type: 'text' }
    ]
  },
  news: {
    path: '/api/news',
    label: '资讯记录',
    fields: [
      { key: 'title', label: '新闻标题（≤30 字）', type: 'text' },
      { key: 'summary', label: '内容摘要（≤60 字）', type: 'text' },
      { key: 'note', label: '备注', type: 'text' },
      { key: 'status', label: '发布状态', type: 'select', options: ['draft', 'published'] }
    ]
  }
};

function currentSchema() {
  return MUTATE_SCHEMA[mutateState.table];
}

function setMutateBadge(kind, text) {
  setBadge('mutate-badge', kind, text);
}

/**
 * 把一条记录渲染成「可编辑表单 + 改前值提示」。
 * 输入框预填当前值 → 用户改哪格、PATCH 就只提交哪格（其余不动）。
 */
function renderMutateForm(row) {
  const schema = currentSchema();
  const box = $('mutate-diff');

  const rows = schema.fields.map(f => {
    const cur = row[f.key];
    const curText = (cur === null || cur === undefined || cur === '') ? '（空）' : String(cur);
    let input;
    if (f.type === 'select') {
      input = '<select data-k="' + esc(f.key) + '">' +
        f.options.map(o => '<option value="' + esc(o) + '"' +
          (String(cur) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
        '</select>';
    } else if (f.type === 'number') {
      input = '<input data-k="' + esc(f.key) + '" type="number" value="' +
        (cur === null || cur === undefined ? '' : esc(cur)) + '">';
    } else {
      input = '<input data-k="' + esc(f.key) + '" value="' +
        (cur === null || cur === undefined ? '' : esc(cur)) + '">';
    }
    return '<tr>' +
      '<th>' + esc(f.label) + '</th>' +
      '<td><span class="cur-value">当前：' + esc(curText) + '</span></td>' +
      '<td>' + input + '</td>' +
      '</tr>';
  }).join('');

  box.innerHTML =
    '<p class="diff-title">已取到 <code>' + esc(row.id) + '</code>' +
    '（' + esc(schema.label) + '）。下面左格是库里当前值，右格是你要改成的值——只提交你动过的格。</p>' +
    '<div class="table-wrap"><table class="data mutate"><thead><tr>' +
    '<th>字段</th><th>改之前</th><th>改之后（可编辑）</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/**
 * 收集用户真正改动过的字段（与「当前值」比对，没动的就不提交）。
 * 这一步很重要：PATCH 只发变化字段，接口 meta.changed 才能如实反映动了什么。
 */
function collectChanged() {
  const schema = currentSchema();
  const row = mutateState.row;
  const patch = {};
  const inputs = document.querySelectorAll('#mutate-diff input[data-k], #mutate-diff select[data-k]');

  inputs.forEach(el => {
    const k = el.dataset.k;
    const before = row[k];
    const beforeStr = (before === null || before === undefined) ? '' : String(before);
    const nowStr = el.value.trim();

    if (nowStr === beforeStr) return;              // 没动，跳过
    if (el.type === 'number') {
      patch[k] = nowStr === '' ? null : Number(nowStr);
    } else {
      patch[k] = nowStr;
    }
  });

  return patch;
}

/** 把「改之前 → 改之后」逐字段列出来，供页面直接当证据看（也是今日截图的内容）。 */
function renderDiff(before, after, changedKeys) {
  const keys = (changedKeys && changedKeys.length) ? changedKeys : Object.keys(before || {});
  const fmt = v => (v === null || v === undefined || v === '') ? '（空）' : String(v);

  const rows = keys.filter(k => k !== 'updatedAt' && k !== 'createdAt').map(k => {
    const b = fmt(before ? before[k] : undefined);
    const a = fmt(after ? after[k] : undefined);
    const same = b === a;
    return '<tr>' +
      '<th>' + esc(k) + '</th>' +
      '<td class="before">' + esc(b) + '</td>' +
      '<td class="arrow">' + (same ? '＝' : '→') + '</td>' +
      '<td class="after' + (same ? '' : ' changed') + '">' + esc(a) + '</td>' +
      '</tr>';
  }).join('');

  return '<p class="diff-title">改动对比（<span class="mark-changed">高亮</span>的是真的变了的字段）：</p>' +
    '<div class="table-wrap"><table class="data diff"><thead><tr>' +
    '<th>字段</th><th>改之前</th><th></th><th>改之后</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function initMutatePanel() {
  const tableSel = $('mutate-table');
  const idInput = $('mutate-id');
  const loadBtn = $('mutate-load');
  const patchBtn = $('mutate-patch');
  const deleteBtn = $('mutate-delete');
  const out = $('mutate-result');
  const diffBox = $('mutate-diff');

  // 切换记录类型时清空状态，避免拿着 matches 的一条去打 news
  tableSel.addEventListener('change', () => {
    mutateState.table = tableSel.value;
    mutateState.row = null;
    mutateState.id = '';
    idInput.value = '';
    diffBox.innerHTML = '';
    out.hidden = true;
    patchBtn.disabled = true;
    deleteBtn.disabled = true;
    setMutateBadge('wait', '待操作');
  });

  // ---- ① GET 取一条 ----
  loadBtn.addEventListener('click', async () => {
    const schema = currentSchema();
    mutateState.table = tableSel.value;
    const id = idInput.value.trim();
    if (!id) {
      setMutateBadge('bad', '缺 id');
      out.hidden = false;
      out.textContent = '请先填一个记录 id。';
      return;
    }

    loadBtn.disabled = true;
    setMutateBadge('wait', '读取中…');
    const t0 = Date.now();
    try {
      const body = await callAPI(schema.path + '?id=' + encodeURIComponent(id));
      mutateState.id = id;
      mutateState.row = body.data;
      renderMutateForm(body.data);
      patchBtn.disabled = false;
      deleteBtn.disabled = false;
      out.hidden = false;
      out.textContent = 'GET ' + apiUrl(schema.path) + '?id=' + id + '\n' +
        '耗时 ' + (Date.now() - t0) + ' ms（HTTP 200）\n\n' + JSON.stringify(body.data, null, 2);
      setMutateBadge('ok', '已取到 · ' + id);
    } catch (err) {
      mutateState.row = null;
      diffBox.innerHTML = '';
      patchBtn.disabled = true;
      deleteBtn.disabled = true;
      out.hidden = false;
      out.textContent = '取不到这一条：' + err.message + '\n\n' +
        JSON.stringify(err.body || {}, null, 2);
      setMutateBadge('bad', err.body && err.body.error ? err.body.error.code : '失败');
    } finally {
      loadBtn.disabled = false;
    }
  });

  // ---- ② PATCH 提交修改 ----
  patchBtn.addEventListener('click', async () => {
    const schema = currentSchema();
    const patch = collectChanged();
    if (Object.keys(patch).length === 0) {
      setMutateBadge('wait', '没有改动');
      out.hidden = false;
      out.textContent = '你还没有改动任何字段 —— 先把右格里的值改掉再提交。';
      return;
    }

    patchBtn.disabled = true;
    setMutateBadge('wait', '提交中…');
    const t0 = Date.now();
    try {
      const body = await callAPI(schema.path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ id: mutateState.id }, patch))
      });
      mutateState.row = body.data.after;
      diffBox.innerHTML = renderMutateForm(body.data.after) +
        renderDiff(body.data.before, body.data.after, body.meta.changed);
      out.hidden = false;
      out.textContent = 'PATCH ' + apiUrl(schema.path) + '\n' +
        '耗时 ' + (Date.now() - t0) + ' ms（HTTP 200）\n\n' + JSON.stringify(body, null, 2);
      setMutateBadge('ok', '已改 ' + body.meta.changed.length + ' 个字段');
      // 改完刷新上面的核心表，让「库里真的变了」一眼可见
      if (mutateState.table === 'news') loadNews();
    } catch (err) {
      out.hidden = false;
      out.textContent = '修改失败：' + err.message + '\n\n' + JSON.stringify(err.body || {}, null, 2);
      setMutateBadge('bad', err.body && err.body.error ? err.body.error.code : '失败');
    } finally {
      patchBtn.disabled = false;
    }
  });

  // ---- ③ DELETE（★ 二次确认在这里）----
  deleteBtn.addEventListener('click', async () => {
    const row = mutateState.row;
    if (!row) return;

    // ★★ 二次确认：不直接发删除请求，先弹窗。
    //    弹窗里把「要删的是哪一条」原样摆出来（标题/主客队），
    //    让人确认的是「这一条」，不是盲点一个「确定」。
    const ok = await confirmDelete(row);
    if (!ok) {
      setMutateBadge('wait', '已取消删除');
      out.hidden = false;
      out.textContent = '删除已取消 —— 这条记录没有被改动。\n' +
        '（这就是二次确认的意义：误点一下不会让记录从查询里消失。）';
      return;
    }

    const schema = currentSchema();
    deleteBtn.disabled = true;
    patchBtn.disabled = true;
    setMutateBadge('wait', '删除中…');
    const t0 = Date.now();
    try {
      const body = await callAPI(schema.path, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mutateState.id })
      });
      out.hidden = false;
      out.textContent = 'DELETE ' + apiUrl(schema.path) + '\n' +
        '耗时 ' + (Date.now() - t0) + ' ms（HTTP 200）\n\n' + JSON.stringify(body, null, 2);

      // ---- 删完立刻 GET 一次，把「查不到了」当场证出来 ----
      let goneText = '';
      try {
        await callAPI(schema.path + '?id=' + encodeURIComponent(mutateState.id));
        goneText = '⚠ 复查仍能 GET 到，删除可能没生效，请重试。';
      } catch (err) {
        goneText = '复查 GET 该 id → HTTP ' +
          ((err.body && err.body.error) ? (err.body.error.code + '：' + err.body.error.message) : err.message) +
          '\n（这就是「删掉之后 GET 不再返回」的证据）';
      }

      // ---- 软删除回执（Day 22 余力加练）----
      // 页面要把「查不到」和「数据还在」这两件看似矛盾的事同时说清楚：
      // 接口回执里 mode=soft / recoverable=true 就是它的凭据（不是我们替接口编的话）。
      const soft = body.data.mode === 'soft';
      const softText = soft
        ? '<p class="diff-title">软删除回执：<code>mode=' + esc(String(body.data.mode)) +
        '</code>、<code>recoverable=' + esc(String(body.data.recoverable)) + '</code>' +
        '<br>这一行<b>没有被真删</b> —— 只是 <code>is_deleted</code> 被置为 <code>true</code>，' +
        '查询把它跳过了。所以「GET 查不到」与「数据还在库里」同时成立。' +
        (body.data.restoreHint ? '<br>找回方式：' + esc(body.data.restoreHint) + '。' : '') +
        '</p>'
        : '';

      diffBox.innerHTML =
        '<p class="diff-title deleted-note">已' + (soft ? '软' : '') + '删除 <code>' +
        esc(mutateState.id) + '</code>。下面是被删掉的那一行原文（留档对照）。</p>' +
        '<pre class="result">' + esc(JSON.stringify(body.data.deleted, null, 2)) + '</pre>' +
        softText +
        '<pre class="result">' + esc(goneText) + '</pre>';

      mutateState.row = null;
      mutateState.id = '';
      idInput.value = '';
      setMutateBadge('ok', soft ? '已软删除并复查' : '已删除并复查');
      loadNews();
    } catch (err) {
      out.hidden = false;
      out.textContent = '删除失败：' + err.message + '\n\n' + JSON.stringify(err.body || {}, null, 2);
      setMutateBadge('bad', err.body && err.body.error ? err.body.error.code : '失败');
      deleteBtn.disabled = false;
      patchBtn.disabled = false;
    }
  });
}

/**
 * 删除二次确认弹窗。
 * 用原生 <dialog>：自带模态、焦点陷阱、Esc 关闭，零依赖。
 *
 * @returns {Promise<boolean>} true = 用户确认删除
 */
function confirmDelete(row) {
  return new Promise(resolve => {
    const dlg = $('confirm-dialog');
    const body = $('confirm-body');

    // 把「要删的到底是哪一条」写清楚 —— 这是确认框能起作用的前提
    const desc = row.homeTeam
      ? (row.homeTeam + ' vs ' + row.awayTeam + '（' + (row.league || '') + '，' + (row.status || '') + '）')
      : (row.title || '（无标题）');
    body.innerHTML = '记录 id：<code>' + esc(row.id) + '</code><br>内容：' + esc(desc);

    function cleanup(result) {
      $('confirm-ok').removeEventListener('click', onOk);
      $('confirm-cancel').removeEventListener('click', onCancel);
      dlg.removeEventListener('cancel', onCancel);
      try { dlg.close(); } catch (e) { /* 已关闭 */ }
      resolve(result);
    }
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    $('confirm-ok').addEventListener('click', onOk);
    $('confirm-cancel').addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onCancel);   // Esc / 点遮罩关掉 = 取消

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else resolve(window.confirm('确定要删除这条记录吗？'));   // 极老浏览器兜底
  });
}

// ---------- 启动 ----------

function init() {
  $('api-origin').textContent = (window.API_ORIGIN || '') === ''
    ? '（本地同源代理 /api → 云函数网关）'
    : window.API_ORIGIN;
  $('page-origin').textContent = location.origin;

  initWriteForm();
  initMutatePanel();
  checkHealth();
  loadHot();
  loadNews();
}

init();
