// ============================================================
// app.js — 首页（每日速览）渲染逻辑
// 数据来源：data/news.json（字段见 TECH_DESIGN 4.1）
// 职责：fetch 数据 → 按「今天 + 已发布」过滤 → 渲染四板块 + 大类筛选
// Day 11：筛选从瞬时替换升级为带反馈的交互——
//   点击 → 300ms 处理态（全按钮禁用防连点 + 骨架屏）
//        → 选中态（标签浅蓝渐变高亮 + 卡片淡入上滑动画）
//        → 筛选后为空的板块显示「暂无该赛事资讯」
// ============================================================

// league → 大类映射（TECH_DESIGN 4.4：硬编码前端）
// 篮球 = NBA/CBA；足球 = 英超/中超/欧冠；综合 = 电竞及其他
const LEAGUE_CATEGORY = {
  'NBA': '篮球',
  'CBA': '篮球',
  '英超': '足球',
  '中超': '足球',
  '欧冠': '足球',
  '电竞': '综合'
};

// 每条速览的必填字段（缺任一则跳过该条，TECH_DESIGN 第 7 节）
const REQUIRED_FIELDS = ['title', 'summary', 'section', 'league', 'source_name', 'source_url'];

// 处理态窗口时长：防连点 + 让骨架屏人眼可见（前端过滤本身几毫秒就完成）
const FILTER_DELAY = 300;

let allItems = [];          // 过滤后的「今天 + 已发布」条目
let currentCategory = null; // 当前筛选大类；null = 全部显示
let isFiltering = false;    // 处理态锁：true 期间忽略一切筛选点击

// ---------- 工具函数 ----------

// 今天日期，本地时区，格式 YYYY-MM-DD
function todayStr() {
  const d = new Date();
  const pad = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// HTML 转义：防止数据里的 < > & " 破坏页面结构
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

// league → 大类；映射表外的（含「综合」）一律归入综合
function leagueCategory(league) {
  return LEAGUE_CATEGORY[league] || '综合';
}

// ---------- 渲染 ----------

// 单条速览的 HTML（PRD A2：标题+摘要+来源+联赛标签；A3：新标签页打开原文）
// i 为板块内序号：只用于进场动画的错峰延迟，卡片内部 UI 结构不变（Day 11）
function itemHTML(it, i) {
  return (
    '<article class="item enter" style="animation-delay:' + (i * 60) + 'ms">' +
      '<div class="item-meta">' +
        '<span class="tag">' + esc(it.league) + '</span>' +
        '<span class="tag gray">来源：' + esc(it.source_name) + '</span>' +
      '</div>' +
      '<h3><a href="' + esc(it.source_url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a></h3>' +
      '<p>' + esc(it.summary) + '</p>' +
    '</article>'
  );
}

// 按当前大类筛选并重绘四个板块（PRD A4：空板块提示；A6：大类筛选）
// Day 11：空提示区分两种语义——筛选用户主动选了大类 → 「暂无该赛事资讯」；
// 没选大类但今天就是没数据 → 「今日暂无重大动态」。两者都带进场动画。
function applyFilter() {
  document.querySelectorAll('.digest-section').forEach(sec => {
    const name = sec.dataset.section;
    const body = sec.querySelector('.section-body');
    const shown = allItems.filter(it =>
      it.section === name &&
      (!currentCategory || leagueCategory(it.league) === currentCategory)
    );
    if (!shown.length) {
      body.innerHTML = '<p class="empty-hint enter">' +
        (currentCategory ? '暂无该赛事资讯' : '今日暂无重大动态') + '</p>';
      return;
    }
    body.innerHTML = shown.map(itemHTML).join('');
  });
}

// 处理态骨架屏（Day 11）：每个板块先替换为两张极简灰块卡片，
// 配合 CSS 脉冲动画，让「正在筛选」人眼可见
function showSkeletons() {
  const card =
    '<div class="skeleton-card" aria-hidden="true">' +
      '<div class="sk-line sk-title"></div>' +
      '<div class="sk-line"></div>' +
    '</div>';
  document.querySelectorAll('.section-body').forEach(body => {
    body.innerHTML = card + card;
  });
}

// 筛选按钮：点选生效，再点同一个恢复完整列表（PRD A6）
// Day 11 状态机：点击 → 处理态（锁定 + 禁用 + 骨架屏，300ms）
//   → 选中态（高亮新标签、恢复旧标签、重绘列表）；处理期间的连点一律忽略
function bindFilterButtons() {
  const btns = document.querySelectorAll('.filter-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (isFiltering) return;              // 处理态：忽略连点（双保险，禁用属性也会拦截）
      const cat = btn.dataset.category;
      const next = currentCategory === cat ? null : cat; // 再点同一个 = 撤销回全部

      isFiltering = true;
      btns.forEach(b => { b.disabled = true; }); // 防连点：处理期间全部禁用
      showSkeletons();

      window.setTimeout(() => {
        currentCategory = next;
        btns.forEach(b => {
          b.disabled = false;
          const on = b.dataset.category === currentCategory;
          b.classList.toggle('active', on);            // 新标签高亮，旧标签恢复默认
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        applyFilter();                                 // 重绘 + 淡入上滑动画
        isFiltering = false;
      }, FILTER_DELAY);
    });
  });
}

// 「最近更新时间」= 今天已发布条目中最新的 created_at（PRD A1）
function showUpdatedAt() {
  const el = document.getElementById('updated-at');
  const times = allItems.map(it => it.created_at).filter(Boolean).sort();
  if (!times.length) { el.textContent = '暂无'; return; }
  el.textContent = times[times.length - 1].substring(11, 16); // ISO 字符串直接取 HH:mm
}

// ---------- 数据加载 ----------

function loadNews() {
  fetch('data/news.json')
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(list => {
      const today = todayStr();
      // 前端过滤（TECH_DESIGN 5.1-1）：digest_date = 今天 且 status = published；
      // 缺必填字段的条目跳过，console.warn 指明 id（TECH_DESIGN 第 7 节）
      allItems = (list || []).filter(it => {
        if (it.digest_date !== today || it.status !== 'published') return false;
        const missing = REQUIRED_FIELDS.filter(k => !it[k]);
        if (missing.length) {
          console.warn('[app.js] 跳过缺字段条目:', it.id || '(无 id)', '缺:', missing.join('/'));
          return false;
        }
        return true;
      });
      showUpdatedAt();
      applyFilter();
    })
    .catch(err => {
      // fetch 失败/超时：不白屏，各板块显示可读提示（TECH_DESIGN 第 7 节）
      console.warn('[app.js] 数据加载失败:', err);
      document.querySelectorAll('.section-body').forEach(body => {
        body.innerHTML = '<p class="empty-hint">加载失败，请刷新重试</p>';
      });
    });
}

// ---------- 启动 ----------

function initApp() {
  // 顶部显示当天日期（PRD A1）
  const d = new Date();
  document.getElementById('today').textContent =
    d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  bindFilterButtons();
  loadNews();
}

initApp();
