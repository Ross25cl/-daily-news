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
    bracket: '晋级图',
    race: '争冠形势',
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

// ============================================================
// 晋级图 / 争冠形势（Day 12 新增）
// 数据约定（各联赛 JSON）：
//   bracket.halves[].rounds[].matches[]：半区 → 轮次 → 对局；
//     轮次数与每轮场数不限 —— 赛制变化只改数据，不改渲染器（节点可扩展）
//   match.a / match.b：具体队伍 { seed, name, abbr, color }，
//     或引用上一场胜者 { winnerOf: '某场id' }（未决出 → 「胜者待定」）
//   match.scoreA/scoreB：系列赛大比分；winner:'a'|'b'|null；
//     status: '已结束' | '进行中' | '未开始'
//   bracket.leagueStage（可选）：瑞士轮/小组赛摘要（欧冠联赛阶段）
//   epl.race.zones[]：争冠形势分区（英超联赛制无季后赛，标签名动态变化）
// ============================================================

let BK_STATE = null; // { matchMap, edges }：连线绘制的数据来源

// 解析队伍槽位：引用则递归取上一场胜者；尚未决出返回 null（显示待定）
function bkResolveSide(side, matchMap) {
  if (!side) return null;
  if (side.winnerOf) {
    const src = matchMap[side.winnerOf];
    if (src && src.winner) return bkResolveSide(src.winner === 'a' ? src.a : src.b, matchMap);
    return null;
  }
  return side;
}

function bkScoreOf(m, key) {
  const v = key === 'a' ? m.scoreA : m.scoreB;
  return (v === null || v === undefined) ? '–' : String(v);
}

// 一支队伍行：胜者高亮、败者灰度、进行中领先方橙色、未决出待定
function bkTeamRow(side, match, key, matchMap) {
  const t = bkResolveSide(side, matchMap);
  if (!t) {
    return (
      '<div class="bk-team tbd">' +
        '<span class="bk-seed">?</span><span class="bk-logo">?</span>' +
        '<span class="bk-name">胜者待定</span><b class="bk-score">–</b>' +
      '</div>'
    );
  }
  let cls = 'bk-team';
  if (match.status === '已结束') cls += (match.winner === key ? ' win' : ' lose');
  else if (match.status === '进行中') {
    cls += ((match.scoreA > match.scoreB && key === 'a') ||
            (match.scoreB > match.scoreA && key === 'b')) ? ' lead' : ' trail';
  }
  return (
    '<div class="' + cls + '" data-team="' + esc(t.name) + '" role="button" tabindex="0" ' +
      'title="查看球队详情（规划中）">' +
      '<span class="bk-seed">' + (t.seed != null ? t.seed : '·') + '</span>' +
      '<span class="bk-logo" style="background:' + esc(t.color) + '">' +
        esc(t.abbr || t.name.slice(0, 2)) + '</span>' +
      '<span class="bk-name">' + esc(t.name) + '</span>' +
      '<b class="bk-score">' + esc(bkScoreOf(match, key)) + '</b>' +
    '</div>'
  );
}

function bkMatchCard(m, matchMap) {
  const live = m.status === '进行中';
  return (
    '<article class="bk-match' + (live ? ' is-live' : '') + '" data-mid="' + esc(m.id) + '">' +
      (live ? '<i class="bk-live-dot" aria-hidden="true"></i>' : '') +
      bkTeamRow(m.a, m, 'a', matchMap) +
      bkTeamRow(m.b, m, 'b', matchMap) +
    '</article>'
  );
}

// 半区：轮次纵向列；右半区（hi=1）列序反转 —— 越靠中央轮次越深，与左半区对称汇聚
function bkHalfHTML(half, hi, matchMap) {
  const mirror = hi === 1;
  const rounds = mirror ? half.rounds.slice().reverse() : half.rounds;
  return (
    '<div class="bk-half' + (mirror ? ' mirror' : '') + '">' +
      '<div class="bk-half-name">' + esc(half.name) + '</div>' +
      '<div class="bk-rounds">' +
        rounds.map(r =>
          '<div class="bk-round">' +
            '<div class="bk-round-head">' + esc(r.name) +
              (r.format ? '<small>' + esc(r.format) + '</small>' : '') + '</div>' +
            '<div class="bk-round-body">' +
              r.matches.map(m => bkMatchCard(m, matchMap)).join('') +
            '</div>' +
          '</div>').join('') +
      '</div>' +
    '</div>'
  );
}

