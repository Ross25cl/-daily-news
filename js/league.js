// ============================================================
// league.js — 联赛板块页渲染逻辑（Day 10 建）
// 数据来源：data/nba.json | cba.json | ucl.json | epl.json（本地假数据）
// 结构预览阶段：Tab 由各数据文件的 tabs 数组驱动，字段名已统一规范
//（teamName / wins / points 等），接真实数据时只换数据不改代码。
// URL 约定：league.html?lg=nba|cba|ucl|epl ，Tab 状态写在 hash（#schedule）
// ============================================================

// ---------- 工具 ----------

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

// "2026-09-28T21:30:00+08:00" → "09-28 21:30"
function formatUpdatedAt(iso) {
  if (!iso || iso.length < 16) return '暂无';
  return iso.substring(5, 16).replace('T', ' ');
}

// "2026-09-28" → "9月28日 周一"
function formatDateHead(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return esc(dateStr);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 <span>' + week + '</span>';
}

// ---------- Tab 定义 ----------

// 每个 tab 的中文文案；standings 在篮球叫「排行」、足球叫「积分榜」
function tabLabel(tab, sport) {
  const labels = {
    schedule: '赛程',
    standings: sport === 'basketball' ? '排行' : '积分榜',
    playoffs: '季后赛',
    knockout: '淘汰赛',
    scorers: '射手榜',
    players: '球员数据'
  };
  return labels[tab] || tab;
}

// ---------- 通用渲染：表格 ----------

// headers: 表头文字数组；fields: 取值字段数组；opts.key 指定高亮列的字段名
function buildTable(headers, rows, fields, keyField) {
  const th = headers.map((h, i) =>
    '<th class="' + (fields[i] === 'playerName' || fields[i] === 'teamName' ? 'left' : '') + '">' + esc(h) + '</th>'
  ).join('');
  const trs = rows.map(r => {
    const tds = fields.map((f, i) => {
      const align = (f === 'playerName' || f === 'teamName') ? 'left' : '';
      const cls = [align, f === 'playerName' ? 'name' : '', f === keyField ? 'key' : ''].filter(Boolean).join(' ');
      const v = r[f] !== undefined && r[f] !== null ? r[f] : '—';
      return '<td class="' + cls + '">' + esc(v) + '</td>';
    }).join('');
    return '<tr>' + tds + '</tr>';
  }).join('');
  return (
    '<div class="lg-table-wrap"><table class="lg-table">' +
    '<thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table></div>'
  );
}

// ---------- 各 Tab 渲染器 ----------

// 赛程：按日期分组 → 日期头 + 比赛卡
function renderSchedule(items) {
  if (!items || !items.length) return emptyBlock();
  const groups = {};
  items.forEach(m => { (groups[m.date] = groups[m.date] || []).push(m); });

  return Object.keys(groups).sort().map(date => {
    const cards = groups[date].map(m => {
      const started = m.status === '已结束' || m.status === '进行中';
      const stCls = m.status === '已结束' ? 'st-done' : (m.status === '进行中' ? 'st-live' : 'st-todo');
      const score = started
        ? '<span class="lg-score">' + esc(m.homeScore) + ' : ' + esc(m.awayScore) + '</span>'
        : '<span class="lg-score vs">VS</span>';
      return (
        '<div class="lg-match">' +
          '<div class="lg-match-top"><span class="lg-round">' + esc(m.round || '常规赛') + '</span>' +
          '<span class="lg-status ' + stCls + '">' + esc(m.status) + '</span></div>' +
          '<div class="lg-match-main">' +
            '<span class="lg-team">' + esc(m.homeTeam) + '</span>' + score +
            '<span class="lg-team away">' + esc(m.awayTeam) + '</span>' +
          '</div>' +
          '<p class="lg-match-sub">' + esc(m.time) + ' · ' + esc(m.venue || '场地待定') + '</p>' +
        '</div>'
      );
    }).join('');
    return '<div class="lg-date-group"><h3 class="lg-date-head">' + formatDateHead(date) + '</h3>' + cards + '</div>';
  }).join('');
}

// 排行 / 积分榜：篮球列（胜/负/净胜/胜率），足球列（赛/胜/平/负/进/失/积分）
function renderStandings(items, sport) {
  if (!items || !items.length) return emptyBlock();
  const isBasket = sport === 'basketball';
  const headers = isBasket
    ? ['#', '球队', '胜', '负', '净胜', '胜率']
    : ['#', '球队', '赛', '胜', '平', '负', '进', '失', '积分'];
  const fields = isBasket
    ? ['rank', 'teamName', 'wins', 'losses', 'pointsDiff', 'winRate']
    : ['rank', 'teamName', 'played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst', 'points'];
  return buildTable(headers, items, fields, isBasket ? null : 'points');
}

// 季后赛 / 淘汰赛：对阵卡（篮球比分=系列赛胜场，数据 note 里已注明）
function renderTies(items) {
  if (!items || !items.length) return emptyBlock();
  return items.map(t => {
    const stCls = t.status === '已结束' ? 'st-done' : (t.status === '进行中' ? 'st-live' : 'st-todo');
    const started = t.status === '已结束' || t.status === '进行中';
    const score = started
      ? '<span class="lg-score">' + esc(t.homeScore) + ' : ' + esc(t.awayScore) + '</span>'
      : '<span class="lg-score vs">VS</span>';
    return (
      '<div class="lg-match">' +
        '<div class="lg-match-top"><span class="lg-round">' + esc(t.round) + '</span>' +
        '<span class="lg-status ' + stCls + '">' + esc(t.status) + '</span></div>' +
        '<div class="lg-match-main">' +
          '<span class="lg-team">' + esc(t.homeTeam) + '</span>' + score +
          '<span class="lg-team away">' + esc(t.awayTeam) + '</span>' +
        '</div>' +
        '<p class="lg-match-sub">' + esc(t.date || '') + '</p>' +
        (t.note ? '<p class="lg-note">' + esc(t.note) + '</p>' : '') +
      '</div>'
    );
  }).join('');
}

