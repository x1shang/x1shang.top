#!/usr/bin/env node
/**
 * tools/serve.mjs — 本地静态预览服务（零依赖，没有后端接口）
 *
 * 它只做三件事：
 *   1. 静态服务：把 x1shang/ 当站点根，给出 webp / wav / mjs 等正确的 MIME
 *   2. 自动加载：监听 content/ · inbox/photos/ · assets/music/，有变化就重建内容包
 *   3. 自动刷新：给访问到的 index.html 现场注入一段开发用脚本，重建完成后通知浏览器刷新
 *      （注入只发生在本地服务响应的 HTML 里，仓库里的 index.html 保持纯静态）
 *
 * 用法：
 *   node tools/serve.mjs [--port 8080] [--host 127.0.0.1] [--no-watch] [--no-build]
 */
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(path.join(HERE, '..'));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('--port', process.env.PORT || 8080));
const HOST = opt('--host', '127.0.0.1');
const WATCH = !flag('--no-watch');
const BUILD_ON_START = !flag('--no-build');
const log = (...a) => console.log(...a);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.opus': 'audio/opus', '.flac': 'audio/flac', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
};
const text = (res, code, body) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(body); };

/* ------------------------------------------------------------------ 构建（自动加载） */
const DEV_RELOAD = `<script>/* 本地预览服务注入：内容变化时自动刷新（部署产物里没有这段） */
try{const es=new EventSource('/__reload');es.onmessage=e=>{if(e.data==='reload')location.reload()};}catch(e){}
</script>`;

let buildQueue = Promise.resolve(), buildTimer = 0;
const clients = new Set();
function broadcast() { for (const res of clients) { try { res.write('data: reload\n\n'); } catch { clients.delete(res); } } }
function runBuild(reason = 'manual') {
  buildQueue = buildQueue.then(() => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, 'build-content.mjs'), '--photos', '--quiet'], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      if (code === 0) { log(`♻️  内容已重建（${reason}），浏览器会自动刷新`); broadcast(); }
      else log(`⚠️  重建失败（${reason}，exit ${code}）\n${out.trim()}`);
      resolve();
    });
  }));
  return buildQueue;
}
function scheduleBuild(reason, delay = 450) {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => runBuild(reason), delay);
}

/* ------------------------------------------------------------------ 静态文件 */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return text(res, 403, '越界');
  let target = file;
  if (!existsSync(target)) return text(res, 404, `没有找到 ${rel}（站内路由用的是 #，例如 /#articles）`);
  try { if (statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch { /* 交给下一句 */ }
  if (!existsSync(target)) return text(res, 404, '没有找到这个目录的 index.html');
  const ext = path.extname(target).toLowerCase();
  const noStore = ['.html', '.js', '.css', '.json', '.mjs'].includes(ext);
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': noStore ? 'no-store' : 'public, max-age=3600',
  };
  // 只给本地预览用的 HTML 注入自动刷新脚本，仓库里的文件不动
  if (ext === '.html') {
    const html = readFileSync(target, 'utf8').replace(/<\/body>/i, `${DEV_RELOAD}</body>`);
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, { ...headers, 'content-length': buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': statSync(target).size });
  createReadStream(target).pipe(res);
}

/* ------------------------------------------------------------------ 服务 */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/__reload') {          // 开发用的 SSE 通道
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* 断线由 close 处理 */ } }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, '只支持 GET');
  serveStatic(req, res, url);
});

function watchDirs() {
  watch(ROOT, (event, name) => {
    if (String(name) === 'tips.json') scheduleBuild('tips', 400);
  });
  for (const dir of [path.join(ROOT, 'content'), path.join(ROOT, 'inbox'), path.join(ROOT, 'assets/music')]) {
    if (!existsSync(dir)) continue;
    try {
      watch(dir, { recursive: true }, (event, name) => {
        const file = String(name || '');
        if (/(^|[\\/])\.|\.tmp-|~$/.test(file)) return;
        log(`👀 ${path.relative(ROOT, path.join(dir, file))} 发生变化，重建中…`);
        scheduleBuild(dir.endsWith('inbox') ? 'inbox' : 'content', dir.endsWith('inbox') ? 800 : 400);
      });
      log(`👀 监听 ${path.relative(ROOT, dir)}/`);
    } catch (e) { log(`⚠️  无法监听 ${dir}：${e.message}`); }
  }
}

server.listen(PORT, HOST, async () => {
  const url = `http://${HOST}:${PORT}/`;
  log('');
  log('  x1shang 本地预览已启动（纯静态，无后端接口）');
  log(`  ▸ 站点：${url}`);
  log(`  ▸ 自动加载：${WATCH ? '监听 content/ · inbox/ · assets/music/，拖文件进来即重建并自动刷新' : '已关闭（--no-watch）'}`);
  log('');
  if (BUILD_ON_START) { await runBuild('startup'); log('  ▸ 内容包已就绪，浏览器打开上面的地址即可。\n'); }
  if (WATCH) watchDirs();
});

process.on('SIGINT', () => { log('\n  bye.'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 300); });
