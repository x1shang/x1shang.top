#!/usr/bin/env node
/**
 * tools/fetch-netease.mjs — 网易云歌曲 → 站内曲目快照（构建期跑，浏览器不再取元数据）
 *
 * 为什么必须分成两半（2026-10-12 在真实 https 页面实测）：
 *   1. 元数据 / 歌词：music.163.com/api/song/detail 与 /api/song/lyric 是公开接口、不用登录，
 *      但**没有 CORS 头**，浏览器里 fetch 会被拦 —— 所以只在这里（构建期、Node）抓，抓完写进缓存。
 *   2. 播放：music.163.com/song/media/outer/url?id=<ID>.mp3 是公开外链，302 到 CDN 直链。
 *      <audio> 播放**不需要 CORS**，而且浏览器会把 302 那个 http:// 目标自动升级成 https://
 *      （Chromium 的 mixed content autoupgrade；本机在 https://x1shang.top/ 上实测能正常出声音）。
 *      → 所以纯静态页面可以直接用它，不需要任何代理/后端。
 *   只有网易云自己有版权的歌才给直链：VIP / 独家 / 无版权曲目会 302 到 music.163.com/404，
 *   构建时探测出来，页面上标注「无直链」而不是等用户点了才发现放不了。
 *
 * 用法：
 *   node tools/fetch-netease.mjs 1809646618 3361076230   # 查/刷新指定的几首
 *   node tools/fetch-netease.mjs --all --refresh          # 重抓 assets/music/ 里引用到的全部 ID
 * 作为库：import { resolveNetease, outerUrl } from './fetch-netease.mjs'
 *
 * 缓存：tools/netease-cache.json（进仓库）。默认**缓存优先**——只抓没抓过的 ID，
 * 这样 GitHub Actions 在海外机器上重建（可能连不上网易云）也能产出完全一样的结果。
 * 版权/歌名有变化时手动 `npm run netease` 刷新一次即可。
 * 环境变量：NETEASE_SKIP=1 完全离线（只用缓存）；NETEASE_TIMEOUT=毫秒 覆盖 8s 超时。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(path.join(HERE, '..'));
export const CACHE_FILE = path.join(HERE, 'netease-cache.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
const TIMEOUT = Number(process.env.NETEASE_TIMEOUT || 8000);

/** 播放地址：网易云公开外链（302 → CDN 直链，浏览器自动升级 http→https）。 */
export const outerUrl = (id) => `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(String(id).trim())}.mp3`;

/** 合法歌曲 ID：一串数字 */
export const isSongId = (v) => /^\d{4,}$/.test(String(v ?? '').trim());

/**
 * 探测一首歌有没有直链：302 到 CDN = true，302 到 /404 = false，探测不出（网络问题）= null。
 * 用 redirect:'manual' 只读 Location，不跟着把整首 mp3 下下来。
 */