// 中央冠军卡：金边醒目 + 奖杯；冠军未产生时显示「冠军待产生」
function bkFinalHTML(f, matchMap) {
  const fteam = (side, key) => {
    const t = bkResolveSide(side, matchMap);
    if (!t) return '<div class="bk-fteam"><span class="bk-logo">?</span><span class="bk-fname">待定</span></div>';
    let cls = 'bk-fteam';
    if (f.status === '已结束') cls += (f.winner === key ? ' is-champ' : ' is-out');
    return (
      '<div class="' + cls + '" data-team="' + esc(t.name) + '" role="button" tabindex="0" ' +
        'title="查看球队详情（规划中）">' +
        '<span class="bk-logo" style="background:' + esc(t.color) + '">' +
          esc(t.abbr || t.name.slice(0, 2)) + '</span>' +
        '<span class="bk-fname">' + esc(t.name) + '</span>' +
      '</div>'
    );
  };
  const champDone = f.status === '已结束' && f.winner;
  const champName = champDone ? bkResolveSide(f.winner === 'a' ? f.a : f.b, matchMap).name : null;
  return (
    '<div class="bk-final-zone">' +
      '<aside class="bk-final" data-mid="__final">' +
        '<span class="bk-final-head">' + esc(f.name) +
          (f.format ? ' · ' + esc(f.format) : '') + '</span>' +
        '<div class="bk-final-grid">' +
          fteam(f.a, 'a') +
          '<div class="bk-final-mid">' +
            '<span class="bk-cup" aria-hidden="true">🏆</span>' +
            '<span class="bk-final-score">' +
              esc(bkScoreOf(f, 'a')) + ' - ' + esc(bkScoreOf(f, 'b')) + '</span>' +
            (champName
              ? '<span class="bk-champ-name">' + esc(champName) + ' 夺冠</span>'
              : '<span class="bk-champ-pending">冠军待产生</span>') +
          '</div>' +
          fteam(f.b, 'b') +
        '</div>' +
        (f.venue ? '<span class="bk-final-venue">' + esc(f.venue) + '</span>' : '') +
      '</aside>' +
    '</div>'
  );
}

// 建边表：每场对局 → 它喂给的下一场（半区最后一轮 → 决赛），用于 SVG 连线
function bkBuildEdges(bk) {
  const edges = [];
  bk.halves.forEach((h, hi) => {
    const side = hi === 0 ? 'L' : 'R';
    h.rounds.forEach((r, ri) => {
      const next = h.rounds[ri + 1];
      r.matches.forEach(m => {
        let to = null;
        if (next) {
          to = next.matches.find(x =>
            (x.a && x.a.winnerOf === m.id) || (x.b && x.b.winnerOf === m.id)) || null;
        } else if ((bk.final.a && bk.final.a.winnerOf === m.id) ||
                   (bk.final.b && bk.final.b.winnerOf === m.id)) {
          to = bk.final;
        }
        if (to) edges.push({ from: m.id, to: to.id || '__final', side: side });
      });
    });
  });
  return edges;
}

// ---------- Day 16 前置优化：晋级图全宽出血的两件小事 ----------

// ① 把「视口宽 − 纵向滚动条宽」写进 CSS 变量 --vw。
//    league.css 里 .bk-wrap 用 --vw 做全宽出血（左右负外边距）。
//    为什么不用 100vw：100vw 把滚动条那一份也算进去，页面有纵向滚动条时
//    条带会比可视区宽十几像素，反而顶出一条横向滚动条。
//    为什么不用 window.innerWidth：同上，它含滚动条。
//    documentElement.clientWidth 才是真正的可视内容宽度。
//    传 0 表示不清除（ResizeObserver 也会调它），只有值变了才写，避免反复触发重排。
function syncViewportVar() {
  const w = document.documentElement.clientWidth;
  if (w && w !== syncViewportVar._w) {
    syncViewportVar._w = w;
    document.documentElement.style.setProperty('--vw', w + 'px');
  }
}

