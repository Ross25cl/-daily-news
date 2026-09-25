// ============================================================
// matches.js — 赛程比分页渲染逻辑
// 数据来源：data/matches.json（字段见 TECH_DESIGN 4.2）
// 职责：fetch 数据 → 昨天/今天/明天切换 → 渲染比赛卡片
//       （四要素 + 状态 + 比分 + 页面内展开详情）+ 大类筛选
//       （PRD 视图规则 2：大类筛选同时作用于速览与赛程列表）
// ============================================================

// league → 大类映射（与 app.js 保持一致，硬编码前端）
const LEAGUE_CATEGORY = {
  'NBA': '篮球',
  'CBA': '篮球',
  '英超': '足球',
  '中超': '足球',
  '欧冠': '足球',
  '电竞': '综合'
};

// 每场比赛的必填字段（TECH_DESIGN 4.2；比分仅已结束/进行中需要）
const REQUIRED_FIELDS = ['league', 'home_team', 'away_team', 'match_time', 'status', 'data_source', 'updated_at'];

let allMatches = [];        // 过滤后的合法比赛数据
let currentOffset = 0;      // 日期偏移：-1 昨天 / 0 今天 / 1 明天
let currentCategory = null; // 当前筛选大类；null = 全部显示

// ---------- 工具函数 ----------

function pad(x) {
  return String(x).padStart(2, '0');
}

// 相对今天的日期字符串，offset 为 -1/0/1
function dateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// HTML 转义
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

// league → 大类
function leagueCategory(league) {
  return LEAGUE_CATEGORY[league] || '综合';
}

// 从 "YYYY-MM-DD HH:mm" 或 ISO 字符串中取 HH:mm
function hm(s) {
  return s ? String(s).substring(11, 16) : '--';
}

// ---------- 渲染 ----------

// 状态徽标：「进行中」用醒目色，其余灰色
function statusTag(status) {
  const cls = status === '进行中' ? 'tag live' : 'tag gray';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}

// 单场比赛卡片的 HTML（PRD B1 四要素；B3/B4 比分；B5 详情默认收起）
function matchHTML(m) {
  const hasScore = (m.status === '已结束' || m.status === '进行中') &&
    m.home_score != null && m.away_score != null;
  const score = hasScore
    ? '<span class="score">' + esc(m.home_score) + ' : ' + esc(m.away_score) + '</span>'
    : '';
  return (
    '<article class="match-card" data-id="' + esc(m.id) + '">' +
      '<div class="match-top">' +
        '<span class="tag">' + esc(m.league) + '</span>' +
        '<span class="teams">' + esc(m.home_team) + ' vs ' + esc(m.away_team) + '</span>' +
        score +
        statusTag(m.status) +
      '</div>' +
      '<div class="match-sub">开赛时间 ' + hm(m.match_time) + '（北京时间） · 点击卡片展开详情</div>' +
      '<div class="detail">' +
        '轮次/阶段：' + esc(m.round || '未标注') + ' · ' +
        '开赛时间：' + esc(m.match_time) + ' · ' +
        '场地：' + esc(m.venue || '未标注') + '<br>' +
        '比分来源：' + esc(m.data_source) + ' · ' +
        '数据更新时间：' + hm(m.updated_at) +
      '</div>' +
    '</article>'
  );
}

// 按当前日期偏移 + 大类筛选重绘列表（PRD B2：无比赛日期显示提示）
function renderList() {
  const list = document.getElementById('match-list');
  const target = dateStr(currentOffset);
  const shown = allMatches
    .filter(m => m.match_time.substring(0, 10) === target)
    .filter(m => !currentCategory || leagueCategory(m.league) === currentCategory);

  const d = new Date(target + 'T00:00:00');
  const label = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const pre = currentOffset === -1 ? '昨天' : currentOffset === 1 ? '明天' : '今天';
  document.getElementById('matches-date-label').textContent =
    pre + ' · ' + label + ' · 共 ' + shown.length + ' 场';

  list.innerHTML = shown.length
    ? shown.map(matchHTML).join('')
    : '<p class="empty-hint">当日无重点赛事</p>';

  // 「数据最近更新时间」= 当前列表里最新的 updated_at（PRD 6.2：页面对用户展示）
  const times = shown.map(m => m.updated_at).filter(Boolean).sort();
  document.getElementById('updated-at').textContent =
    times.length ? hm(times[times.length - 1]) : '暂无';
}

// ---------- 交互绑定 ----------

// 日期切换按钮（PRD B2）
function bindDateSwitch() {
  const btns = document.querySelectorAll('.date-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentOffset = parseInt(btn.dataset.offset, 10);
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderList();
    });
  });
}

// 大类筛选按钮：点选生效，再点同一个恢复全部（与首页行为一致）
function bindFilterButtons() {
  const btns = document.querySelectorAll('.filter-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category;
      if (currentCategory === cat) {
        currentCategory = null;
        btn.classList.remove('active');
      } else {
        currentCategory = cat;
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      renderList();
    });
  });
}

// 点击卡片在页面内展开/收起详情（PRD B5：不跳离页面）
function bindCardToggle() {
  document.getElementById('match-list').addEventListener('click', e => {
    const card = e.target.closest('.match-card');
    if (card) card.classList.toggle('open');
  });
}

// ---------- 数据加载 ----------

function loadMatches() {
  fetch('data/matches.json')
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(list => {
      // 缺必填字段的比赛跳过，console.warn 指明 id（TECH_DESIGN 第 7 节）
      allMatches = (list || []).filter(m => {
        const missing = REQUIRED_FIELDS.filter(k => !m[k]);
        if (missing.length) {
          console.warn('[matches.js] 跳过缺字段比赛:', m.id || '(无 id)', '缺:', missing.join('/'));
          return false;
        }
        return true;
      });
      renderList();
    })
    .catch(err => {
      console.warn('[matches.js] 数据加载失败:', err);
      document.getElementById('match-list').innerHTML =
        '<p class="empty-hint">加载失败，请刷新重试</p>';
    });
}

// ---------- 启动 ----------

function initMatches() {
  const d = new Date();
  document.getElementById('today').textContent =
    d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  bindDateSwitch();
  bindFilterButtons();
  bindCardToggle();
  loadMatches();
}

initMatches();
