// ============================================================
// home.js — 首页「三平台热搜」主视图渲染逻辑（Day 8）
// 数据来源：data/hot.json（本地 mock 数据，真实数据源第 2 周接入）
// 职责：fetch 数据 → 四种页面状态（加载中/成功/空/错误）→ 三平台卡片渲染
// 状态演示：URL 加 ?demo=error（错误）、?demo=empty（空）、?demo=loading（加载中）
// ============================================================

// ---------- 工具 ----------

// HTML 转义
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

// 热度值格式化：1234567 → 123.5万
function formatHeat(n) {
  n = Number(n) || 0;
  return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);
}

// 联赛标签 → 缩略图上的 emoji（仅视觉装饰）
function emojiFor(tag) {
  return ({ 'NBA': '🏀', 'CBA': '🏀', '英超': '⚽', '中超': '⚽', '欧冠': '⚽', '电竞': '🎮' })[tag] || '🏟️';
}

// 平台 Logo 徽标文字（mock 阶段用文字徽标，不复制官方 Logo 素材）
const LOGO_TEXT = { hupu: '虎扑', tencent: '腾讯体育', cctv5: 'CCTV·5' };

// 本地生成 80x80 SVG 缩略图（data URI，离线可用，无图片文件）
function makeThumb(platformId, tag, rank) {
  const palettes = {
    hupu: ['#e5484d', '#7f1d1d'],
    tencent: ['#3b82f6', '#1e3a8a'],
    cctv5: ['#b91c1c', '#450a0a']
  };
  const [c1, c2] = palettes[platformId] || ['#475569', '#1e293b'];
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
    '</linearGradient></defs>' +
    '<rect width="80" height="80" fill="url(#g)"/>' +
    '<text x="40" y="52" font-size="32" text-anchor="middle">' + emojiFor(tag) + '</text>' +
    '<text x="68" y="20" font-size="14" font-weight="bold" fill="rgba(255,255,255,.85)" text-anchor="middle">#' + rank + '</text>' +
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ---------- 可复用组件：单条热搜 / 平台卡片 ----------

// 单条热搜：排名 + 标题(原文链接) + 热度值 + 标签；前 3 名带 80x80 缩略图；腾讯条目带视频角标
function hotItemHTML(p, it) {
  const isTop = Number(it.rank) <= 3;
  const isVideo = p.id === 'tencent' && it.video;

  let thumbHTML = '';
  if (isTop) {
    thumbHTML =
      '<a class="hot-thumb" href="' + esc(it.url) + '" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">' +
        '<img src="' + makeThumb(p.id, it.tag, it.rank) + '" width="80" height="80" alt="">' +
        (isVideo ? '<i class="play-badge">▶</i>' : '') +
      '</a>';
  }

  return (
    '<li class="hot-item">' +
      '<span class="rank rank-' + esc(it.rank) + '">' + esc(it.rank) + '</span>' +
      '<div class="hot-main">' +
        '<a class="hot-title" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a>' +
        '<div class="hot-meta">' +
          '<span class="hot-tag">' + esc(it.tag || '综合') + '</span>' +
          '<span class="hot-heat">🔥 ' + formatHeat(it.heat) + '</span>' +
          (isVideo && !isTop ? '<span class="video-chip">▶ 视频</span>' : '') +
        '</div>' +
      '</div>' +
      thumbHTML +
    '</li>'
  );
}

// 平台卡片：顶部左 Logo + 名称 + 描述，右侧条数；下方热搜列表；空数据显示空状态
function platformCardHTML(p) {
  const items = p.items || [];
  const body = items.length
    ? '<ol class="hot-list">' + items.map(it => hotItemHTML(p, it)).join('') + '</ol>'
    : '<p class="empty-hint">该平台今日暂无热搜数据</p>';
  return (
    '<section class="platform-card platform-' + esc(p.id) + '">' +
      '<header class="platform-head">' +
        '<div class="platform-id">' +
          '<span class="logo-chip">' + esc(LOGO_TEXT[p.id] || p.name) + '</span>' +
          '<div><h2>' + esc(p.name) + '</h2><p class="platform-desc">' + esc(p.desc || '') + '</p></div>' +
        '</div>' +
        (items.length ? '<span class="platform-count">' + items.length + ' 条</span>' : '') +
      '</header>' +
      body +
    '</section>'
  );
}

// ---------- 四种页面状态切换 ----------

function showState(name) {
  document.getElementById('state-loading').hidden = name !== 'loading';
  document.getElementById('state-error').hidden = name !== 'error';
  document.getElementById('platforms').hidden = name !== 'success';
  document.getElementById('updated-at').textContent =
    name === 'loading' ? '…' : document.getElementById('updated-at').textContent;
}

function showError() {
  showState('error');
  document.getElementById('updated-at').textContent = '未知';
}

// 渲染成功（某平台 items 为空时展示「空」状态提示）
function renderPlatforms(data) {
  const wrap = document.getElementById('platforms');
  const platforms = data.platforms || [];
  wrap.innerHTML = platforms.length
    ? platforms.map(platformCardHTML).join('')
    : '<div class="state-box"><p class="state-emoji">🈳</p><p class="state-text">今日暂无任何平台热搜数据</p></div>';
  document.getElementById('updated-at').textContent = formatUpdatedAt(data.updated_at);
  showState('success');
}

// "2026-09-25T22:30:00+08:00" → "09-25 22:30"
function formatUpdatedAt(iso) {
  if (!iso || iso.length < 16) return '暂无';
  return iso.substring(5, 16).replace('T', ' ');
}

// ---------- 数据加载 ----------

const DEMO = new URLSearchParams(location.search).get('demo');

async function loadHot() {
  // 状态演示入口（便于自查四种状态）
  if (DEMO === 'error')   { showError(); return; }
  if (DEMO === 'empty')   { renderPlatforms({ platforms: [{ id: 'hupu', name: '虎扑', desc: '步行街热帖榜', items: [] }, { id: 'tencent', name: '腾讯体育', desc: '视频热榜', items: [] }, { id: 'cctv5', name: '央视体育', desc: '官方权威发布', items: [] }] }); return; }
  if (DEMO === 'loading') { return; } // 保持骨架屏

  showState('loading');
  try {
    const res = await fetch('data/hot.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderPlatforms(data);
  } catch (err) {
    console.warn('[home.js] 热搜数据加载失败:', err);
    showError();
  }
}

// ---------- 深浅模式切换（默认深色，记忆到 localStorage） ----------

function initTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem('hot-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  updateToggleIcon();
  document.getElementById('theme-toggle').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('hot-theme', root.dataset.theme);
    updateToggleIcon();
  });
}
function updateToggleIcon() {
  const dark = document.documentElement.dataset.theme !== 'light';
  document.getElementById('theme-toggle').textContent = dark ? '☀️' : '🌙';
}

// ---------- 启动 ----------

function initHome() {
  document.getElementById('today').textContent =
    new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  initTheme();
  document.getElementById('retry-btn').addEventListener('click', loadHot);
  loadHot();
}

initHome();
