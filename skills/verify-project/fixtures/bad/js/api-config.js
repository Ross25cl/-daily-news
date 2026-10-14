// 坏样本：把静态托管域名当成接口地址（真实项目里接口在 *.app.tcloudbase.com 网关）
(function () {
  window.API_ORIGIN = 'https://ross-demo-1234567890.tcloudbaseapp.com';
  window.IS_LOCAL_PREVIEW = false;
})();
