// 坏样本 1：裸相对路径 fetch('/api/hot')
// 坏样本 2：把展示用的队徽指向腾讯防盗链图源
async function loadHot() {
  const res = await fetch('/api/hot');
  const body = await res.json();
  return body.data;
}
const BADGE_FALLBACK = 'https://sports3.gtimg.com/teamLogo/1001.png';
