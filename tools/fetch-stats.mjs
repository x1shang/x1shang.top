#!/usr/bin/env node
/**
 * tools/fetch-stats.mjs — 把访客量抓成 stats.json（关于页最下方那张图的数据源）
 *
 * 关于页只读同目录的 stats.json：纯静态、不引第三方脚本、访客浏览器不向任何统计服务发请求。
 * 这个脚本负责在本地（或 GitHub Actions 里）把它刷新出来。
 *
 * 三种模式：
 *   1) 带 token（推荐，一次请求拿到逐日曲线）：
 *        $env:GOATCOUNTER_SITE='x1shang'; $env:GOATCOUNTER_TOKEN='...'; node tools/fetch-stats.mjs
 *      token 在 GoatCounter 后台右上角 [用户名] → API 里建，权限勾 stats 即可。
 *   2) 不带 token（只用公开计数端点，逐日逐个请求；需要后台打开
 *      Settings → “Allow adding visitor counts on your website”，否则 404）：
 *        $env:GOATCOUNTER_SITE='x1shang'; node tools/fetch-stats.mjs
 *   3) 演示数据（只为本地看图表长什么样，**不要提交**）：
 *        node tools/fetch-stats.mjs --demo
 *
 * 失败处理（2026-10-15 加）：取数失败分两类报，不必对着红叉猜要不要管 ——
 *   · 401/403（token 失效/权限不足）：红，需要你更新仓库 Secrets 的 GOATCOUNTER_TOKEN，重试无用；
 *   · 其余（网络 RST、非鉴权的 4xx、5xx、超时）：绿，stats.json 原样不动，下次运行会自动回填（窗口是最近 DAYS 天，
 *     所以偶发失败不会丢数据）；但若旧数据已超过 3 天没更新，仍按失败退出（说明不是偶发）。
 * 2026-10-15 的实例：GoatCounter 会间歇性 RST 数据中心 IP（Azure runner 连它 ECONNRESET），当天定时任务因此变红。
 *
 * 参数：--days 30（默认 30）· --out stats.json
 * 输出：{ source, site, updated, days, total, allTime, series: [{ d:'YYYY-MM-DD', n:number }] }
 * 口径：GoatCounter 的 daily / count 都是「访客数」（它的 count_unique 与 count 相同）。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 退出用这个，别直接 process.exit()：在 Windows 上刚跑完 fetch 就 exit 会撞 libuv 断言
 * （Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)，退出码变成 0xC0000409/崩溃）。
 * 这里先设 exitCode，再用定时器兜底硬退（保证不会挂死），同时用永不 resolve 的 promise 停住后面的代码。
 * 2026-10-15 实测：直接 exit 3/3 崩；这个写法 3/3 干净退出。
 */
async function bail(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 300);
  await new Promise(() => {});
}

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DEMO = args.includes('--demo');
const DAYS = Number(flag('days', process.env.STATS_DAYS || 30));
const OUT = path.resolve(flag('out', process.env.STATS_OUT || 'stats.json'));
const SITE = process.env.GOATCOUNTER_SITE || '';
const TOKEN = process.env.GOATCOUNTER_TOKEN || '';
const BASE = SITE ? `https://${SITE}.goatcounter.com` : '';

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const dayList = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(today.getTime() - (DAYS - 1 - i) * 86400000);
  return iso(d);
});

/** 数字统一成整数：GoatCounter 的 count 是带千分位的字符串 */
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

async function getJson(url, headers, opts = {}) {
  const tries = opts.tries ?? 1;
  const retryStatuses = opts.retry ?? [408, 429, 500, 502, 503, 504];
  let last;
  for (let i = 1; i <= tries; i++) {
    let retryable = true;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (res.ok) return res.json();
      last = new Error(`${res.status} ${res.statusText} — ${url}`);
      retryable = retryStatuses.includes(res.status);   // 401/403/400 这类不必重试
    } catch (e) {
      last = e;                                          // 网络层错误（RST / 超时 / DNS）值得重试
    }
    if (i === tries || !retryable) throw last;
    const waitS = Math.min(2 ** i, 30);   // 2、4、8、16、30… 指数退避（原来是 i*2 线性）
    console.log(`[stats] 第 ${i} 次没成功（${String(last.message).slice(0, 60)}），${waitS}s 后重试`);
    await new Promise((r) => setTimeout(r, waitS * 1000));
  }
  throw last;
}

/** API 调用统一带重试：GoatCounter 托管实例偶尔瞬时抽风（同一请求先 404/401、几秒后 200） */
const API_RETRY = { tries: 5, retry: [404, 408, 425, 429, 500, 502, 503, 504] };   // 3 次 → 5 次