// ② 按「是否真的溢出」决定横滑提示显不显示。
//    容器宽度统一后，能否放下取决于视口宽度而不是设备档位，
//    所以不再用固定断点，直接量 .bk-wrap 的内容宽和可视宽。
function syncBracketHint() {
  const wrap = document.querySelector('#lg-panel .bk-wrap');
  const hint = document.querySelector('#lg-panel .bk-scroll-hint');
  if (!wrap || !hint) return;
  hint.classList.toggle('off', wrap.scrollWidth <= wrap.clientWidth + 1);
}

// 渲染后按实际卡片坐标画 SVG 折线（轮次间 90° 转角连接线）；
// 已结束对局的晋级路径亮蓝，未完成路径灰色 —— 晋级路径一眼可读
function drawBracketLines() {
  const bracket = document.querySelector('#lg-panel .bracket');
  const svg = document.getElementById('bk-lines');
  if (!bracket || !svg || !BK_STATE) return;
  const cb = bracket.getBoundingClientRect();
  if (!cb.width) return;
  svg.setAttribute('viewBox', '0 0 ' + cb.width + ' ' + cb.height);
  const pos = {};
  bracket.querySelectorAll('[data-mid]').forEach(el => {
    const r = el.getBoundingClientRect();
    pos[el.dataset.mid] = {
      l: r.left - cb.left, r: r.right - cb.left,
      cy: r.top - cb.top + r.height / 2
    };
  });
  svg.innerHTML = BK_STATE.edges.map(e => {
    const f = pos[e.from], t = pos[e.to];
    if (!f || !t) return '';
    const lit = BK_STATE.matchMap[e.from] && BK_STATE.matchMap[e.from].status === '已结束';
    const x1 = e.side === 'L' ? f.r : f.l;
    const x2 = e.side === 'L' ? t.l : t.r;
    const mid = (x1 + x2) / 2;
    return '<path class="bk-edge' + (lit ? ' lit' : '') + '" d="M' + x1 + ',' + f.cy +
      ' H' + mid + ' V' + t.cy + ' H' + x2 + '" />';
  }).join('');
}

// 一次把三件事做完：视口变量 → 连线（依赖最终布局尺寸）→ 提示显隐
function syncBracketLayout() {
  syncViewportVar();
  drawBracketLines();
  syncBracketHint();
}

window.addEventListener('resize', syncBracketLayout);

// 纵向滚动条出现/消失也会改变可视宽度（但不触发 resize），
// 所以再挂一个 ResizeObserver 兜住这种情况，否则 --vw 会留一个旧值
if (window.ResizeObserver) {
  new ResizeObserver(syncViewportVar).observe(document.documentElement);
}

function renderBracket(bk) {
  if (!bk || !bk.halves || bk.halves.length < 2) return emptyBlock();
  const matchMap = {};
  bk.halves.forEach(h => h.rounds.forEach(r =>
    r.matches.forEach(m => { matchMap[m.id] = m; })));
  matchMap.__final = bk.final;
  BK_STATE = { matchMap: matchMap, edges: bkBuildEdges(bk) };

  // 瑞士轮/小组赛摘要（欧冠）：节点随数据展示，不参与树状图
  const stage = bk.leagueStage
    ? '<div class="bk-stage"><b>' + esc(bk.leagueStage.title) + '</b>' +
        '<div class="bk-stage-chips">' +
          (bk.leagueStage.direct || []).map(n =>
            '<span class="bk-chip">直通 · ' + esc(n) + '</span>').join('') +
          (bk.leagueStage.playoffWinners || []).map(n =>
            '<span class="bk-chip alt">附加赛 · ' + esc(n) + '</span>').join('') +
        '</div>' +
        (bk.leagueStage.note ? '<p class="bk-stage-note">' + esc(bk.leagueStage.note) + '</p>' : '') +
      '</div>'
    : '';

  return (
    '<div class="bk-root">' +
      bkToolbar(bk.seasons, bk.season) + stage +
      '<div class="bk-wrap"><div class="bracket">' +
        '<svg id="bk-lines" class="bk-lines" aria-hidden="true"></svg>' +
        bkHalfHTML(bk.halves[0], 0, matchMap) +
        bkFinalHTML(bk.final, matchMap) +
        bkHalfHTML(bk.halves[1], 1, matchMap) +
      '</div></div>' +
      (bk.note ? '<p class="bk-note">' + esc(bk.note) + '</p>' : '') +
    '</div>'
  );
}

