// 坏样本：只做了一层防重（写入前查），没有捕获并发撞唯一键 23505
const newsRepo = require('../shared/newsItemsRepository');

async function createFavorite(input) {
  const row = {
    id: 'fav-' + Date.now(),
    source_url: input.sourceUrl,
    created_at: new Date().toISOString()
  };
  const written = await newsRepo.insert(row);
  return { ok: true, data: written, meta: { created: true } };
}

module.exports = { createFavorite };
