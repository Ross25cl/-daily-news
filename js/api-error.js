// ============================================================
// api-error.js — 前端「三类错误」的中文话术（Day 23 建）
// ------------------------------------------------------------
// 为什么要有它：以前每个页面各写一句
//     if (!res.ok) throw new Error('HTTP ' + res.status);
//   结果用户看到的是「HTTP 500」「Failed to fetch」这类话 —— 那是给开发者看的，
//   不是给人看的。翻译工作散在 6 个文件里，改一处漏五处。
//
// 三类错误（与云函数 cloudfunctions/shared/httpKit.js 的 PUBLIC_MESSAGE 一一对应）：
//   ① 输入错   —— 用户填的东西不合规。后端给的中文说明更具体（「缺少必填字段：title…」），
//                所以**优先原样显示后端的话**，只有后端没说才用兜底句。
//   ② 网络错   —— 请求根本没到服务端（断网、DNS、被防火墙掐），fetch 直接 reject。
//   ③ 服务端错 —— 到了，但服务端出问题了。
//
// 用法（两个入口，覆盖两种失败点）：
//   fetch 有响应但状态/包络不对  → ApiError.fromResponse(res.status, body)
//   fetch 直接抛 / 其它 catch 到  → ApiError.fromError(err)
//
// 必须在本页脚本之前加载（<script src="js/api-error.js">）。
// ============================================================

(function () {
  // 三类错误的固定中文（与后端同源，改后端记得同步这里）
  var MESSAGE = {
    INPUT:   '输入有误，请检查后重试。',
    NETWORK: '网络连不上，请检查网络后重试。',
    SERVER:  '服务端开小差了，请稍后重试。'
  };

  // 浏览器原生异常的特征串 —— 命中的话说明是「网没通」，不是业务失败
  var NATIVE_NET = /failed to fetch|networkerror|load failed|network request failed|err_(connection|network|name_not_resolved|empty_response)|aborted/i;

  // HTTP 状态码 → 三类
  function kindOfStatus(status) {
    if (status === 400 || status === 401 || status === 403 || status === 422) return 'INPUT';
    if (status >= 500) return 'SERVER';
    // 404 / 其它 4xx：到这儿说明本页对它的语义没有专门处理，
    // 统一按「拿不到数据」兜底，别把裸状态码甩出去。
    return 'SERVER';
  }

  /**
   * 响应拿到了，但 ok 不为真。
   * 优先用后端给的中文 message（后端已统一成人话，且更具体）；
   * 后端没给才用三类兜底句 —— 绝不把「HTTP 502」这种原文直接给用户。
   */
  function fromResponse(status, body) {
    var backend = body && body.error && body.error.message;
    if (backend) return backend;
    return MESSAGE[kindOfStatus(status)] + '（HTTP ' + status + '）';
  }

  /**
   * catch 到的东西 → 人话。
   * 我们自己 throw 的 Error 其 message 已经是中文，原样用；
   * 浏览器原生的 TypeError: Failed to fetch 之类换成「网络错」。
   */
  function fromError(err) {
    var m = (err && err.message) ? String(err.message) : '';
    if (m && !NATIVE_NET.test(m)) return m;
    return MESSAGE.NETWORK;
  }

  window.ApiError = {
    MESSAGE: MESSAGE,
    kindOfStatus: kindOfStatus,
    fromResponse: fromResponse,
    fromError: fromError
  };
})();
