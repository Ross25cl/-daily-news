// ============================================================
// home.js — 首页「三平台热搜」主视图渲染逻辑（Day 8 建，Day 17 接真实接口，Day 20 由 mock 收口）
// 数据来源：GET /api/hot（云函数 → CloudBase PG 的 hot_items 表，三平台官网真实热搜）
//           接口不可用时回落本地 data/hot.json（**并在页面上显式提示不是实时数据**）
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

// 平台 Logo 徽标文字（用文字徽标代替官方 Logo 素材，避免使用未授权图形）
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

// 渲染成功（整页无数据 → 整页空；某平台 items 为空 → 该平台空）
// Day 13：整页空补上副提示，与列表页/详情页的空态文案格式统一
function renderPlatforms(data) {
  const wrap = document.getElementById('platforms');
  const platforms = data.platforms || [];
  wrap.innerHTML = platforms.length
    ? platforms.map(platformCardHTML).join('')
    : '<div class="state-box">' +
        '<p class="state-emoji">🈳</p>' +
        '<p class="state-text">今日暂无任何平台热搜数据</p>' +
        '<p class="state-sub">稍后再来看看，或先浏览下方的赛程比分与体坛资讯。</p>' +
      '</div>';
  document.getElementById('updated-at').textContent = formatUpdatedAt(data.updated_at);
  showState('success');
}

// "2026-10-05T23:30:58+08:00" → "10-05 23:30"
// 传进来的是接口 meta.updatedAt，即数据库里的**真实抓取时间**（不是刷新时刻）。
function formatUpdatedAt(iso) {
  if (!iso) return '暂无';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '暂无';
  const p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 数据来源提示条（Day 20）：只在「接口不可用、回落本地备用数据」时显示。
// 宁可显式说明这份不是实时的，也不让页面默认看起来就是实时的。
function setSourceNote(text) {
  const el = document.getElementById('source-note');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

// ---------- 数据加载 ----------

const DEMO = new URLSearchParams(location.search).get('demo');

// 接口地址由 js/api-config.js 统一给出（必须先于本文件加载）：
//   线上 → 云函数网关绝对域名（跨域由网关的「跨域安全域名白名单」放行）
//   本地 → 空串，配合 serve.mjs 的 /api 同源代理，本地不产生跨域
// 为什么不能写相对路径 '/api/hot' 了事：静态托管域名与网关域名不同域，
//   相对路径会打到静态托管自身（404）。这条 Day 17 实测过，见
//   docs/cloudbase-deploy-day17.md 踩坑 5。
const FUNC_ORIGIN = window.API_ORIGIN || '';

function apiUrl(path) {
  return FUNC_ORIGIN + path;
}

async function fetchHotFromAPI() {
  const res = await fetch(apiUrl('/api/hot'), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const body = await res.json();
  if (!body || body.ok !== true) {
    throw new Error((body && body.error && body.error.message) || '接口返回异常');
  }
  const d = body.data || {};
  const meta = body.meta || {};
  return { platforms: d.platforms || [], updated_at: meta.updatedAt || '' };
}

// 本地备用数据：一份随站点发布的快照，只用于「接口挂了页面也不白屏」。
// 它不是实时数据，所以用上它时页面会同时亮出提示条。
async function fetchHotFromSnapshot() {
  const res = await fetch('data/hot.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadHot() {
  // 状态演示入口（便于自查四种状态）——Day 13 补齐：
  //   ?demo=loading     加载中（停在骨架屏）
  //   ?demo=empty       空（三个平台各自无条目）
  //   ?demo=empty-all   整页空（三平台全都没有数据）
  //   ?demo=error       错误（加载失败 + 重试按钮）
  //   不加参数          正常（成功）
  if (DEMO === 'error')   { setSourceNote(''); showError(); return; }
  if (DEMO === 'empty-all') { setSourceNote(''); renderPlatforms({ updated_at: '', platforms: [] }); return; }
  if (DEMO === 'empty')   { setSourceNote(''); renderPlatforms({ platforms: [{ id: 'hupu', name: '虎扑', desc: '步行街 24 小时榜', items: [] }, { id: 'tencent', name: '腾讯体育', desc: '首页要闻热榜', items: [] }, { id: 'cctv5', name: '央视体育', desc: '官方要闻', items: [] }] }); return; }
  if (DEMO === 'loading') { return; } // 保持骨架屏

  showState('loading');
  try {
    let data;
    try {
      // 只有一条路：调接口。接口挂了才允许回落，且回落必须让用户看得见。
      data = await fetchHotFromAPI();
      setSourceNote('');
    } catch (apiErr) {
      const url = apiUrl('/api/hot');
      console.warn('[home.js] 接口 ' + url + ' 不可用，回落本地备用数据：', apiErr);
      setSourceNote('提示：接口暂时不可用，本页显示的是本地备用数据（非实时）。' +
        (apiErr && apiErr.message ? '原因：' + apiErr.message : ''));
      data = await fetchHotFromSnapshot();
    }
    renderPlatforms(data);
  } catch (err) {
    console.warn('[home.js] 热搜数据加载失败：', err);
    setSourceNote('');
    showError();
  }
}

// ---------- 深浅模式 ----------
// Day 9 起主题逻辑抽到公共的 js/theme.js（三页共用、跨页同步），
// 这里不再重复实现；页面初始主题由 index.html <head> 内联脚本设置。

// ---------- 启动 ----------

function initHome() {
  document.getElementById('today').textContent =
    new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  document.getElementById('retry-btn').addEventListener('click', loadHot);
  loadHot();
}

initHome();
