// 坏样本：存在这个文件，但没有导出 ApiError，页面拿不到中文错误文案
(function () {
  window.__apiErrorLoaded = true;
})();