// ---------- 争冠形势（英超专用；联赛制无季后赛，标签名动态变化） ----------

function renderRace(race) {
  if (!race || !race.zones || !race.zones.length) return emptyBlock();
  const formDots = form => (form || []).map(r =>
    '<i class="fd fd-' + esc(String(r).toLowerCase()) + '" title="' +
    esc(r === 'W' ? '胜' : r === 'D' ? '平' : '负') + '"></i>').join('');
  const trendMark = tr =>
    tr === 'up' ? '<span class="race-trend up" title="近况：上升">▲</span>'
    : tr === 'down' ? '<span class="race-trend down" title="近况：下滑">▼</span>'
    : '<span class="race-trend flat" title="近况：持平">—</span>';
  const maxPts = Math.max.apply(null,
    race.zones.reduce((arr, z) => arr.concat(z.teams.map(t => t.points || 0)), [])) || 1;

  const zoneHTML = z =>
    '<section class="race-zone" style="--zc:' + esc(z.color) + '">' +
      '<header class="race-zone-head"><b>' + esc(z.name) + '</b>' +
        (z.desc ? '<span>' + esc(z.desc) + '</span>' : '') + '</header>' +
      '<div class="race-teams">' + z.teams.map(t =>
        '<div class="race-team">' +
          '<span class="race-rank">' + esc(t.rank) + '</span>' +
          '<span class="bk-logo" style="background:' + esc(t.color) + '">' +
            esc(t.abbr || t.name.slice(0, 2)) + '</span>' +
          '<div class="race-main">' +
            '<div class="race-line1"><b class="race-name" role="button" tabindex="0" ' +
              'data-team="' + esc(t.name) + '" title="查看球队详情（规划中）">' + esc(t.name) + '</b>' +
              '<span class="race-gap">' + esc(t.gap || '') + '</span>' +
              trendMark(t.trend) + '</div>' +
            '<div class="race-line2"><span class="race-form">' + formDots(t.form) + '</span>' +
              '<span class="race-bar"><i style="width:' +
              Math.round((t.points || 0) / maxPts * 100) + '%"></i></span></div>' +
          '</div>' +
          '<div class="race-right"><b class="race-pts">' + esc(t.points) +
            '<small>分</small></b><span class="race-played">' + esc(t.played) + ' 赛</span></div>' +
        '</div>').join('') +
      '</div>' +
    '</section>';

  return (
    '<div class="bk-root">' +
      bkToolbar(race.seasons, race.season) +
      (race.asOf ? '<p class="race-asof">' + esc(race.asOf) + ' · 近 5 轮：<i class="fd fd-w"></i>胜 <i class="fd fd-d"></i>平 <i class="fd fd-l"></i>负</p>' : '') +
      race.zones.map(zoneHTML).join('') +
      (race.note ? '<p class="bk-note">' + esc(race.note) + '</p>' : '') +
    '</div>'
  );
}

// ---------- 晋级图/争冠形势共用：顶部控件与轻提示 ----------

function bkToolbar(seasons, current) {
  return (
    '<div class="bk-toolbar">' +
      '<label class="bk-season-wrap">赛季' +
        '<select class="bk-season" aria-label="选择赛季">' +
          (seasons || [current]).map(s =>
            '<option value="' + esc(s) + '"' + (s === current ? ' selected' : '') + '>' +
            esc(s) + ' 赛季</option>').join('') +
        '</select>' +
      '</label>' +
      '<button type="button" class="bk-follow" aria-pressed="false">关注 ⊕</button>' +
      '<span class="bk-scroll-hint">↔ 左右滑动查看完整对阵 · 手机可双指缩放</span>' +
    '</div>'
  );
}

