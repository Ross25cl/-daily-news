// 坏样本：软删除的两个例外被「统一加了过滤」，会让序号重算撞主键
const pg = require('./pg');
const TABLE = 'news_items';

function findBySourceUrl(sourceUrl) {
  return pg.selectRows(TABLE, {
    select: 'id,title,is_deleted',
    source_url: 'eq.' + sourceUrl,
    limit: 1
  }).then(rows => rows.length ? rows[0] : null);
}

function countByDigestDate(digestDate) {
  return pg.selectRows(TABLE, {
    select: 'id',
    digest_date: 'eq.' + digestDate,
    is_deleted: 'eq.false'
  }).then(rows => rows.length);
}

module.exports = { findBySourceUrl, countByDigestDate };
