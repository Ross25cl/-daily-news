// 坏样本：把内部错误原文拼进了给客户端的响应文案
function fail(res, err) {
  const body = { ok: false, error: '服务端开小差了，请稍后重试。（' + err.message + '）' };
  res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

module.exports = { fail };
