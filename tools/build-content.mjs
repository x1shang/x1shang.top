#!/usr/bin/env node
/**
 * tools/build-content.mjs — 把「拖进文件夹」的文件自动编入站内内容
 *
 * 用法：
 *   node tools/build-content.mjs                # 扫描并生成 content.auto.js / feed.xml / atom.xml
 *   node tools/build-content.mjs --photos       # 先跑一遍照片流水线（tools/build-photos.py）再生成
 *   node tools/build-content.mjs --root <目录>  # 指定站点根目录（默认 = 本脚本上一级）
 *
 * 输入（缺目录就跳过，不会报错）：
 *   content/articles/**   文章     .md .markdown .html .htm .tex .latex .txt
 *   content/assertions/** 断言     同上
 *   content/papers/**     学术     同上
 *   content/friends/**    友链（站长手写，直接算已通过）
 *   content/about.md      关于页正文
 *   assets/music/**       音乐     .mp3 .wav .m4a .ogg .opus .flac（同名 .lrc 作歌词，.md/.json 作元数据）
 *   assets/photos/manifest.json    照片流水线产物
 *
 * 输出：
 *   content.auto.js   浏览器直接加载的内容包（window.AUTO）
 *   feed.xml atom.xml 订阅源
 *
 * 排序用的"热度"来自 front matter 的 heat:（旧字段 likes: 兼容）与作品的星数快照，纯静态、不联网。
 */
