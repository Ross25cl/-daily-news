// ============================================================
// serve.mjs — 本地预览用的小服务器（Day 13 建）
//
// 为什么需要它：本项目的页面用 fetch 读 data/*.json，
//   直接双击 HTML（file:// 协议）会被浏览器拦截本地 JSON 请求，
//   页面会显示「加载失败」。必须通过 http:// 访问。
//
// 为什么用 Node 原生模块：零依赖、零安装、离线可用。
//   不依赖 python，也不用 npm install / npx（那需要联网下载）。
//
// 用法（在项目根目录执行）：
//     node serve.mjs
//   然后浏览器打开 http://127.0.0.1:8000/index.html
//
// 换端口：node serve.mjs 8080
// 退出：在这个窗口按 Ctrl + C
//
// 【Day 14 改动】监听地址由 127.0.0.1 改为 0.0.0.0（全网卡），
//   目的：让同一 WiFi 下的手机 / 别人的电脑也能打开本页做用户测试。
//   代价：测试期间本目录文件在局域网内可被访问 —— 测完按 Ctrl+C 关掉即止。
//   本机自用不受影响，仍可继续用 http://127.0.0.1:8000/index.html。
// ============================================================

// 【Day 20 改动】新增 /api/* 同源代理 → 云函数网关。
//   起因：线上页面直连网关绝对地址（跨域，靠网关的「跨域安全域名白名单」放行），
//   但 127.0.0.1 / localhost 加不进那份白名单（体验版实测报「当前套餐无法执行此操作」）
//   → 本地打开页面时浏览器按跨域处理，取不到数据，只能落到本地备用数据。
//   解法：本地由这个小服务器把 /api/* 转发到网关。页面请求的是相对路径，
//   对浏览器来说是同源，压根不发生跨域；白名单也不必为本地开口子。
//   线上页面不受影响：api-config.js 在线上依然给出网关绝对地址。

import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));   // 脚本所在目录 = 项目根目录
const PORT = Number(process.argv[2]) || 8000;
const HOST = '0.0.0.0';   // 监听全部网卡（原为 127.0.0.1，Day 14 为局域网测试放开）

// 云函数网关地址（与 js/api-config.js 里的线上地址保持一致）
const API_ORIGIN = 'https://ross-d2gimwy406e0d6812-1499705719.ap-shanghai.app.tcloudbase.com';

// /api/* → 网关。方法、路径、查询串、请求体原样转发，响应原样回给浏览器。
function proxyApi(req, res) {
  const target = new URL(req.url, API_ORIGIN);
  const headers = Object.assign({}, req.headers);
  headers.host = target.hostname;
  // 这是服务器发出的请求，不是浏览器的跨域请求：去掉 Origin / Referer，
  // 免得网关把它当成一个不在白名单里的来源来处理。
  delete headers.origin;
  delete headers.referer;

  const upstream = httpsRequest({
    host: target.hostname,
    path: target.pathname + target.search,
    method: req.method,
    headers: headers
  }, up => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });

  upstream.on('error', err => {
    console.log('502  ' + req.url + ' → 代理失败：' + err.message);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: false,
      error: { code: 'PROXY_ERROR', message: '本地代理到云函数失败：' + err.message }
    }));
  });

  req.pipe(upstream);
}

// 取出本机所有局域网 IPv4 地址，启动时打印出来，方便手机直接输入
function lanIPv4List() {
  const list = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) list.push(info.address);
    }
  }
  return list;
}

// 扩展名 → Content-Type（中文与 JSON 都要显式给 UTF-8，否则乱码）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  try {
    // 1) 解析 URL，去掉查询参数（?cat=足球&demo=empty 这类前端参数服务器不关心）
    const urlPath = decodeURIComponent(new URL(req.url, 'http://' + HOST).pathname);

    // 1.5) /api/* 交给代理（Day 20）：本地无跨域，页面拿到的就是真接口数据
    if (urlPath.indexOf('/api/') === 0) {
      console.log(req.method + '  ' + req.url + ' → 代理到网关');
      return proxyApi(req, res);
    }

    // 2) 目录 → 默认首页；并做路径穿越防护（不允许请求到项目目录以外）
    //    注意：必须先把 .. 与 . 解析掉，再判断最终路径是否还在 ROOT 之内，
    //    否则 /../xxx 这类请求会被 normalize 悄悄折回根目录内，防护形同虚设。
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = resolve(ROOT, '.' + rel);
    const rootWithSep = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
    if (filePath !== ROOT && !filePath.startsWith(rootWithSep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 禁止访问项目目录以外的路径');
      console.log('403  ' + urlPath);
      return;
    }

    // 3) 读取文件；不存在 → 404
    let data;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) throw new Error('is a directory');
      data = await readFile(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<meta charset="utf-8">' +
        '<h1>404 找不到这个文件</h1>' +
        '<p>请求的路径：<code>' + urlPath + '</code></p>' +
        '<p><a href="/index.html">回到首页</a></p>'
      );
      console.log('404  ' + urlPath);
      return;
    }

    // 4) 返回；加 no-store 避免改完代码刷新还是旧内容
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
    console.log('200  ' + urlPath);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 服务器内部错误：' + err.message);
    console.log('500  ' + req.url + ' → ' + err.message);
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('端口 ' + PORT + ' 已被占用。两个办法：');
    console.log('  1) 换个端口：node serve.mjs ' + (PORT + 1));
    console.log('  2) 找到占用它的程序：在 PowerShell 里执行 netstat -ano | findstr :' + PORT);
    console.log('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const lan = lanIPv4List();
  console.log('');
  console.log('  每日体坛速览 · 本地预览已启动');
  console.log('  ----------------------------------------');
  console.log('  本机（这台电脑自己看）：');
  console.log('    首页      http://127.0.0.1:' + PORT + '/index.html');
  console.log('    资讯列表  http://127.0.0.1:' + PORT + '/news.html?cat=足球');
  console.log('    资讯详情  http://127.0.0.1:' + PORT + '/news-detail.html?id=20260929-n01');
  console.log('    接口检查台 http://127.0.0.1:' + PORT + '/checkup.html');
  console.log('  ----------------------------------------');
  console.log('  接口 /api/* 已代理到云函数网关（本地不产生跨域）');
  console.log('  ----------------------------------------');
  if (lan.length) {
    console.log('  局域网（手机/别的电脑，需连同一个 WiFi）：');
    for (const ip of lan) {
      console.log('    ★ http://' + ip + ':' + PORT + '/');
    }
    console.log('    手机浏览器输入上面这条（含 http:// 和端口号）');
  } else {
    console.log('  没找到局域网 IPv4 地址 —— 检查电脑是否连着 WiFi/网线');
  }
  console.log('  ----------------------------------------');
  console.log('  按 Ctrl + C 退出（退出后网页就打不开了）');
  console.log('  退出后局域网内的手机也立刻打不开，测试完请关掉');
  console.log('');
});
