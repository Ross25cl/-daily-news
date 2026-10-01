// ============================================================
// news-detail.js — 资讯详情页（V3）渲染逻辑（Day 13 建）
// 地址约定：news-detail.html?id=20260929-n01
// 数据来源：data/news.json（与列表页、首页速览同一份数据）
//
// 职责：读 URL 的 id → fetch → 找到该条（须为已发布）→ 渲染完整信息
//       + 同联赛相关条目推荐；找不到 → 空态；fetch 失败 → 错误态
//
// 内容边界（遵守 SKILL 1.2 与 PRD 9.1）：
//   只呈现该条**已有字段**（标题/摘要/板块/联赛/来源/日期），
//   **不转载原文正文、不存储全文**；完整内容走「查看原文」外链。
// ============================================================

// league → 大类映射（与其它页完全一致）
const LEAGUE_CATEGORY = {
  'NBA': '篮球',
  'CBA': '篮球',
  '英超': '足球',
  '中超': '足球',
  '欧冠': '足球',
  '电竞': '综合'
};

const CATS = ['足球', '篮球', '综合'];
const REQUIRED_FIELDS = ['title', 'summary', 'section', 'league', 'source_name', 'source_url'];

let allItems = [];
let currentItem = null;
let fallbackCat = '足球';   // 返回按钮的兜底分类（按条目大类推断）

// ---------- 工具 ----------

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

function leagueCategory(league) {
  return LEAGUE_CATEGORY[league] || '综合';
}

// "2026-09-29T09:35:00+08:00" → "2026-09-29 09:35"
function formatDateTime(iso) {
  if (!iso || iso.length < 16) return '暂无';
  return iso.substring(0, 16).replace('T', ' ');
}

// 读 URL 的 id 参数
function idFromURL() {
  return (new URLSearchParams(location.search).get('id') || '').trim();
}

// ---------- 状态切换 ----------

function showState(name) {
  document.getElementById('state-loading').hidden = name !== 'loading';
  document.getElementById('state-error').hidden = name !== 'error';
  document.getElementById('state-notfound').hidden = name !== 'notfound';
  document.getElementById('state-success').hidden = name !== 'success';
}

// ---------- 渲染 ----------

// 面包屑：资讯 › 大类 › 当前标题（前两级可点，最后一级为当前页）
function breadcrumbHTML(it) {
  const cat = leagueCategory(it.league);
  const catHref = 'news.html?cat=' + encodeURIComponent(cat);
  return (
    '<a href="' + catHref + '">资讯</a>' +
    '<span class="crumb-sep" aria-hidden="true">›</span>' +
    '<a href="' + catHref + '">' + esc(cat) + '</a>' +
    '<span class="crumb-sep" aria-hidden="true">›</span>' +
    '<span class="crumb-current" aria-current="page">' + esc(it.title) + '</span>'
  );
}

// 详情主体：标题 + 摘要 + 全部已有字段铺开 + 查看原文按钮
// 比列表卡片多出「板块归属 / 速览日期 / 入库时间 / 原文入口」四处信息
function detailHTML(it) {
  const rows = [
    ['所属板块', it.section],
    ['联赛 / 项目', it.league],
    ['来源名称', it.source_name],
    ['速览日期', it.digest_date],
    ['入库时间', it.created_at ? formatDateTime(it.created_at) : '—'],
    ['条目编号', it.id]
  ].map(r =>
    '<div class="field-row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1] || '—') + '</dd></div>'
  ).join('');

  return (
    '<div class="detail-head">' +
      '<span class="tag">' + esc(it.league) + '</span>' +
      '<span class="tag gray">' + esc(it.section) + '</span>' +
    '</div>' +
    '<h2 class="detail-title">' + esc(it.title) + '</h2>' +
    '<p class="detail-summary">' + esc(it.summary) + '</p>' +
    '<dl class="detail-fields">' + rows + '</dl>' +
    '<a class="detail-source-btn" href="' + esc(it.source_url) + '" ' +
       'target="_blank" rel="noopener">查看原文 ↗</a>' +
    '<p class="detail-note">本页只呈现该条资讯的已有字段，不转载原文正文；' +
       '完整内容请点上方按钮跳转来源网站。</p>'
  );
}