/** 模式 1：API + token，一次拿到逐日访客数 */
async function fromApi() {
  const start = `${dayList[0]}T00:00:00Z`;
  const end = `${dayList[dayList.length - 1]}T23:59:59Z`;
  const url = `${BASE}/api/v0/stats/hits?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=100&group=day`;
  const data = await getJson(url, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  }, API_RETRY);
  const acc = new Map(dayList.map((d) => [d, 0]));
  for (const hit of data.hits ?? []) {
    for (const st of hit.stats ?? []) {
      if (acc.has(st.day)) acc.set(st.day, acc.get(st.day) + num(st.daily));
    }
  }
  return dayList.map((d) => ({ d, n: acc.get(d) }));
}

/** 模式 2：公开计数端点（无 token）——一天一个请求，range 设为同一天 */
async function fromCounter() {
  const series = [];
  for (const d of dayList) {
    const url = `${BASE}/counter/TOTAL.json?start=${d}&end=${d}`;
    try {
      const data = await getJson(url);
      series.push({ d, n: num(data.count) });
    } catch {
      series.push({ d, n: 0 });
    }
    await new Promise((r) => setTimeout(r, 120)); // 别把人家打疼
  }
  return series;
}

/** 站点总访客（同样是公开端点，失败就留 null） */
async function fetchAllTime() {
  if (!BASE) return null;
  try {
    const data = await getJson(`${BASE}/counter/TOTAL.json`);
    return num(data.count);
  } catch {
    return null;
  }
}

/**
 * 按页访客总量 —— 文章 / 断言 / 论文的「热度」就用它（键 = 预渲染的真实路径）。
 * 页面清单从 content.auto.js 里读（构建产物），所以顺序是：先 npm run build，再 npm run stats。
 */
const KIND_DIR = { articles: 'articles', assertions: 'assertions', papers: 'academic' };
async function knownPaths() {
  try {
    const raw = await readFile(new URL('../content.auto.js', import.meta.url), 'utf8');
    const auto = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const out = [];
    for (const [key, dir] of Object.entries(KIND_DIR)) {
      for (const it of auto[key] || []) if (it && it.id) out.push(`/${dir}/${encodeURIComponent(it.id)}/`);
    }
    return out;
  } catch {
    console.log('[stats] 读不到 content.auto.js，跳过按页统计（先跑一次 npm run build）。');
    return [];
  }
}

