#!/usr/bin/env node
/**
 * tools/import-netease-list.mjs — 把一份 markdown 歌单清单批量导入成 assets/music/*.md
 *
 * 清单长这样（就是网易云歌单整理出来的那种待办表）：
 *   - [x] 夜明けと蛍 n-buna / 初音ミク
 *   - [ ] 千本樱(古筝)              ← 未打勾 = 不要，跳过
 *   - [x] 夏目 consider（本地）      ← 标了「本地」= 不要线上版，跳过（本地文件自己丢进 assets/music/）
 *
 * 两条匹配路线：
 *   ① `--playlist <歌单ID>`（**强烈推荐**）：先拉一次歌单，拿到里面每首歌的 ID / 歌名 / 歌手，
 *      再把清单每一行**在本地**跟这个池子比对。不走搜索接口 → 不受限流影响，而且匹配是精确的。
 *      歌单里"我喜欢"那类歌单的 ID 可以从客户端「分享 → 复制链接」里拿到。
 *   ② 不给歌单 ID：拿每一行去网易云搜索（suggest 短查询为主、get/web 兜底），带自适应退避。
 *      能跑通，但网易云限流很凶（约十几次请求就关几分钟小黑屋），慢。
 *
 * 写出来的每个文件就是一行 `netease: <ID>`；顺序用 heat 保下来（heat = 1000 - 清单行号，
 * 这样本地音频那几首也能按同一把尺子插回歌单里的位置）。直链有没有是构建期探测的，
 * 网易云不给直链（VIP / 独家 / 无版权）的会被标出来、不写 src。
 *
 * 用法：
 *   node tools/import-netease-list.mjs "<清单.md>" --playlist 6804342424 --dry   # 先看匹配结果
 *   node tools/import-netease-list.mjs "<清单.md>" --playlist 6804342424         # 真写
 *   可选：--all（连没打勾的一起）、--extra（把歌单里清单没写的可播曲目也一起导）、
 *        --limit N、--out <目录>、--gap 毫秒、--no-cache
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveNetease, probePlayable } from './fetch-netease.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(path.join(HERE, '..'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DRY = flag('--dry');
const ALL = flag('--all');
const EXTRA = flag('--extra');
const LIMIT = Number(opt('--limit', 0)) || 0;
const GAP = Number(opt('--gap', 1200));
const PLAYLIST = opt('--playlist', '');
const OUT_DIR = path.resolve(opt('--out', path.join(ROOT, 'assets/music')));
const LIST = argv.find((a) => !a.startsWith('--') && /\.(md|markdown|txt)$/i.test(a));

if (!LIST || !existsSync(LIST)) {
  console.error('用法：node tools/import-netease-list.mjs "<清单.md>" [--playlist 歌单ID] [--dry] [--all] [--extra] [--limit N] [--out 目录]');
  process.exit(1);
}

/* ------------------------------------------------- 带退避的请求 + 断点缓存 */

const CACHE_FILE = path.join(os.tmpdir(), 'x1shang-netease-import-cache.json');
let cache = { search: {}, probe: {}, playlist: {} };
if (!flag('--no-cache')) {
  try { cache = { search: {}, probe: {}, playlist: {}, ...JSON.parse(await readFile(CACHE_FILE, 'utf8')) }; } catch { /* 全新开始 */ }
}
const saveCache = async () => { if (!flag('--no-cache')) await writeFile(CACHE_FILE, JSON.stringify(cache), 'utf8').catch(() => {}); };

let lastRequest = 0;
let gapNow = GAP;
let okStreak = 0;