// 球员数据：篮球（得分/篮板/助攻）与足球（出场/进球/助攻/评分）字段不同
// 射手榜：进球/助攻
function renderPlayers(items, sport) {
  if (!items || !items.length) return emptyBlock();
  if (sport === 'basketball') {
    return buildTable(['#', '球员', '球队', '得分', '篮板', '助攻'],
      items, ['rank', 'playerName', 'teamName', 'points', 'rebounds', 'assists'], 'points');
  }
  return buildTable(['#', '球员', '球队', '出场', '进球', '助攻', '评分'],
    items, ['rank', 'playerName', 'teamName', 'apps', 'goals', 'assists', 'rating'], 'goals');
}

function renderScorers(items) {
  if (!items || !items.length) return emptyBlock();
  return buildTable(['#', '球员', '球队', '进球', '助攻'],
    items, ['rank', 'playerName', 'teamName', 'goals', 'assists'], 'goals');
}

function emptyBlock() {
  return '<p class="empty-hint">该模块暂无数据（接真实数据时在此展示）</p>';
}

// 根据 tab 类型选择渲染器
function renderTab(tab, data) {
  switch (tab) {
    case 'schedule':  return renderSchedule(data.schedule);
    case 'standings': return renderStandings(data.standings, data.sport);
    case 'playoffs':
    case 'knockout':  return renderTies(data[tab]);
    case 'players':   return renderPlayers(data.players, data.sport);
    case 'scorers':   return renderScorers(data.scorers);
    default:          return emptyBlock();
  }
}

// ---------- 页面装配 ----------

let LEAGUE_DATA = null;

function currentTab() {
  const tabs = (LEAGUE_DATA && LEAGUE_DATA.tabs) || ['schedule'];
  const fromHash = (location.hash || '').replace('#', '');
  return tabs.indexOf(fromHash) >= 0 ? fromHash : tabs[0];
}

function draw(tab) {
  const main = document.getElementById('league-main');
  main.innerHTML =
    '<div class="lg-head">' +
      '<span class="lg-emoji">' + esc(LEAGUE_DATA.emoji || '🏟️') + '</span>' +
      '<h2>' + esc(LEAGUE_DATA.leagueName) + '</h2>' +
      '<p class="lg-desc">' + esc(LEAGUE_DATA.desc || '') + '</p>' +
    '</div>' +
    '<div class="lg-tabs" role="tablist" aria-label="联赛子标签">' +
      LEAGUE_DATA.tabs.map(t =>
        '<button type="button" role="tab" class="lg-tab' + (t === tab ? ' active' : '') + '" ' +
        'data-tab="' + esc(t) + '" aria-selected="' + (t === tab) + '">' +
        esc(tabLabel(t, LEAGUE_DATA.sport)) + '</button>'
      ).join('') +
    '</div>' +
    '<div id="lg-panel">' + renderTab(tab, LEAGUE_DATA) + '</div>';

  // Tab 点击切换：写入 hash，方便刷新/后退保留
  main.querySelectorAll('.lg-tab').forEach(btn => {
    btn.addEventListener('click', () => { location.hash = btn.dataset.tab; });
  });
}

function paint(data) {
  LEAGUE_DATA = data;
  document.title = data.leagueName + ' · 每日体坛速览';
  document.getElementById('league-title').textContent = (data.emoji || '') + ' ' + data.leagueName;
  document.getElementById('league-sub').textContent = data.desc || '';
  document.getElementById('updated-at').textContent = formatUpdatedAt(data.updated_at);
  // 导航高亮当前联赛
  const navLink = document.querySelector('.nav-link.lg-' + data.leagueId);
  if (navLink) navLink.classList.add('active');
  draw(currentTab());
}

function showError() {
  document.getElementById('league-main').innerHTML =
    '<div class="lg-error"><p style="margin:0">联赛数据加载失败。' +
    '若直接双击打开本页（file://），浏览器会拦截本地 JSON 请求，请通过本地服务器访问（如 <code>python -m http.server</code>）。</p>' +
    '<button type="button" onclick="location.reload()">重新加载</button></div>';
}

// ---------- 启动 ----------

const LG_WHITELIST = ['nba', 'cba', 'ucl', 'epl'];

function currentLeague() {
  const lg = (new URLSearchParams(location.search).get('lg') || 'nba').toLowerCase();
  return LG_WHITELIST.indexOf(lg) >= 0 ? lg : 'nba';
}

async function initLeague() {
  // hash 变化（点 Tab / 前进后退）→ 重画内容区
  window.addEventListener('hashchange', () => { if (LEAGUE_DATA) draw(currentTab()); });
  try {
    const res = await fetch('data/' + currentLeague() + '.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    paint(await res.json());
  } catch (err) {
    console.warn('[league.js] 联赛数据加载失败:', err);
    showError();
  }
}

initLeague();