/** 有 token：一次 API 调用就能拿到所有路径的历史总量（limit=100 够个人站用）；顺便带回站点总访客 */
async function apiPages() {
  const url = `${BASE}/api/v0/stats/hits?start=2000-01-01T00:00:00Z&end=${encodeURIComponent(new Date().toISOString())}&limit=100`;
  const data = await getJson(url, { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, API_RETRY);
  const out = {};
  for (const hit of data.hits ?? []) if (hit.path) out[hit.path] = num(hit.count);
  return { pages: out, total: num(data.total) || null };
}

/** 没 token：逐页问公开计数端点（需要后台打开 “Allow adding visitor counts on your website”）
 *  注意 GoatCounter 存的路径会把结尾斜杠去掉（/articles/foo），所以两种写法都试一次。 */
async function counterPages() {
  const out = {};
  for (const p of await knownPaths()) {
    for (const cand of [p, p.replace(/\/$/, '')]) {
      try {
        const data = await getJson(`${BASE}/counter/${encodeURIComponent(cand)}.json`);
        out[p] = num(data.count);
        break;
      } catch {
        if (cand === p.replace(/\/$/, '')) out[p] = 0;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return out;
}

/** 模式 3：演示数据（固定种子，看起来像真的但完全是假的） */
function demo() {
  let seed = 20261011;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const series = dayList.map((d, i) => ({
    d,
    n: Math.max(0, Math.round(6 + 14 * Math.sin(i / 3.4) + rnd() * 12 - (i < DAYS - 6 ? 4 : 0))),
  }));
  return series;
}

let source;
let series;
let pages = {};
let allTimeFromApi = null;
try {
  if (DEMO) {
    source = 'demo';
    series = demo();
    let seed = 424242;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const p of await knownPaths()) pages[p] = Math.round(rnd() * 40);
  } else if (!SITE) {
    console.log('[stats] 跳过：没有配置 GOATCOUNTER_SITE（也没给 --demo）。');
    console.log('        用法见 tools/fetch-stats.mjs 顶部注释；关于页那张图会一直显示“数据还在积累”。');
    await bail(0);
  } else if (TOKEN) {
    source = 'goatcounter-api';
    series = await fromApi();
    const r = await apiPages();
    pages = r.pages;
    allTimeFromApi = r.total;
  } else {
    source = 'goatcounter-counter';
    console.log(`[stats] 没给 token，走公开计数端点逐日取 ${DAYS} 天 + 逐页取总量（较慢）…`);
    series = await fromCounter();
    pages = await counterPages();
  }
} catch (e) {
  // 取数失败分两类报（见文件头「失败处理」）：401/403 要人出手；瞬时故障不把整天变红。
  const msg = String(e?.message ?? e);
  const auth = /\b(401|403)\b/.test(msg);
  let staleDays = null;
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    if (prev.updated) staleDays = (Date.now() - new Date(prev.updated).getTime()) / 86400000;
  } catch { /* 没有旧文件，或旧文件坏了 */ }
  const stale = staleDays === null ? '没有可用的旧数据' : `${staleDays.toFixed(1)} 天前更新`;
  const line = auth
    ? `❌ 取数失败（鉴权）：${msg} —— token 失效或权限不足，请更新仓库 Secrets 的 GOATCOUNTER_TOKEN；重试无用。`
    : `⚠️  取数失败（非鉴权）：${msg} —— stats.json 保持不动（现数据 ${stale}），下次运行会自动回填最近 ${DAYS} 天。`;
  console.error(`[stats] ${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { await writeFile(process.env.GITHUB_STEP_SUMMARY, `## stats 取数\n\n${line}\n`, { flag: 'a' }); } catch { /* 摘要写不了就算了 */ }
  }
  if (auth) await bail(1);
  if (staleDays !== null && staleDays <= 3) await bail(0);   // 瞬时故障且数据还新鲜 → 不把整天变红
  console.error('[stats] ⚠️  数据已超过 3 天没更新 —— 按失败退出，需要人看一眼。');
  await bail(1);
}

const total = series.reduce((s, x) => s + x.n, 0);
const allTime = DEMO ? total : (allTimeFromApi ?? await fetchAllTime());
const payload = {
  source,
  site: BASE ? `${BASE}/` : '',
  updated: new Date().toISOString(),
  days: DAYS,
  total,
  allTime,
  series,
  pages,   // 按页访客总量：'/articles/<id>/' → 次数（文章热度用它）
};
const next = JSON.stringify(payload, null, 2) + '\n';
const withData = Object.values(pages).filter((n) => n > 0).length;
// 数据没变就不动文件（updated 是每次都变的，不参与比较）——免得住低流量站点每天白提交一次
const stable = (s) => JSON.stringify(JSON.parse(s || '{}', (k, v) => (k === 'updated' ? '' : v)));
const prev = await readFile(OUT, 'utf8').catch(() => '');
/* 防误伤：**没 token** 的公开计数端点模式，在国内/未开启后台开关时常常全返回 0 ——
   2026-10-12 实测：本地 `npm run stats`（无 token）把 10-11 抓到的真实数据（total=1、daily 有值）
   整个刷成 0，等于把好数据删了。所以：这种模式下若新数据全空而旧数据非空，就拒绝写入。
   确实想清零（比如站点真没人来了）就加 --force。 */
const allZero = (p) => (p.series || []).every((x) => !x.n) && !Object.values(p.pages || {}).some((n) => n > 0);
let prevPayload = null;
try { prevPayload = JSON.parse(prev); } catch { /* 没有旧文件 / 旧文件坏了 */ }
const wouldWipe = !DEMO && !TOKEN && source !== 'demo'
  && allZero(payload) && prevPayload && !allZero(prevPayload)
  && !args.includes('--force');
if (prev && stable(prev) === stable(next)) {
  console.log('[stats] 数据与上次一致，保持原文件不动（不会产生提交）。');
} else if (wouldWipe) {
  console.log(`[stats] ⚠️  公开计数端点这次全返回 0，而 ${path.basename(OUT)} 里还有真实数据` +
    `（total=${prevPayload.total ?? '?'}）——**保持原文件不动**，免得把好数据刷没。`);
  console.log('        要确认站点真的没人来了，加 --force 重跑；更靠谱的是给 GOATCOUNTER_TOKEN（见脚本头注释）。');
} else {
  await writeFile(OUT, next, 'utf8');
  console.log(`✅ 已写入 ${OUT}：source=${source}，近 ${DAYS} 天 ${total} 位访客` + (allTime === null ? '' : `，累计 ${allTime}`));
  console.log(`   按页数据：${Object.keys(pages).length} 页（其中 ${withData} 页有访客）—— 跑一次 npm run build 让文章热度生效。`);
}
if (DEMO) console.log('⚠️  这是演示数据，别提交（git checkout -- stats.json 可以还原）。');