/** 发一个请求；遇到「操作频繁」就指数退避，并把全局间隔翻倍（自适应找到网易云能接受的速率） */
async function request(url, { tries = 6, base = 60000, gap } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const useGap = gap ?? gapNow;
    const wait = lastRequest + useGap - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
      const text = await r.text();
      if (/操作频繁|"code":40[56]/.test(text)) throw new Error('RATE_LIMIT');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (++okStreak >= 15) { okStreak = 0; gapNow = Math.max(GAP, Math.round(gapNow * 0.7)); }
      return JSON.parse(text);
    } catch (e) {
      if (e.message === 'RATE_LIMIT') { okStreak = 0; gapNow = Math.min(60000, Math.max(gapNow * 2, 4000)); }
      if (attempt === tries - 1) throw e;
      const back = e.message === 'RATE_LIMIT' ? base * 2 ** attempt : 2000 * (attempt + 1);
      const w = back + Math.random() * 3000;
      console.log(`      ⏳ ${e.message === 'RATE_LIMIT' ? `被限流（间隔调到 ${Math.round(gapNow / 1000)}s）` : e.message}，等 ${Math.round(w / 1000)}s 重试…`);
      await sleep(w);
      lastRequest = 0;
    }
  }
}

/* ---------------------------------------------------------------- 小工具 */

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[\s\-_/\\、,，.。'’"“”·:：;；!！?？()（）【】\[\]]+/g, '');

const fileSafe = (s) => String(s || '')
  .replace(/[\\/:*?"<>|]/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60)
  .replace(/[. ]+$/, '');

const shape = (s) => ({
  id: String(s.id),
  name: String(s.name || ''),
  artists: (s.artists || s.ar || []).map((a) => a && a.name).filter(Boolean),
  album: String((s.album && s.album.name) || (s.al && s.al.name) || ''),
  fee: Number(s.fee ?? -1),
});

/** 打分：行首就是歌名最强，其次歌名出现在行里，再按歌手 / 专辑命中加分 */
function score(cand, lineN) {
  let s = 0;
  const nameN = norm(cand.name);
  if (nameN) {
    const at = lineN.indexOf(nameN);
    if (at === 0) s += 8;
    else if (at > 0) s += 4;
    else if (nameN.length >= 4 && nameN.includes(lineN.slice(0, 10))) s += 1;
  }
  let artistHits = 0;
  for (const a of cand.artists) {
    const an = norm(a);
    if (an.length >= 2 && lineN.includes(an)) artistHits++;
  }
  s += Math.min(artistHits, 2) * 2;
  if (cand.album && lineN.includes(norm(cand.album))) s += 1;
  if (/cover|翻自|翻唱|remix|dj版|伴奏/i.test(cand.name)) s -= 1;
  if (cand.fee === 1) s -= 1;
  return s;
}

async function probe(id) {
  if (id in cache.probe) return cache.probe[id];
  const r = await probePlayable(id);
  cache.probe[id] = r;
  await saveCache();
  return r;
}

/* ------------------------------------------------- 拉歌单（比搜索准得多、且不受限流） */

async function fetchPlaylist(pid) {
  if (cache.playlist[pid]) return cache.playlist[pid];
  const j = await request(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(pid)}`, { tries: 4, base: 30000 });
  const ids = ((j.playlist && j.playlist.trackIds) || []).map((x) => String(x.id));
  if (!ids.length) throw new Error(`歌单 ${pid} 没读到曲目（是不是要登录 / ID 写错了？）`);
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const d = await request(`https://music.163.com/api/song/detail/?ids=[${batch.join(',')}]`, { tries: 4, base: 30000 });
    const map = new Map(((d.songs) || []).map((s) => [String(s.id), shape(s)]));
    for (const id of batch) { const s = map.get(id); if (s) out.push(s); }
    console.log(`  · 歌单明细 ${Math.min(i + 40, ids.length)}/${ids.length}`);
  }
  cache.playlist[pid] = out;
  await saveCache();
  return out;
}

/* ------------------------------------------------- 搜索兜底（没给歌单 ID 时才用） */

async function suggest(term) {
  const key = `suggest:${term}`;
  if (cache.search[key]) return cache.search[key];
  const j = await request(`https://music.163.com/api/search/suggest/web?csrf_token=&s=${encodeURIComponent(term)}&limit=8`, { tries: 4, base: 60000 });
  const list = (((j.result && j.result.songs) || j.songs || [])).map(shape);
  cache.search[key] = list;
  await saveCache();
  return list;
}

async function searchFull(term) {
  const key = `full:${term}`;
  if (cache.search[key]) return cache.search[key];
  const j = await request(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(term)}&type=1&offset=0&total=true&limit=10`, { tries: 5, base: 60000, gap: 3000 });
  const list = (((j.result && j.result.songs) || j.songs || [])).map(shape);
  cache.search[key] = list;
  await saveCache();
  return list;
}

/** 没有歌单池时：整行 → 24 字 → 16 字 → 10 字 → 6 字逐级缩短，凑到高分候选（≥8）就停 */
async function findBySearch(line) {
  const lineN = norm(line);
  const pool = new Map();
  const ladder = [...new Set([line, line.slice(0, 24), line.slice(0, 16), line.slice(0, 10), line.slice(0, 6)].map((s) => s.trim()).filter(Boolean))];
  for (const term of ladder.slice(0, 5)) {
    for (const c of await suggest(term)) if (!pool.has(c.id)) pool.set(c.id, c);
    if ([...pool.values()].some((c) => score(c, lineN) >= 8)) break;
  }
  if (!pool.size) {
    for (const term of [line, line.slice(0, 16)]) {
      try { for (const c of await searchFull(term)) if (!pool.has(c.id)) pool.set(c.id, c); } catch { /* 限流就算了 */ }
      if (pool.size) break;
    }
  }
  return [...pool.values()].map((c) => ({ ...c, score: score(c, lineN) })).sort((a, b) => b.score - a.score);
}

/* ---------------------------------------------------------------- 解析清单 */

const raw = await readFile(LIST, 'utf8');
const entries = [];
raw.split(/\r?\n/).forEach((line, i) => {
  const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+?)\s*$/);
  if (!m) return;
  const local = /[（(]\s*本地\s*[)）]\s*$/.test(m[2]);
  entries.push({
    lineNo: i + 1,
    done: m[1].toLowerCase() === 'x',
    local,
    text: m[2].replace(/\s*[（(]\s*本地\s*[)）]\s*$/, '').trim(),
    source: m[2],
  });
});

const picked = entries.filter((e) => !e.local && (e.done || ALL)).slice(0, LIMIT || undefined);
console.log(`■ 清单：${path.basename(LIST)} —— 共 ${entries.length} 行，本次处理 ${picked.length} 行` +
  `（跳过 本地 ${entries.filter((e) => e.local).length} 行、未打勾 ${entries.filter((e) => !e.done && !e.local).length} 行）`);
if (!DRY) await mkdir(OUT_DIR, { recursive: true });

let playlist = null;
if (PLAYLIST) {
  console.log(`■ 先拉歌单 ${PLAYLIST}…`);
  playlist = await fetchPlaylist(PLAYLIST);
  console.log(`  ✓ 歌单里有 ${playlist.length} 首，接下来在本地比对（不再打搜索接口）`);
}

/* ---------------------------------------------------------------- 逐行匹配 */

const claimed = new Set();     // 歌单里已经被某一行认领的曲目
const rows = [];
for (const [n, e] of picked.entries()) {
  const lineN = norm(e.text);
  let cands = [];
  let err = '';
  try {
    if (playlist) {
      cands = playlist
        .filter((c) => !claimed.has(c.id))
        .map((c) => ({ ...c, score: score(c, lineN) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score);
    } else {
      cands = await findBySearch(e.text);
    }
  } catch (x) { err = x.message; }

  let chosen = null;
  const tried = [];
  for (const c of cands.slice(0, 3)) {
    const ok = await probe(c.id);
    tried.push(`${c.name}#${c.id}${ok === true ? ' ✓' : ok === false ? ' ✗无直链' : ' ?探测失败'}`);
    if (ok === true) { chosen = c; break; }
  }

  const status = chosen ? 'ok' : err ? `出错(${err})` : cands.length ? '无直链' : '没匹配到';
  rows.push({ e, chosen, status, tried, best: cands[0] || null });
  if (chosen) claimed.add(chosen.id);
  await sleep(300);
  console.log(`  ${String(n + 1).padStart(2, '0')}. ${chosen ? '✓' : '✗'} ${e.text}`);
  if (chosen) console.log(`      → ${chosen.name} — ${chosen.artists.join(' / ')}  [${chosen.id}]  (得分 ${chosen.score})`);
  else console.log(`      ← ${tried.length ? '试过：' + tried.join('；') : err || '没有候选'}`);
}

/* ------------------------------------------------- 歌单里清单没写到的（--extra） */

let extras = [];
if (playlist) {
  const rest = playlist.filter((c) => !claimed.has(c.id));
  const playableRest = [];
  for (const c of rest) if ((await probe(c.id)) === true) playableRest.push(c);
  extras = playableRest;
  console.log(`\n■ 歌单里还有 ${rest.length} 首没被清单认领，其中 ${playableRest.length} 首能直链播放` +
    `${EXTRA ? '（--extra：一起导入）' : '（要一起导入就加 --extra）'}`);
}

/* ---------------------------------------------------------------- 写文件 */

const writeOne = async (c, heat, note) => {
  const name = fileSafe(c.name) || `netease-${c.id}`;
  let file = path.join(OUT_DIR, `${name}.md`);
  let k = 2;
  while (existsSync(file)) {
    const other = await readFile(file, 'utf8').catch(() => '');
    if (other.includes(`netease: ${c.id}`)) return false;      // 已经导过同一首
    file = path.join(OUT_DIR, `${name}-${k++}.md`);
  }
  await writeFile(file, `---
${note}
# heat 只用于排序（越大越靠前），用 1000 - 清单行号："本地音频"那几首也按同一把尺子插回歌单位置。
netease: ${c.id}
date: ${new Date().toISOString().slice(0, 10)}
tags: [音乐, 我喜欢的音乐]
heat: ${heat}
---

标题 / 歌手 / 专辑 / 封面 / 歌词都在构建期从网易云抓，缓存在 \`tools/netease-cache.json\`。
播放走公开外链 \`music.163.com/song/media/outer/url?id=${c.id}.mp3\`（纯静态，无后端）。
`, 'utf8');
  return true;
};

if (DRY) {
  console.log('\n（--dry：没有写任何文件）');
} else {
  let written = 0;
  for (const r of rows) if (r.chosen && await writeOne(r.chosen, 1000 - r.e.lineNo, `# 导入自《${path.basename(LIST)}》第 ${r.e.lineNo} 行：${r.e.source}`)) written++;
  for (const [i, c] of extras.entries()) {
    if (!EXTRA) break;
    if (await writeOne(c, 900 - i, `# 导入自歌单 ${PLAYLIST}（清单里没写，--extra 一并导入）`)) written++;
  }
  const ids = [...rows.map((r) => r.chosen && r.chosen.id), ...(EXTRA ? extras.map((c) => c.id) : [])].filter(Boolean);
  if (ids.length) await resolveNetease(ids, { log: (m) => console.log(m) });
  console.log(`\n■ 写了 ${written} 个 assets/music/*.md`);
}

const ok = rows.filter((r) => r.chosen).length;
console.log(`\n■ 结果：成功 ${ok} / ${rows.length}`);
const bad = rows.filter((r) => !r.chosen);
if (bad.length) {
  console.log('  没导入的：');
  for (const r of bad) console.log(`   · [${r.status}] ${r.e.text}${r.best ? `（最像：${r.best.name} — ${r.best.artists.join('/')} [${r.best.id}]，得分 ${r.best.score}）` : ''}`);
}
if (extras.length && !EXTRA) {
  console.log('  歌单里没被清单认领、但能播的：');
  for (const c of extras) console.log(`   · ${c.name} — ${c.artists.join('/')}  [${c.id}]`);
}
