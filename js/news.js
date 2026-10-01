// ============================================================
// news.js — 体坛资讯列表页（V2）渲染逻辑（Day 13 建）
// 地址约定：news.html?cat=足球|篮球|综合
// 数据来源：data/news.json（与首页速览共用同一份数据，本日不新增数据）
//
// 职责：读 URL 分类参数 → fetch → 按大类过滤 → 渲染列表 → 点击进入详情页
//
// 与首页速览的关键区别：
//   首页回答「今天有什么」（按 digest_date = 今天过滤）；
//   列表页回答「某大类都有哪些资讯」（不限当天，展示全部已发布）。
//   所以这里**不按日期过滤**，否则今天（示例数据停在 09-29）会全空。
//
// 状态：加载中（骨架屏）/ 成功 / 空 / 错误 —— 四种，与其它页同一套做法。
// 演示入口：?demo=loading|empty|error（板块③补齐，见 docs/views.md 第 3.4 节）
// ============================================================

// league → 大类映射（与 app.js / matches.js 完全一致，硬编码前端）
// 篮球 = NBA/CBA；足球 = 英超/中超/欧冠；综合 = 电竞及其他
const LEAGUE_CATEGORY = {
  'NBA': '篮球',
  'CBA': '篮球',
  '英超': '足球',
  '中超': '足球',
  '欧冠': '足球',
  '电竞': '综合'
};

// 分类白名单（与导航大类一致）；URL 参数非法时回落到默认分类
const CATS = ['足球', '篮球', '综合'];
const DEFAULT_CAT = '足球';

// 必填字段：缺任一则该条跳过（与 app.js 同规则）
const REQUIRED_FIELDS = ['title', 'summary', 'section', 'league', 'source_name', 'source_url'];

let allItems = [];               // 已发布且字段完整的条目
let currentCat = DEFAULT_CAT;    // 当前分类

// ---------- 工具 ----------

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

// league → 大类；映射表外的（含「综合」）一律归入综合
function leagueCategory(league) {
  return LEAGUE_CATEGORY[league] || '综合';
}

// "2026-09-29" → "09-29"
function shortDate(s) {
  return (s && s.length >= 10) ? s.substring(5, 10) : '--';
}

// ISO → "09-29 09:35"
function formatDateTime(iso) {
  return (iso && iso.length >= 16) ? iso.substring(5, 16).replace('T', ' ') : '暂无';
}

// 读 URL 的分类参数并做白名单校验；缺失或非法 → 默认分类
function catFromURL() {
  const raw = new URLSearchParams(location.search).get('cat') || '';
  return CATS.indexOf(raw) >= 0 ? raw : DEFAULT_CAT;
}

// ---------- 渲染 ----------

// 单条资讯卡片（PRD A2 同款信息结构：标题 + 摘要 + 联赛标签 + 来源）
// 整卡可点（鼠标），标题是真链接（键盘与「新标签打开」都正常）
function newsCardHTML(it) {
  const href = 'news-detail.html?id=' + encodeURIComponent(it.id);
  return (
    '<article class="news-card" data-href="' + esc(href) + '">' +
      '<div class="news-meta">' +
        '<span class="tag">' + esc(it.league) + '</span>' +
        '<span class="tag gray">' + esc(it.section) + '</span>' +
        '<span class="news-date">' + shortDate(it.digest_date) + '</span>' +
      '</div>' +
      '<h3><a href="' + esc(href) + '">' + esc(it.title) + '</a></h3>' +
      '<p>' + esc(it.summary) + '</p>' +
      '<p class="news-source">来源：' + esc(it.source_name) + '</p>' +
    '</article>'
  );
}

