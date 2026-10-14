// 坏样本：改 / 删没有「必须带 eq. 过滤」的安全阀，少写条件就会命中整表
const API_KEY = process.env.CB_API_KEY;

async function updateRows(table, patch, query) {
  const qs = Object.keys(query).map(k => k + '=' + query[k]).join('&');
  return request('PATCH', '/' + table + '?' + qs, patch);
}

async function deleteRows(table, query) {
  const qs = Object.keys(query).map(k => k + '=' + query[k]).join('&');
  return request('DELETE', '/' + table + '?' + qs, null);
}

module.exports = { updateRows, deleteRows };