function bkToast(msg) {
  let el = document.querySelector('.bk-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'bk-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(bkToast._t);
  bkToast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

// 面板内交互：关注切换、赛季下拉（历史赛季接 API 后提供）、球队点击占位提示
function attachLgPanelEvents(panel) {
  if (!panel) return;
  const follow = panel.querySelector('.bk-follow');
  if (follow) follow.addEventListener('click', () => {
    const on = follow.classList.toggle('on');
    follow.setAttribute('aria-pressed', on ? 'true' : 'false');
    follow.textContent = on ? '已关注 ✓' : '关注 ⊕';
    bkToast(on ? '已关注该赛季对阵（赛果推送待接入后端）' : '已取消关注');
  });
  const sel = panel.querySelector('.bk-season');
  if (sel) sel.addEventListener('change', () => {
    const cur = LEAGUE_DATA.bracket ? LEAGUE_DATA.bracket.season : LEAGUE_DATA.race.season;
    panel.innerHTML = '<p class="empty-hint">「' + esc(sel.value) +
      '」赛季的历史对阵将在接入后端 API 后提供；当前原型仅内置 ' + esc(cur) +
      ' 赛季示例数据。点上方子标签可切回。</p>';
  });
  panel.querySelectorAll('.bk-team:not(.tbd), .bk-fteam, .race-name').forEach(el => {
    const go = () => bkToast('「' + (el.dataset.team || '') + '」球队详情页规划于第 3 周（数据源接入后上线）');
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
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
    case 'bracket':   return renderBracket(data.bracket);
    case 'race':      return renderRace(data.race);
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

  // 面板内交互（关注/赛季切换/球队点击）与晋级图连线（Day 12）
  // Day 16：改为 syncBracketLayout —— 顺带同步 --vw（全宽出血用）与横滑提示
  attachLgPanelEvents(main.querySelector('#lg-panel'));
  requestAnimationFrame(syncBracketLayout);

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

// Day 18：接入接口层（与 js/home.js / js/news.js 同一套做法）。
// 绝对网关地址的原因见 js/news.js 顶部注释：静态托管域名与函数网关域名不同域。
// 本文件字段本来就用 camelCase（date/homeTeam/teamName/race.zones…），
// 与契约 §2.5 的输出口径一致，所以这里只需要换地址 + 解包络，不涉及改名。
const FUNC_ORIGIN = 'https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com';

// 通用接口取数：解包 { ok, data, meta }
async function fetchFromAPI(path) {
  const res = await fetch(FUNC_ORIGIN + path, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const body = await res.json();
  if (!body || body.ok !== true) {
    throw new Error((body && body.error && body.error.message) || '接口返回异常');
  }
  return body.data;
}

// 本地示例数据兜底
async function fetchLeagueFromLocal(lg) {
  // no-store：本地 JSON 会随录入频繁更新，禁用启发式缓存避免「看到旧一天的数据」
  const res = await fetch('data/' + lg + '.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// 优先接口 /api/leagues/<lg>，失败降级本地 data/<lg>.json；两条都失败才进错误态
async function fetchLeagueData(lg) {
  try {
    return await fetchFromAPI('/api/leagues/' + encodeURIComponent(lg));
  } catch (apiErr) {
    console.warn('[league.js] 接口 /api/leagues/' + lg + ' 不可用，降级本地示例数据:', apiErr);
    return await fetchLeagueFromLocal(lg);
  }
}

async function initLeague() {
  // hash 变化（点 Tab / 前进后退）→ 重画内容区
  window.addEventListener('hashchange', () => { if (LEAGUE_DATA) draw(currentTab()); });
  try {
    paint(await fetchLeagueData(currentLeague()));
  } catch (err) {
    console.warn('[league.js] 联赛数据加载失败:', err);
    showError();
  }
}

initLeague();