// 按当前分类过滤 + 重绘；空分类显示空态
function renderList() {
  const shown = allItems
    .filter(it => leagueCategory(it.league) === currentCat)
    .sort((a, b) =>
      (b.digest_date + ' ' + b.created_at).localeCompare(a.digest_date + ' ' + a.created_at)
    );

  document.getElementById('news-meta').textContent =
    currentCat + ' · 共 ' + shown.length + ' 条 · 按发布时间倒序';

  // 「最近更新」= 当前列表里最新的入库时间（与其它页同一口径）
  const times = shown.map(it => it.created_at).filter(Boolean).sort();
  document.getElementById('updated-at').textContent =
    times.length ? times[times.length - 1].substring(11, 16) : '暂无';

  const list = document.getElementById('news-list');
  if (shown.length) {
    list.innerHTML = shown.map(newsCardHTML).join('');
  } else {
    // 状态三：空（该分类下没有已发布条目）
    list.innerHTML =
      '<div class="state-box">' +
        '<p class="state-emoji">🈳</p>' +
        '<p class="state-text">该分类暂无资讯</p>' +
        '<p class="state-sub">换个分类看看，或明天再来。</p>' +
      '</div>';
  }
  showState('success');
}

// 四种状态切换：loading / success（含空）/ error
function showState(name) {
  document.getElementById('state-loading').hidden = name !== 'loading';
  document.getElementById('state-error').hidden = name !== 'error';
  document.getElementById('news-list').hidden = name !== 'success';

  // 无障碍（Day 13）：把当前状态播报给读屏软件，
  // 因为状态切换是 JS 直接改 hidden，读屏默认察觉不到。
  const ann = document.getElementById('news-announce');
  if (ann) {
    ann.textContent =
      name === 'loading' ? '正在加载' + currentCat + '资讯' :
      name === 'error'   ? '资讯加载失败' : '';
  }
}

// ---------- 分类切换 ----------

// 同步 Tab 的选中态与无障碍属性
function syncCatTabs() {
  document.querySelectorAll('.cat-tab').forEach(btn => {
    const on = btn.dataset.cat === currentCat;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

// 切换分类 = 换地址（多页面方案的真跳转，历史与地址栏交给浏览器）
// 这样刷新、复制链接、后退都能回到同一个分类，无需自己维护 history
function goCat(cat) {
  if (!cat || cat === currentCat) return;
  location.href = 'news.html?cat=' + encodeURIComponent(cat);
}

// 分类 Tab：点击切换；键盘左右箭头在分类间移动（无障碍）
function bindCatTabs() {
  const tabs = Array.from(document.querySelectorAll('.cat-tab'));
  tabs.forEach((btn, i) => {
    btn.addEventListener('click', () => goCat(btn.dataset.cat));
    btn.addEventListener('keydown', e => {
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft')  j = (i - 1 + tabs.length) % tabs.length;
      if (j < 0) return;
      e.preventDefault();
      tabs[j].focus();
      goCat(tabs[j].dataset.cat);
    });
  });
}

// 整卡点击进详情（点标题链接时不拦截，保留浏览器默认行为）
function bindCardClick() {
  document.getElementById('news-list').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const card = e.target.closest('.news-card');
    if (card && card.dataset.href) location.href = card.dataset.href;
  });
}

// ---------- 数据加载 ----------

function loadNews() {
  const demo = new URLSearchParams(location.search).get('demo');

  // 状态演示入口（板块③实现；此处先留钩子，便于自查四种状态）
  if (demo === 'error')   { showState('error'); return; }
  if (demo === 'empty')   { allItems = []; renderList(); return; }
  if (demo === 'loading') { showState('loading'); return; }

  showState('loading');
  fetch('data/news.json', { cache: 'no-store' })
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(list => {
      allItems = (list || []).filter(it => {
        if (it.status !== 'published') return false;   // 草稿对用户不可见
        const missing = REQUIRED_FIELDS.filter(k => !it[k]);
        if (missing.length) {
          console.warn('[news.js] 跳过缺字段条目:', it.id || '(无 id)', '缺:', missing.join('/'));
          return false;
        }
        return true;
      });
      renderList();
    })
    .catch(err => {
      console.warn('[news.js] 资讯加载失败:', err);
      showState('error');
    });
}

// ---------- 启动 ----------

function initNews() {
  currentCat = catFromURL();

  // 地址栏补全分类参数：直接访问 news.html 时也把状态写进地址（不产生新历史记录）
  if (!new URLSearchParams(location.search).get('cat')) {
    history.replaceState(null, '', 'news.html?cat=' + encodeURIComponent(currentCat));
  }

  document.getElementById('today').textContent =
    new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  syncCatTabs();
  bindCatTabs();
  bindCardClick();
  document.getElementById('retry-btn').addEventListener('click', loadNews);
  loadNews();
}

initNews();
