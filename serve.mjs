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
// ============================================================

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));   // 脚本所在目录 = 项目根目录
const PORT = Number(process.argv[2]) || 8000;
const HOST = '127.0.0.1';

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
  console.log('');
  console.log('  每日体坛速览 · 本地预览已启动');
  console.log('  ----------------------------------------');
  console.log('  首页      http://' + HOST + ':' + PORT + '/index.html');
  console.log('  资讯列表  http://' + HOST + ':' + PORT + '/news.html?cat=足球');
  console.log('  资讯详情  http://' + HOST + ':' + PORT + '/news-detail.html?id=20260929-n01');
  console.log('  ----------------------------------------');
  console.log('  按 Ctrl + C 退出（退出后网页就打不开了）');
  console.log('');
});
