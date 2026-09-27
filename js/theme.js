// ============================================================
// theme.js — 全站深浅模式切换（Day 9 追加，三页共用）
// 背景：原来只有首页能切换（home.js），四板块/赛程页固定深色，
//       首页切白昼后跳页不同步。现在抽成公共逻辑，三页一种行为：
//       初始值由各页 <head> 内联脚本提前写入（防闪烁），
//       本文件只负责：按钮点击切换 + 图标同步，键沿用 hot-theme。
// ============================================================

function themeToggleIcon() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

(function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return; // 某页暂无按钮时静默跳过
  themeToggleIcon();
  btn.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('hot-theme', root.dataset.theme);
    themeToggleIcon();
  });
})();
