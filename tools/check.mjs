#!/usr/bin/env node
/**
 * tools/check.mjs — 上线前自检
 *   1. 所有前端脚本的语法（node --check 等价）
 *   2. content.auto.js 是不是合法 JSON 外壳
 *   3. index.html 里的本地引用是否都存在
 *   4. feed.xml / atom.xml 是否可解析
 *   5. 站点是否仍然保持纯静态（没有 api.js / data/ / 后端引用）
 * 用法：node tools/check.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..'));
let bad = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const no = (m) => { bad++; console.log(`  ✗ ${m}`); };
const warn = (m) => console.log(`  ! ${m}`);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

console.log('\n■ 脚本语法');
for (const f of ['app.js', 'render.js', 'content.js', 'content.auto.js', 'tools/build-content.mjs', 'tools/serve.mjs', 'tools/fetch-stats.mjs', 'tools/build-index.mjs', 'tools/check-site.mjs', 'tools/check-layout.mjs']) {
  const file = path.join(ROOT, f);
  if (!existsSync(file)) { no(`${f} 不存在`); continue; }
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status === 0) ok(f);
  else no(`${f}: ${(r.stderr || '').split('\n').filter(Boolean)[0] || '语法错误'}`);
}

console.log('\n■ 内容包');
{
  const file = path.join(ROOT, 'content.auto.js');
  if (!existsSync(file)) no('content.auto.js 不存在（先跑 node tools/build-content.mjs）');
  else {
    const raw = readFileSync(file, 'utf8');
    try {
      const auto = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      ok(`content.auto.js 可解析：文章 ${auto.articles.length} · 断言 ${auto.assertions.length} · 学术 ${auto.papers.length} · 摄影 ${auto.photos.length} · 音乐 ${auto.tracks.length} · 友链 ${auto.friends.length}`);
      for (const [k, v] of Object.entries(auto.stats || {})) if (typeof v !== 'number') no(`stats.${k} 不是数字`);
      const ids = new Set();
      for (const [kind, list] of [['article', auto.articles], ['assertion', auto.assertions], ['paper', auto.papers], ['photo', auto.photos], ['track', auto.tracks]]) {
        for (const it of list) {
          if (!it.id) no(`${kind} 有条目缺 id`);
          if (ids.has(`${kind}:${it.id}`)) no(`${kind}:${it.id} 重复`);
          ids.add(`${kind}:${it.id}`);
          if (it.date && !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) no(`${kind}:${it.id} 日期格式异常：${it.date}`);
        }
      }
      const photoFiles = [...auto.photos.map((p) => p.src), ...auto.photos.map((p) => p.thumb)];
      for (const f of photoFiles) if (f && !existsSync(path.join(ROOT, f))) no(`照片产物缺失：${f}`);
    } catch (e) { no(`content.auto.js 解析失败：${e.message}`); }
  }
}

console.log('\n■ 页面引用');
{
  const file = path.join(ROOT, 'index.html');
  const html = readFileSync(file, 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const r = m[1];
    if (/^(https?:|data:|mailto:|#|\/\/)/i.test(r)) continue;
    refs.add(r.split(/[?#]/)[0]);
  }
  for (const r of refs) {
    const full = path.join(ROOT, r);
    if (existsSync(full)) ok(r);
    else no(`找不到 ${r}`);
  }
}

console.log('\n■ 订阅源');
for (const f of ['feed.xml', 'atom.xml']) {
  const file = path.join(ROOT, f);
  if (!existsSync(file)) no(`${f} 不存在`);
  else {
    const s = readFileSync(file, 'utf8');
    const open = (s.match(/<item>/g) || []).length + (s.match(/<entry>/g) || []).length;
    if (!/^<\?xml/.test(s.trim())) no(`${f} 缺少 XML 声明`);
    else ok(`${f}（${open} 条）`);
  }
}

console.log('\n■ 分享卡片与统计');
{
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const wanted = [
    ['og:type', /property="og:type"/], ['og:site_name', /property="og:site_name"/], ['og:title', /property="og:title"/],
    ['og:description', /property="og:description"/], ['og:url', /property="og:url"/], ['og:image', /property="og:image"/],
    ['og:image:width', /property="og:image:width"/], ['og:image:height', /property="og:image:height"/],
    ['twitter:card', /name="twitter:card"/], ['canonical', /rel="canonical"/],
  ];
  for (const [name, re] of wanted) { if (re.test(html)) ok(`index.html 有 ${name}`); else no(`index.html 缺 ${name}`); }
  const og = html.match(/property="og:image" content="([^"]+)"/);
  if (og) {
    const local = og[1].replace(/^https?:\/\/x1shang\.top\//, '');
    if (existsSync(path.join(ROOT, local))) ok(`og:image 指向的文件在仓库里（${local}）`);
    else no(`og:image 指向的 ${local} 不在仓库里`);
  }
  if (/REPLACE_WITH_CF_BEACON_TOKEN/.test(html)) warn('Cloudflare Web Analytics 的 token 还是占位符（去后台 Add a site 后替换，见 index.html 注释）');
  else ok('Cloudflare Web Analytics token 已填');

  for (const f of ['robots.txt', 'sitemap.xml']) {
    if (existsSync(path.join(ROOT, f))) ok(`${f} 存在`); else no(`${f} 不存在`);
  }
  const rbFile = path.join(ROOT, 'robots.txt');
  const rb = existsSync(rbFile) ? readFileSync(rbFile, 'utf8') : '';
  if (/Sitemap:\s*https:\/\/x1shang\.top\/sitemap\.xml/.test(rb)) ok('robots.txt 里指向了 sitemap.xml');
  else no('robots.txt 没有指向 sitemap.xml 的 Sitemap 行');
  const sfFile = path.join(ROOT, 'sitemap.xml');
  if (existsSync(sfFile) && /<urlset/.test(readFileSync(sfFile, 'utf8'))) ok('sitemap.xml 结构正常');
  else no('sitemap.xml 缺失或结构异常');

  const statsFile = path.join(ROOT, 'stats.json');
  if (!existsSync(statsFile)) no('stats.json 不存在（关于页的访客图靠它）');
  else {
    try {
      const s = JSON.parse(readFileSync(statsFile, 'utf8'));
      if (!Array.isArray(s.series)) no('stats.json 缺 series 数组');
      else if (!s.series.length) warn(`stats.json 可解析，但还没有数据（source=${s.source}）——跑 npm run stats 或配 GitHub secret`);
      else ok(`stats.json 可解析（source=${s.source}，${s.series.length} 天数据）`);
    } catch (e) { no(`stats.json 解析失败：${e.message}`); }
  }
}

console.log('\n■ 预渲染与热度');
{
  let auto = null;
  try {
    const raw = readFileSync(path.join(ROOT, 'content.auto.js'), 'utf8');
    auto = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch { /* 上面的"内容包"一节已经报过 */ }
  const idxHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (/REPLACE_WITH_GOATCOUNTER_CODE/.test(idxHtml)) warn('GoatCounter 短代码还是占位符（文章热度依赖它按真实路径记账）');
  else ok('GoatCounter 短代码已填');

  if (auto) {
    const sitemap = existsSync(path.join(ROOT, 'sitemap.xml')) ? readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8') : '';
    let shells = 0, missing = 0, absent = 0;
    for (const [key, dir] of [['articles', 'articles'], ['assertions', 'assertions'], ['papers', 'academic']]) {
      for (const it of auto[key] || []) {
        const rel = `${dir}/${it.id}/index.html`;
        if (existsSync(path.join(ROOT, rel))) shells++;
        else { missing++; no(`预渲染页缺失：${rel}（跑一次 npm run build）`); }
        if (!sitemap.includes(`/${dir}/${encodeURIComponent(it.id)}/`)) { absent++; no(`sitemap.xml 里没有 /${dir}/${it.id}/`); }
      }
    }
    if (shells && !missing) ok(`预渲染页齐全：${shells} 个（articles/ · assertions/ · academic/）`);
    if (shells && !absent) ok('sitemap.xml 覆盖了全部预渲染页');
    const first = (auto.articles || [])[0];
    if (first) {
      const shell = path.join(ROOT, 'articles', first.id, 'index.html');
      if (existsSync(shell)) {
        const html = readFileSync(shell, 'utf8');
        if (/property="og:title"/.test(html) && /rel="canonical"/.test(html) && /data-prerendered/.test(html)) ok('预渲染页带自己的分享卡片与正文');
        else no('预渲染页缺 OG / canonical / 正文');
      }
    }
    const heats = [...(auto.articles || []), ...(auto.assertions || []), ...(auto.papers || [])].map((x) => Number(x.heat) || 0);
    if (heats.some((h) => h > 0)) ok(`文字热度取自访客总量（最高 ${Math.max(...heats)}）`);
    else warn('文字热度目前全是 0（还没有按页访客数据）→ 排序退化成按时间；跑 npm run stats 可补齐');
  }
}

console.log('\n■ 静态性（不应再有后端接口与运行期数据）');
for (const f of ['api.js']) {
  if (existsSync(path.join(ROOT, f))) no(`${f} 还在，但站点已经是纯静态`);
  else ok(`${f} 已移除`);
}
if (existsSync(path.join(ROOT, 'data'))) no('data/ 还在（运行期数据目录）'); else ok('data/ 已移除');
{
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (/api\.js/.test(html)) no('index.html 仍然引用 api.js');
  else ok('index.html 不引用任何后端脚本');
}

console.log(bad === 0 ? '\n✅ 全部通过\n' : `\n❌ 有 ${bad} 处问题\n`);
process.exit(bad === 0 ? 0 : 1);
