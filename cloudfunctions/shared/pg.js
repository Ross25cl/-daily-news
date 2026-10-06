/**
 * ============================================================
 * shared/pg.js — 每日体坛速览 · 数据访问底座（Day 19 建）
 * ------------------------------------------------------------
 * 这一层只干一件事：**怎么连数据库**。
 * 它不认识任何业务表、也不知道「热搜」或「收藏」是什么概念 ——
 * 业务概念在各自的数据访问层（repository）里，见 shared/hotItemsRepository.js
 * 与 shared/newsItemsRepository.js。
 *
 * 分层位置：
 *   接口层（cloudfunctions/*\/index.js）  ← 接请求、调函数、返响应
 *     └─ 数据访问层（shared/*Repository.js）← 业务查询，一个业务一个文件
 *          └─ 连接底座（本文件）           ← HTTP 请求怎么发、错了怎么报
 *
 * 为什么走 CloudBase PG 的 HTTP API（PostgREST）而不是 pg 驱动：
 *   CloudBase 体验版（个人版）不支持数据库 TCP 直连——内网互联不开放、
 *   公网直连开关也打不开；且 HTTP 云函数不能在云端自动装依赖。
 *   → 零依赖：只用 Node 原生 https，不引任何 npm 包。
 *
 * 为什么连配置也搬到这一层（Day 19）：
 *   重构前 ENV_ID / API_KEY / REST_HOST / REST_BASE 在 api、favorites
 *   两个函数里各写了一份（复制粘贴）。现在它们是「怎么连库」的知识，
 *   属于数据访问层，唯一一份放在这里；接口层不再碰这些变量。
 *
 * 安全（清单要求 3：SQL 必须参数化，禁止拼接）：
 *   本层不拼 SQL —— 读走 PostgREST 的查询参数（?platform=eq.hupu）、
 *   写走 POST 的 JSON body，由平台侧编译成参数化 SQL。
 *   表名/列名一律来自调用方传的字面量（各 repository 里的白名单常量），
 *   用户输入只允许出现在「值」的位置，杜绝注入。
 * ============================================================
 */

const https = require('node:https');

// CloudBase PG 的 HTTP API 入口（PostgREST）
const ENV_ID = process.env.CB_ENV_ID || 'ross-d2gimwy406e0d6812';
const REST_HOST = ENV_ID + '.api.tcloudbasegateway.com';
const REST_BASE = '/v1/rdb/rest';

// 服务端密钥（控制台通过环境变量 CB_API_KEY 注入，**绝不写进代码/仓库**）
const API_KEY = process.env.CB_API_KEY || '';

// 单次数据库请求超时（毫秒）
const DB_TIMEOUT_MS = 8000;

/**
 * 读环境信息，供启动日志使用（不含密钥本身，只报「有没有」）。
 */
function connectionInfo() {
  return { envId: ENV_ID, apiKey: API_KEY ? 'injected' : 'missing' };
}

/**
 * 发一个到 PostgREST 的请求，返回解析后的 JSON。
 * 所有查询/写入都收敛到这里，上层只关心「拿哪张表、什么条件」。
 *
 * @param {string} method  HTTP 方法（GET / POST）
 * @param {string} table   表名（只允许字面量，不来自用户输入）
 * @param {object} [opts]
 * @param {object} [opts.query]  GET 查询参数，如 {platform:'eq.hupu', order:'rank.asc', limit:10}
 * @param {object} [opts.row]    POST 要写入的行（键为数据库列名 snake_case）
 * @returns {Promise<Array>} 行数组（写入时由 PostgREST 回传写入的那一行，故也是数组）
 */
function pgRequest(method, table, opts) {
  const options = opts || {};
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error('服务端未配置 API Key（环境变量 CB_API_KEY 缺失）'));
    }

    // ---- 拼 URL（查询参数编码；不含任何 SQL 拼接）----
    let path = REST_BASE + '/' + table;
    if (options.query) {
      const qs = Object.keys(options.query)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(options.query[k]))
        .join('&');
      if (qs) path += '?' + qs;
    }

    const headers = {
      'Authorization': 'Bearer ' + API_KEY,
      'Accept': 'application/json'
    };

    let payload = null;
    if (method === 'POST') {
      payload = JSON.stringify(options.row || {});
      headers['Content-Type'] = 'application/json';
      // return=representation：写入后回传整行 ——
      // 「写进去的到底是什么」由数据库说了算，不由我们猜。
      // 不开 resolution=merge-duplicates —— 要的就是「撞唯一键就报错」。
      headers['Prefer'] = 'return=representation';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request({
      host: REST_HOST,
      path: path,
      method: method,
      headers: headers,
      timeout: DB_TIMEOUT_MS
    }, resp => {
      let raw = '';
      resp.setEncoding('utf8');
      resp.on('data', c => { raw += c; });
      resp.on('end', () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          const err = new Error('数据库返回 HTTP ' + resp.statusCode + '：' + raw.slice(0, 300));
          // 把原始状态码与响应体挂在错误上，供接口层判重（如 PG 23505 唯一键冲突）
          err.dbStatus = resp.statusCode;
          err.dbBody = raw;
          return reject(err);
        }
        try {
          const rows = JSON.parse(raw);
          resolve(Array.isArray(rows) ? rows : []);
        } catch (e) {
          reject(new Error('数据库返回的不是合法 JSON：' + raw.slice(0, 200)));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('数据库请求超时（' + Math.round(DB_TIMEOUT_MS / 1000) + ' 秒）'));
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/**
 * 查一张表，返回行数组。
 * @param {string} table
 * @param {object} query  查询参数对象
 * @returns {Promise<Array>}
 */
function selectRows(table, query) {
  return pgRequest('GET', table, { query: query });
}

/**
 * 向一张表插一行，返回数据库回传的那一行对象（不是数组）。
 * @param {string} table
 * @param {object} row    键为数据库列名（snake_case）
 * @returns {Promise<object>}
 */
function insertRow(table, row) {
  return pgRequest('POST', table, { row: row }).then(rows => rows[0]);
}

module.exports = {
  connectionInfo: connectionInfo,
  selectRows: selectRows,
  insertRow: insertRow
};
