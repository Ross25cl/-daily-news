// 坏样本：又一个写死的网关地址，且和 news.js 的值不一致
const FUNC_ORIGIN = 'https://ross-demo-1234567890.ap-shanghai.app.tcloudbase.com';
async function fetchFromAPI(p) {
  const res = await fetch(FUNC_ORIGIN + p);
  return (await res.json()).data;
}