// 同联赛相关条目（最多 3 条，排除当前条）
function relatedHTML(list) {
  return list.map(it =>
    '<article class="news-card" data-href="news-detail.html?id=' + encodeURIComponent(it.id) + '">' +
      '<div class="news-meta">' +
        '<span class="tag">' + esc(it.league) + '</span>' +
        '<span class="tag gray">' + esc(it.section) + '</span>' +
      '</div>' +
      '<h3><a href="news-detail.html?id=' + encodeURIComponent(it.id) + '">' + esc(it.title) + '</a></h3>' +
    '</article>'
  ).join('');
}

function paint(it) {
  currentItem = it;
  fallbackCat = leagueCategory(it.league);

  document.title = it.title + ' · 每日体坛速览';
  document.getElementById('breadcrumb').innerHTML = breadcrumbHTML(it);
  document.getElementById('breadcrumb').hidden = false;
  document.getElementById('detail-body').innerHTML = detailHTML(it);

  // 同联赛其他条目，按发布时间倒序取 3 条；不足 3 条就有几条显示几条
  const related = allItems
    .filter(x => x.id !== it.id && x.league === it.league)
    .sort((a, b) =>
      (b.digest_date + ' ' + b.created_at).localeCompare(a.digest_date + ' ' + a.created_at)
    )
    .slice(0, 3);

  const box = document.getElementById('detail-related');
  if (related.length) {
    document.getElementById('related-list').innerHTML = relatedHTML(related);
    box.hidden = false;
  } else {
    box.hidden = true;
  }

  showState('success');
}

// ---------- 数据加载 ----------

function loadDetail() {
  const id = idFromURL();

  // 没有 id 参数 → 直接按「找不到」处理，不发请求
  if (!id) {
    console.warn('[news-detail.js] 地址缺少 id 参数');
    showState('notfound');
    bindRelatedClick();
    return;
  }

  const demo = new URLSearchParams(location.search).get('demo');
  if (demo === 'error')    { showState('error'); return; }
  if (demo === 'notfound') { showState('notfound'); return; }
  if (demo === 'loading')  { showState('loading'); return; }

  showState('loading');
  fetch('data/news.json', { cache: 'no-store' })
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(list => {
      allItems = (list || []).filter(it => {
        if (it.status !== 'published') return false;
        const missing = REQUIRED_FIELDS.filter(k => !it[k]);
        if (missing.length) {
          console.warn('[news-detail.js] 跳过缺字段条目:', it.id || '(无 id)', '缺:', missing.join('/'));
          return false;
        }
        return true;
      });

      const found = allItems.find(it => it.id === id);
      // 状态三：空 —— id 不存在，或该条是草稿（对用户不可见）
      if (!found) {
        console.warn('[news-detail.js] 未找到条目或该条未发布:', id);
        showState('notfound');
        bindRelatedClick();
        return;
      }
      paint(found);
      bindRelatedClick();
    })
    .catch(err => {
      console.warn('[news-detail.js] 详情加载失败:', err);
      showState('error');
    });
}

// 相关推荐整卡可点（点标题链接时不拦截）
function bindRelatedClick() {
  const box = document.getElementById('detail-related');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  box.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const card = e.target.closest('.news-card');
    if (card && card.dataset.href) location.href = card.dataset.href;
  });
}

// ---------- 启动 ----------

function initDetail() {
  document.getElementById('today').textContent =
    new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  // 返回上一页：优先用浏览器历史；直接从外部打开（无历史）时回落到资讯列表
  document.getElementById('back-btn').addEventListener('click', () => {
    if (window.history.length > 1) history.back();
    else location.href = 'news.html?cat=' + encodeURIComponent(fallbackCat);
  });

  document.getElementById('retry-btn').addEventListener('click', loadDetail);
  loadDetail();
}

initDetail();