export async function probePlayable(id) {
  try {
    const r = await fetch(outerUrl(id), { headers: HEADERS, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    if (r.status === 200) return /audio|octet-stream/i.test(r.headers.get('content-type') || '') ? true : null;
    if (r.status >= 300 && r.status < 400) return !/\/404(\?|$)/.test(r.headers.get('location') || '');
    return null;
  } catch { return null; }
}

const emptyCache = () => ({ updatedAt: '', songs: {} });

async function readCache(file = CACHE_FILE) {
  try {
    const j = JSON.parse(await readFile(file, 'utf8'));
    return j && typeof j === 'object' && j.songs && typeof j.songs === 'object' ? j : emptyCache();
  } catch { return emptyCache(); }
}

/** 抓一首歌的元数据 + 歌词 + 有没有直链；失败就抛，交给调用方决定用不用缓存 */
async function fetchSong(id) {
  const [detailRes, lyricRes] = await Promise.all([
    fetch(`https://music.163.com/api/song/detail/?id=${id}&ids=[${id}]`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) }),
    fetch(`https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null),
  ]);

  if (!detailRes.ok) throw new Error(`song/detail HTTP ${detailRes.status}`);
  const detail = await detailRes.json();
  const song = detail && detail.songs && detail.songs[0];
  if (!song) throw new Error('接口没返回这首歌（ID 写错了？还是已下架？）');

  let lrc = '';
  if (lyricRes && lyricRes.ok) {
    try { lrc = String(((await lyricRes.json()).lrc || {}).lyric || ''); } catch { /* 歌词可选 */ }
  }

  // 有直链 = 302 到 CDN；无直链 = 302 到 /404（VIP / 独家 / 无版权）；探测不到就是 null
  const playable = await probePlayable(id);

  const artists = (song.artists || []).map((a) => a && a.name).filter(Boolean);
  return {
    title: String(song.name || '').trim(),
    artist: artists.join(' / '),
    album: String((song.album && song.album.name) || ''),
    cover: String((song.album && song.album.picUrl) || ''),
    lrc: lrc.slice(0, 40000),
    playable,
    fee: Number(song.fee ?? -1),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 把一组歌曲 ID 变成快照。缓存优先：默认只抓缓存里没有的 ID。
 * @returns {Promise<{songs: Map<string, object>, cache: object}>}
 */
export async function resolveNetease(ids, { refresh = false, cacheFile = CACHE_FILE, log = () => {}, write = true } = {}) {
  const cache = await readCache(cacheFile);
  const list = [...new Set((ids || []).map((v) => String(v).trim()).filter(Boolean))];
  const todo = list.filter((id) => (refresh || !cache.songs[id]) && isSongId(id));

  if (todo.length && process.env.NETEASE_SKIP) {
    log(`☁️  网易云：NETEASE_SKIP=1，跳过抓取（${todo.length} 首待抓，先用缓存）。`);
  } else if (todo.length) {
    log(`☁️  网易云：抓取 ${todo.length} 首的元数据 / 歌词 / 直链…`);
    for (const id of todo) {
      try {
        const s = await fetchSong(id);
        cache.songs[id] = s;
        log(`   ✓ ${id} ${s.title || '(无名)'} — ${s.artist || '(未知歌手)'}${s.playable === false ? '（无直链）' : ''}`);
      } catch (e) {
        const msg = e && e.name === 'TimeoutError' ? '超时（连不上网易云？）' : (e && e.message) || String(e);
        if (cache.songs[id]) log(`   ! ${id} 抓取失败：${msg} —— 沿用旧缓存`);
        else { cache.songs[id] = { title: '', artist: '', album: '', cover: '', lrc: '', playable: null, fee: -1, error: msg, fetchedAt: '' }; log(`   ✗ ${id} 抓取失败：${msg} —— 先用占位信息，联网后重跑本脚本`); }
      }
    }
    cache.updatedAt = new Date().toISOString();
    if (write) {
      const next = JSON.stringify(cache, null, 1) + '\n';
      const prev = await readFile(cacheFile, 'utf8').catch(() => '');
      if (prev !== next) await writeFile(cacheFile, next, 'utf8');
    }
  }

  const songs = new Map();
  for (const id of list) if (cache.songs[id]) songs.set(id, cache.songs[id]);
  return { songs, cache };
}

/** 扫 assets/music/ 里声明了 netease: 的条目（.md / .json），返回 ID 列表 */
export async function scanNeteaseIds(dir = path.join(ROOT, 'assets/music')) {
  const out = new Set();
  const walk = async (d) => {
    let entries = [];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!/\.(md|json|txt)$/i.test(e.name)) continue;
      let text = '';
      try { text = await readFile(p, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/^\s*netease\s*:\s*["']?(\d{4,})["']?\s*$/gim)) out.add(m[1]);
      if (/\.json$/i.test(e.name)) { try { const j = JSON.parse(text); if (isSongId(j.netease)) out.add(String(j.netease).trim()); } catch { /* 不是 JSON 就算了 */ } }
    }
  };
  await walk(dir);
  return [...out];
}

/* ------------------------------------------------------------------ CLI */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const argv = process.argv.slice(2);
  const refresh = argv.includes('--refresh');
  let ids = argv.filter((a) => isSongId(a));
  if (argv.includes('--all')) ids = [...new Set([...(await scanNeteaseIds()), ...ids])];
  if (!ids.length) {
    console.log('用法：node tools/fetch-netease.mjs <歌曲ID...> [--refresh] | --all [--refresh]');
    console.log('  歌曲 ID 就是网易云链接里 song?id= 后面那串数字，例如 https://music.163.com/song?id=1809646618');
    process.exit(ids.length ? 0 : 1);
  }
  const { songs } = await resolveNetease(ids, { refresh, log: (m) => console.log(m) });
  console.log('\n■ 结果');
  for (const id of ids) {
    const s = songs.get(id);
    if (!s) { console.log(`  ${id}  ✗ 拿不到信息`); continue; }
    console.log(`  ${id}  ${s.title || '(无名)'} — ${s.artist || '(未知歌手)'}  《${s.album || ''}》`);
    console.log(`        直链：${s.playable === false ? '✗ 无（VIP / 独家 / 无版权）' : s.playable === true ? '✓ 有' : '? 没测出来'}   歌词：${s.lrc ? s.lrc.split('\n').length + ' 行' : '没有'}   封面：${s.cover ? '有' : '没有'}`);
    console.log(`        播放地址：${outerUrl(id)}`);
  }
}
