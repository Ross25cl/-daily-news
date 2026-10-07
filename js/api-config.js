// ============================================================
// api-config.js — 接口地址的唯一出处（Day 20 建）
// ------------------------------------------------------------
// 为什么需要它：前端在静态托管域名（xxx.tcloudbaseapp.com），接口在云函数
// 网关域名（xxx.app.tcloudbase.com），**两者不同域** → 调接口天然是跨域。
//
// 【线上】直接打网关绝对地址。跨域由 CloudBase 网关按「跨域安全域名白名单」
//   放行 —— 白名单里只有本项目的静态托管域名，没有 * 通配符；从别的域名打开
//   这份页面是取不到数据的（这正是想要的效果）。
//
// 【本地】127.0.0.1 / localhost / 局域网 IP 不在白名单里，而体验版环境也
//   加不进去（实测报「当前套餐无法执行此操作」）→ 本地改走 serve.mjs 的
//   /api 同源代理：请求地址是相对路径，浏览器不认为跨域，也就不会被 CORS 拦。
//
// 用法：页面里 <script src="js/api-config.js"></script> 必须排在页面脚本之前，
//   之后统一用 window.API_ORIGIN + '/api/xxx' 拼地址。
// ============================================================

(function () {
  var host = location.hostname;

  // 本地开发：回环地址 + 本机局域网地址（手机 / 别人的电脑跟前台联调时用）
  var isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);

  // 线上：云函数网关绝对地址（变更后以 `tcb deploy` 打印的访问地址为准）
  window.API_ORIGIN = isLocal
    ? ''
    : 'https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com';

  window.IS_LOCAL_PREVIEW = isLocal;
})();
