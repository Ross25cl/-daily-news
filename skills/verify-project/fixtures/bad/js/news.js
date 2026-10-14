// 坏样本：网关地址与 league.js / api-config.js 三处都不一致
const FUNC_ORIGIN = 'https://ross-other-9999999999.ap-shanghai.app.tcloudbase.com';
async function fetchFromAPI(p) {
  const res = await fetch(FUNC_ORIGIN + p);
  return (await res.json()).data;
}
