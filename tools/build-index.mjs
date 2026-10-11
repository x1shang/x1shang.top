#!/usr/bin/env node
/**
 * tools/build-index.mjs — 扫描 site/ 目录，生成一份纯自动的页面清单
 *
 * ⚠️ 它生成的产物是 site/all.html，**不会**动 site/index.html
 *    （index.html 是手搓的磁贴入口页，别让脚本覆盖掉）
 *
 * 用法（脚本住在 x1shang 仓库里，默认扫的是工作区里的「导航页仓库」../site）：
 *   node x1shang/tools/build-index.mjs              # 扫描 ../../site，写 ../../site/all.html
 *   node x1shang/tools/build-index.mjs <目录>       # 指定其它目录
 *   SITE_DIR=... SITE_TITLE="我的站" node x1shang/tools/build-index.mjs
 *
 * 它做的事：
 *   1. 找出目录下所有 .html（跳过 index.html / 404.html / all.html）→ 列成卡片
 *   2. 找出所有"带 index.html 的子目录"（等于一个独立小站）→ 也列进去
 *   3. 非 ASCII 文件名（中文等）会警告：能跑，但 URL 会变成 %E4%BD%A0… 一串乱码
 */
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 默认目标 = 工作区里的导航页仓库（x1shang/tools/../../site）
const SITE = path.resolve(process.argv[2] ?? process.env.SITE_DIR ?? path.join(HERE, '..', '..', 'site'));
const TITLE = process.env.SITE_TITLE ?? '我们都.是.gay';
const HOST = process.env.SITE_HOST ?? 'xn--vnqp08bwj8a.xn--0iv.gay';
const OUT = process.env.SITE_OUT ?? 'all.html';
const SKIP = new Set(['index.html', '404.html', OUT.toLowerCase()]);

const isHtml = (n) => n.toLowerCase().endsWith('.html');
const hasNonAscii = (n) => /[^\x20-\x7e]/.test(n);

/** 人类可读的字节数 */
const size = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

const dir = await readdir(SITE, { withFileTypes: true });

// 散页：目录下的 .html
const pages = [];
for (const d of dir) {
  if (!d.isFile() || !isHtml(d.name) || SKIP.has(d.name.toLowerCase())) continue;
  const s = await stat(path.join(SITE, d.name));
  pages.push({ href: d.name, label: d.name.replace(/\.html?$/i, ''), size: s.size, mtime: s.mtime });
}
pages.sort((a, b) => a.href.localeCompare(b.href, 'zh'));

// 子站：子目录里有 index.html 的
const sites = [];
for (const d of dir) {
  if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
  try {
    const s = await stat(path.join(SITE, d.name, 'index.html'));
    sites.push({ href: `${d.name}/`, label: d.name, size: s.size, mtime: s.mtime });
  } catch { /* 没有 index.html，跳过 */ }
}
sites.sort((a, b) => a.href.localeCompare(b.href, 'zh'));

// 非 ASCII 文件名警告
const weird = [...pages, ...sites].filter((p) => hasNonAscii(p.href));
if (weird.length) {
  console.warn('\n⚠️  这些文件名含中文/非 ASCII，URL 会被百分号编码，建议改成英文或拼音：');
  for (const w of weird) console.warn('    ' + w.href);
}

if (!pages.length && !sites.length) {
  console.log('没有找到除 index.html / 404.html / ' + OUT + ' 之外的页面，什么都不做。');
  process.exit(0);
}

const card = (p) => `        <a class="item" href="${encodeURI(p.href)}">
          <span class="name">${p.label}</span>
          <span class="meta">${size(p.size)} · ${new Date(p.mtime).toISOString().slice(0, 10)}</span>
        </a>`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23ff6ec7'/%3E%3Cstop offset='.5' stop-color='%23a78bfa'/%3E%3Cstop offset='1' stop-color='%2367e8f9'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' rx='22' fill='%230d0d16'/%3E%3Ccircle cx='50' cy='50' r='24' fill='none' stroke='url(%23g)' stroke-width='9'/%3E%3C/svg%3E">
<style>
  :root{--bg:#0a0a11;--card:rgba(255,255,255,.045);--line:rgba(255,255,255,.09);--fg:#ececf4;--dim:#9a9ab0}
  *{box-sizing:border-box}
  body{margin:0;padding:48px 20px;background:
      radial-gradient(60rem 40rem at 15% -10%, rgba(255,110,199,.16), transparent 60%),
      radial-gradient(55rem 38rem at 90% 110%, rgba(103,232,249,.14), transparent 60%),
      var(--bg);
    color:var(--fg);min-height:100vh;
    font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .wrap{max-width:760px;margin:0 auto}
  header{text-align:center;margin-bottom:38px}
  h1{margin:0 0 8px;font-size:clamp(24px,5vw,34px);font-weight:700;
    background:linear-gradient(100deg,#ffd9f0,#e9d5ff 45%,#cffafe);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  header p{margin:0;color:var(--dim);font-size:14px;font-family:ui-monospace,Menlo,Consolas,monospace}
  h2{margin:34px 0 14px;font-size:14px;font-weight:600;color:var(--dim);letter-spacing:.08em;text-transform:uppercase}
  .grid{display:grid;gap:10px}
  .item{display:flex;justify-content:space-between;align-items:baseline;gap:16px;
    padding:15px 18px;border:1px solid var(--line);border-radius:14px;background:var(--card);
    text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}
  .item:hover{border-color:rgba(201,182,255,.5);transform:translateY(-1px)}
  .name{font-weight:600;word-break:break-all}
  .meta{color:var(--dim);font-size:12.5px;white-space:nowrap;font-family:ui-monospace,Menlo,Consolas,monospace}
  footer{margin-top:44px;text-align:center;color:#6f6f85;font-size:12.5px}
  .bar{height:3px;border-radius:99px;background:linear-gradient(90deg,#ff6ec7,#f9a8d4,#a78bfa,#67e8f9);margin-bottom:34px;opacity:.85}
</style>
</head>
<body>
  <div class="wrap">
    <div class="bar"></div>
    <header>
      <h1>${TITLE}</h1>
      <p>${HOST}</p>
    </header>
${sites.length ? `    <h2>子站</h2>\n    <div class="grid">\n${sites.map(card).join('\n')}\n    </div>\n` : ''}${pages.length ? `    <h2>页面</h2>\n    <div class="grid">\n${pages.map(card).join('\n')}\n    </div>\n` : ''}    <footer>由 <code>tools/build-index.mjs</code> 生成 · ${new Date().toISOString().slice(0, 10)}</footer>
  </div>
</body>
</html>
`;

await writeFile(path.join(SITE, OUT), html, 'utf8');
console.log(`✅ 已生成 ${path.join(SITE, OUT)}：${sites.length} 个子站 + ${pages.length} 个页面`);