import { readdir, readFile, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const ROOT = path.resolve(opt('--root', path.join(HERE, '..')));
const WITH_PHOTOS = flag('--photos');
const QUIET = flag('--quiet');
const log = (...a) => { if (!QUIET) console.log(...a); };

const TEXT_EXT = new Set(['.md', '.markdown', '.html', '.htm', '.tex', '.latex', '.txt']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.oga', '.opus', '.flac']);
const FORMAT = {
  '.md': 'md', '.markdown': 'md', '.html': 'html', '.htm': 'html',
  '.tex': 'tex', '.latex': 'tex', '.txt': 'txt',
};
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/* ------------------------------------------------------------------ 小工具 */

/** 极简 YAML front matter：--- 开头，到下一个 --- 结束；支持 key: value / [a, b] / a, b */
export function parseFrontMatter(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let value = kv[2].trim().replace(/^["']|["']$/g, '');
    if (/^\[.*\]$/.test(value)) value = value.slice(1, -1).split(',');
    else if (/^(tags|authors|keywords)$/.test(key) && value.includes(',')) value = value.split(',');
    if (Array.isArray(value)) value = value.map((v) => String(v).trim()).filter(Boolean);
    else if (/^(true|false)$/i.test(value)) value = /^true$/i.test(value);
    else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    data[key] = value;
  }
  return { data, body: src.slice(m[0].length) };
}

/** 文件名 → URL 安全的 id：去掉日期前缀，保留中日韩与字母数字 */
export function slugify(name) {
  return String(name)
    .replace(/\.(md|markdown|html?|tex|latex|txt)$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}[-_ ]*/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-z0-9-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * 补齐非补零日期：`2026-9-15` → `2026-09-15`。必须补，有两个原因：
 *   1) `new Date('2026-9-15T00:00:00+08:00')` 在 V8 里是 Invalid Date，
 *      RSS/Atom 的 stamp() 会抛 RangeError，直接中断构建（feed/sitemap 都写不出来）；
 *   2) 日期是拿字符串排序的，不补零时 `2026-11-4` 会排到 `2026-2-21` 前面。
 */
const normDate = (s) => {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};

async function walk(dir, out = []) {
  let items;
  try { items = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    if (it.name.startsWith('.')) continue;
    const full = path.join(dir, it.name);
    if (it.isDirectory()) await walk(full, out);
    else if (it.isFile()) out.push(full);
  }
  return out;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

/* ------------------------------------------------- 文本类：文章 / 断言 / 学术 / 友链 */

async function collectText(kind, dir, seen) {
  const files = (await walk(dir)).filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
  const rows = [];
  for (const file of files.sort()) {
    const raw = await readFile(file, 'utf8');
    const { data, body } = parseFrontMatter(raw);
    if (data.draft === true) { log(`  · 跳过草稿 ${rel(file)}`); continue; }
    if (kind === 'friends' && data.status === 'hidden') continue;
    const st = await stat(file);
    const base = path.basename(file);
    const date = normDate(data.date) || String((base.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || isoDay(st.mtime)).slice(0, 10);
    let id = String(data.id || slugify(base));
    let n = 2;
    while (seen.has(`${kind}:${id}`)) id = `${slugify(base)}-${n++}`;
    seen.add(`${kind}:${id}`);
    const format = FORMAT[path.extname(file).toLowerCase()] || 'txt';
    const heading = (body.match(/^#\s+(.+)$/m) || [])[1];
    // 断言一般没有标题，正文本身就是标题：不要在构建期造一个 slug 标题出来
    const title = String(data.title || heading || (kind === 'assertions' ? '' : slugify(base).replace(/-/g, ' '))).trim();
    // 正文开头的 `# 标题` 会和页面外壳注入的 <h1> 重复（标题会显示两遍）。
    // 仅在它与 title 完全一致时删掉；不一致时保留作者原意（如「回甘（二稿）」正文写的是「回甘」）。
    const bodyRaw = body.trim();
    const dupH1 = bodyRaw.match(/^#\s+(.+?)\s*(?:\r?\n|$)/);
    const bodyOut = dupH1 && dupH1[1].trim() === title
      ? bodyRaw.slice(dupH1[0].length).trimStart()
      : bodyRaw;

    const common = {
      id, date, format, file: rel(file), title,
      tags: Array.isArray(data.tags) ? data.tags : [],
      test: data.test === true,
      heat: Math.max(0, Number(data.heat ?? data.likes) || 0),
      body: bodyOut,
    };
    if (kind === 'articles') {
      rows.push({ ...common, summary: String(data.summary || data.description || firstLine(body)) });
    } else if (kind === 'assertions') {
      rows.push(common);
    } else if (kind === 'papers') {
      rows.push({
        ...common,
        summary: String(data.summary || data.description || firstLine(body)),
        authors: String(data.authors || ''),
        venue: String(data.venue || ''),
        url: String(data.url || ''),
        abstract: String(data.abstract || firstLine(body)),
      });
    } else if (kind === 'friends') {
      rows.push({
        id, date, name: String(data.name || title), url: String(data.url || ''),
        description: String(data.description || data.summary || ''), avatar: String(data.avatar || ''),
        status: 'approved', source: 'file', test: data.test === true, tags: common.tags,
      });
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows;
}

function firstLine(body) {
  for (const line of String(body).split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim();
    if (t) return t.length > 90 ? t.slice(0, 90) + '…' : t;
  }
  return '';
}

/* ------------------------------------------------------------------ 音乐 */

async function collectMusic(dir) {
  const files = (await walk(dir)).filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
  const rows = [];
  const seen = new Set();
  for (const file of files.sort()) {
    const ext = path.extname(file);
    const stem = file.slice(0, -ext.length);
    let meta = {};
    for (const cand of ['.md', '.json', '.txt']) {
      if (existsSync(stem + cand)) {
        const raw = await readFile(stem + cand, 'utf8');
        meta = cand === '.json' ? await readJson(stem + cand, {}) : parseFrontMatter(raw).data;
        break;
      }
    }
    let lyrics = '';
    if (existsSync(stem + '.lrc')) lyrics = await readFile(stem + '.lrc', 'utf8');
    const st = await stat(file);
    const name = path.basename(stem);
    let id = String(meta.id || slugify(name));
    let n = 2;
    while (seen.has(id)) id = `${slugify(name)}-${n++}`;
    seen.add(id);
    rows.push({
      id, src: rel(file), title: String(meta.title || name), artist: String(meta.artist || ''),
      date: normDate(meta.date) || isoDay(st.mtime), lyrics: String(meta.lyrics || lyrics || ''),
      tags: Array.isArray(meta.tags) ? meta.tags : [], test: meta.test === true,
      heat: Math.max(0, Number(meta.heat ?? meta.likes) || 0),
      netease: String(meta.netease || ''),
      bytes: st.size,
    });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows;
}

/* ------------------------------------------------------------------ 主流程 */

if (WITH_PHOTOS) runPhotos();

function runPhotos() {
  const script = path.join(HERE, 'build-photos.py');
  if (!existsSync(script)) return;
  const args = [script, '--inbox', 'inbox/photos', '--out', 'assets/photos', '--manifest', 'assets/photos/manifest.json'];
  for (const py of [process.env.PYTHON || 'python', 'py']) {
    const r = spawnSync(py, py === 'py' ? ['-3', ...args] : args, { cwd: ROOT, stdio: 'inherit' });
    if (!r.error) { if (r.status !== 0) log('⚠️  照片流水线返回非零，继续用旧清单。'); return; }
  }
  log('⚠️  没找到可用的 python，跳过照片流水线（文本内容照常生成）。');
}

const seenIds = new Set();
const articles = await collectText('articles', path.join(ROOT, 'content/articles'), seenIds);
const assertions = await collectText('assertions', path.join(ROOT, 'content/assertions'), seenIds);
const papers = await collectText('papers', path.join(ROOT, 'content/papers'), seenIds);
const friendsFile = await collectText('friends', path.join(ROOT, 'content/friends'), seenIds);
const tracks = await collectMusic(path.join(ROOT, 'assets/music'));

let about = '';
const aboutFile = path.join(ROOT, 'content/about.md');
if (existsSync(aboutFile)) about = parseFrontMatter(await readFile(aboutFile, 'utf8')).body.trim();

/* 照片：读流水线清单 */
const photoManifest = await readJson(path.join(ROOT, 'assets/photos/manifest.json'), { photos: [] });
const photos = (photoManifest.photos || []).map((p) => ({
  id: p.id, src: p.src, thumb: p.thumb || p.src, title: p.title || '', date: p.date || '',
  location: p.location || '', tags: p.tags || [], album: p.album || '', caption: p.caption || '',
  width: p.width || 0, height: p.height || 0, bytes: p.bytes || 0,
  test: p.test === true || /(^|[-_/])test([-_/]|$)/i.test(p.source || ''),
  heat: Math.max(0, Number(p.heat ?? p.likes) || 0),
}));

/* 友链：站长手写在 content/friends/ 里的条目（本站不收在线申请） */
const friends = [...friendsFile].sort((a, b) => String(b.date).localeCompare(String(a.date)));

/* 站点信息：从 content.js 里抠 name/url/github/since，抠不到就用默认值 */
let siteCfg = { name: 'x1shang', url: 'https://x1shang.top', github: 'x1shang', since: '2026-10-11' };
try {
  const cfg = await readFile(path.join(ROOT, 'content.js'), 'utf8');
  const pick = (k) => (cfg.match(new RegExp(`\\b${k}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`)) || [])[1];
  siteCfg = { name: pick('name') || siteCfg.name, url: (pick('url') || siteCfg.url).replace(/\/$/, ''), github: pick('github') || siteCfg.github, since: pick('since') || siteCfg.since };
} catch { /* 用默认值 */ }

/* 热度：文章 / 断言 / 论文 = 该页「访客总量」；照片 / 音乐 / 友链仍用 front matter 的 heat。
   访客数据由 tools/fetch-stats.mjs 抓进 stats.json 的 pages 表（键 = 预渲染的真实路径）。 */
const URL_KIND = { articles: 'articles', assertions: 'assertions', papers: 'academic' };
const stats = await readJson(path.join(ROOT, 'stats.json'), {});
const pageVisits = stats.pages && typeof stats.pages === 'object' ? stats.pages : {};
const pathOf = (kindKey, id) => `/${URL_KIND[kindKey]}/${encodeURIComponent(id)}/`;
/** 查访客数：GoatCounter 会把路径结尾的斜杠去掉（存成 /articles/foo），所以两种写法都认 */
const visitsOf = (kindKey, id) => {
  const p = pathOf(kindKey, id);
  return Math.max(0, Number(pageVisits[p] ?? pageVisits[p.replace(/\/$/, '')]) || 0);
};
for (const [kindKey, list] of [['articles', articles], ['assertions', assertions], ['papers', papers]]) {
  for (const it of list) {
    it.visits = visitsOf(kindKey, it.id);
    it.heat = it.visits;   // 热度只认访客总量；没有数据时是 0，于是退化成按时间排
  }
}
if (!Object.keys(pageVisits).length) {
  log('ℹ️  stats.json 里还没有按页访客数据（pages）：文章热度一律 0 → 排序退化成按时间。跑 `npm run stats` 可补齐。');
}

const allDates = [articles, assertions, papers, photos].flat().map((x) => x.date).filter(Boolean).sort();
const AUTO = {
  generated: new Date().toISOString(),
  recent: allDates.at(-1) || new Date().toISOString().slice(0, 10),
  site: siteCfg,
  articles, assertions, papers, photos, tracks, friends, about,
  stats: {
    articles: articles.length, assertions: assertions.length, papers: papers.length,
    photos: photos.length, tracks: tracks.length, friends: friends.length,
  },
};

const payload = JSON.stringify(AUTO, null, 1).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
await mkdir(ROOT, { recursive: true });
const autoFile = path.join(ROOT, 'content.auto.js');
const nextAuto = `/* 自动生成，请勿手改：由 tools/build-content.mjs 扫描 content/ 与 assets/ 产出。 */\nwindow.AUTO = ${payload};\n`;
// 除了 generated 时间戳没有任何变化时保持原文件：否则每次构建（尤其是每天定时的 stats 任务）都会产生无意义的 diff 与提交
const stripGen = (s) => {
  try { return JSON.stringify(JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)), (k, v) => (k === 'generated' ? '' : v)); } catch { return ''; }
};
const prevAuto = await readFile(autoFile, 'utf8').catch(() => '');
if (prevAuto && stripGen(prevAuto) === stripGen(nextAuto)) {
  log('· content.auto.js 无实质变化，保持原文件（不动 generated 时间）');
} else {
  await writeFile(autoFile, nextAuto, 'utf8');
}

/* 订阅源 */
const feedItems = [
  ...articles.map((a) => ({ title: a.title, date: a.date, summary: a.summary, link: siteCfg.url + pathOf('articles', a.id) })),
  ...assertions.map((a) => ({ title: firstLine(a.body) || a.date, date: a.date, summary: a.body.slice(0, 200), link: siteCfg.url + pathOf('assertions', a.id) })),
  ...papers.map((p) => ({ title: p.title, date: p.date, summary: p.abstract, link: siteCfg.url + pathOf('papers', p.id) })),
].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 40);
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const stamp = (d) => {
  const t = new Date(`${normDate(d) || '1970-01-01'}T00:00:00+08:00`);
  return (Number.isNaN(t.getTime()) ? new Date() : t).toISOString();   // 日期再离谱也不中断构建
};
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${xml(siteCfg.name)}</title><link>${xml(siteCfg.url)}</link>
<description>${xml(siteCfg.name)} 的文字与记录</description>
<lastBuildDate>${stamp(AUTO.recent)}</lastBuildDate>
${feedItems.map((i) => `<item><title>${xml(i.title)}</title><link>${xml(i.link)}</link><guid>${xml(i.link)}</guid><pubDate>${stamp(i.date)}</pubDate><description>${xml((i.summary || '').slice(0, 300))}</description></item>`).join('\n')}
</channel></rss>
`;
const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${xml(siteCfg.name)}</title><link href="${xml(siteCfg.url)}/"/><id>${xml(siteCfg.url)}/</id>
<updated>${stamp(AUTO.recent)}</updated>
${feedItems.map((i) => `<entry><title>${xml(i.title)}</title><link href="${xml(i.link)}"/><id>${xml(i.link)}</id><updated>${stamp(i.date)}</updated><summary>${xml((i.summary || '').slice(0, 300))}</summary></entry>`).join('\n')}
</feed>
`;
await writeFile(path.join(ROOT, 'feed.xml'), rss, 'utf8');
await writeFile(path.join(ROOT, 'atom.xml'), atom, 'utf8');

/* ------------------------------------------------- 预渲染：给文字类内容一个真实路径
   为什么：哈希路由（#articles/x）爬虫不认、每篇没有自己的分享卡片，访问统计也会全记在 / 上。
   做法：拿 index.html 当模板，整段替换 <!-- build:head:start -->…<!-- build:head:end --> 之间的
        头部（标题 / description / canonical / og / twitter）与该页正文，输出到
        articles/<id>/index.html（断言、学术同理）；相对引用改成 ../../，
        于是 http 与本机 file:// 双击都能打开。站内交互仍由 app.js 接管，URL 不跳转。
*/
if (!globalThis.Render) {
  try { await import(new URL('../render.js', import.meta.url).href); } catch { /* 渲染器加载失败就用纯文本兜底 */ }
}
const Render = globalThis.Render;
const HEAD_BLOCK = /<!-- build:head:start[\s\S]*?<!-- build:head:end -->/;

const template = await readFile(path.join(ROOT, 'index.html'), 'utf8');
if (!HEAD_BLOCK.test(template)) log('⚠️  index.html 里找不到 build:head 标记：预渲染页会沿用整站卡片。');

async function writeShell(kindKey, it) {
  const urlPath = pathOf(kindKey, it.id);
  const title = String(it.title || firstLine(it.body) || it.id).slice(0, 80);
  const desc = String(it.summary || it.abstract || firstLine(it.body) || '').replace(/\s+/g, ' ').slice(0, 160);
  const abs = siteCfg.url + urlPath;
  const head = `<!-- build:head:start（由 tools/build-content.mjs 为预渲染页生成，勿手改） -->
<meta name="description" content="${xml(desc)}">
<title>${xml(title)} · x1shang</title>
<link rel="canonical" href="${xml(abs)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="x1shang">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${xml(title)}">
<meta property="og:description" content="${xml(desc)}">
<meta property="og:url" content="${xml(abs)}">
<meta property="og:image" content="${xml(siteCfg.url)}/assets/og-cover.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="article:published_time" content="${xml(it.date)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${xml(title)}">
<meta name="twitter:description" content="${xml(desc)}">
<meta name="twitter:image" content="${xml(siteCfg.url)}/assets/og-cover.jpg">
<!-- build:head:end -->`;
  const bodyHtml = Render
    ? Render.renderFile({ format: it.format, body: it.body })
    : `<pre>${xml(it.body)}</pre>`;
  const main = `<article class="prose" data-prerendered="${xml(urlPath)}">${it.title ? `<h1>${xml(it.title)}</h1>` : ''}${bodyHtml}</article>`;
  let html = template.replace(HEAD_BLOCK, head);
  html = html.replace('<body>', '<body class="reading">');
  html = html.replace('<main id="main" tabindex="-1"></main>', `<main id="main" tabindex="-1">${main}</main>`);
  // 子目录页面：相对引用补上 ../../，这样 http 与 file:// 都能找到站点根目录的资源
  html = html.replace(/(\s(?:src|href)=")(?!https?:|data:|mailto:|tel:|javascript:|#|\/\/|\/)([^"]*)(")/g, '$1../../$2$3');
  const dir = path.join(ROOT, URL_KIND[kindKey], it.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html, 'utf8');
  return { urlPath, lastmod: it.date, kindKey };
}

// 每次重建都先清空这三棵生成目录，避免删掉的文章留下僵尸页
for (const dir of Object.values(URL_KIND)) await rm(path.join(ROOT, dir), { recursive: true, force: true });
const shells = [];
for (const [kindKey, list] of [['articles', articles], ['assertions', assertions], ['papers', papers]]) {
  for (const it of list) shells.push(await writeShell(kindKey, it));
}

/* sitemap：首页 + 全部预渲染页（自动生成，别手改） */
const sitemapUrls = [
  { loc: `${siteCfg.url}/`, lastmod: AUTO.recent, changefreq: 'weekly', priority: '1.0' },
  ...shells.map((s) => ({ loc: siteCfg.url + s.urlPath, lastmod: s.lastmod, changefreq: 'monthly', priority: s.kindKey === 'assertions' ? '0.6' : '0.8' })),
];
await writeFile(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<!-- 自动生成，请勿手改：由 tools/build-content.mjs 扫描 content/ 产出。 -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url>\n    <loc>${xml(u.loc)}</loc>\n    <lastmod>${xml(u.lastmod)}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')}
</urlset>
`, 'utf8');

log(`✅ content.auto.js：文章 ${articles.length} · 断言 ${assertions.length} · 学术 ${papers.length} · 摄影 ${photos.length} · 音乐 ${tracks.length} · 友链 ${friends.length}` +
  (about ? ' · 关于页来自 content/about.md' : '') + `（最近更新 ${AUTO.recent}）`);
log(`✅ 预渲染 ${shells.length} 个真实路径页（articles/ · assertions/ · academic/）+ sitemap.xml（${sitemapUrls.length} 条）` +
  (Render ? '' : '（⚠️ 渲染器没加载上，正文以纯文本兜底）'));
