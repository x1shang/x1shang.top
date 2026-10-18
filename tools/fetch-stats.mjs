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
 * 参数：--days 30（默认 30）· --out stats.json · --provider goatcounter|selfhosted
 * 输出：{ source, site, updated, days, total, allTime, series: [{ d:'YYYY-MM-DD', n:number }] }
 * 口径：两侧都是按页 visits（约 8 小时会话内同页去重），各页之和不是全站独立人数。
 *      自建 v2 从 since 起单独累计；v1 的历史 PV 保留在后端，不能混进 visits。
 *
 * ── Phase 3（2026-10-16 加）：自建统计 + 双跑 ────────────────────────────────
 * provider 选择顺序：
 *   1) 命令行 --provider selfhosted|goatcounter
 *   2) 环境变量 STATS_PROVIDER（CI 里来自仓库 **Variables**，改它不用改代码）
 *   3) 默认 **goatcounter** —— 双跑期内站上显示的数字与文案一律不变，切换是显式动作
 * selfhosted 需要 STATS_API_URL（如 https://stat.x1shang.top）+ STATS_API_TOKEN；
 * 它取不到数时**自动回退 GoatCounter**（那条路原样保留，就是为兜底）。
 * 双跑对比：每次运行都把两边同时取一遍，写进 Job Summary + `tools/stat-dual-run.log`
 *          （**绝不写进 stats.json**），用来验证 §6.1 的"14 天趋势一致、不缺日"。
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

/* Phase 3：自建统计（stat.x1shang.top，Workers + D1） */
const STATS_API_URL = (process.env.STATS_API_URL || '').replace(/\/+$/, '');
const STATS_API_TOKEN = process.env.STATS_API_TOKEN || '';
const HAS_SELFHOSTED = Boolean(STATS_API_URL && STATS_API_TOKEN);
const PROVIDER = String(flag('provider', process.env.STATS_PROVIDER || 'goatcounter')).toLowerCase();
/** 自建计数器的上线日：这之前的日子它当然是 0，双跑对比不该把它算成"缺日"（§6.1 的验收要按这天之后算） */
const SELFHOSTED_SINCE = '2026-10-16';

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

/* 自建 provider：显式请求 visits，并拒绝尚未升级的 PV API，避免静默混用口径。 */
async function fromSelfHosted() {
  const data = await getJson(`${STATS_API_URL}/api/stats?days=${DAYS}&metric=visits`, { Authorization: `Bearer ${STATS_API_TOKEN}` }, API_RETRY);
  if (data.metric !== 'visits') throw new Error('自建 API 尚未提供 visits，拒绝把历史 PV 当成去重访问');
  const acc = new Map((data.series ?? []).map((x) => [x.d, num(x.n)]));
  return {
    source: 'selfhosted',
    metric: 'visits',
    since: data.since ?? null,
    series: dayList.map((d) => ({ d, n: acc.get(d) ?? 0 })),   // 逐日补零，绝不缺日
    pages: data.pages ?? {},
    allTime: data.allTime === undefined ? null : num(data.allTime),
  };
}

/** GoatCounter 那条路（原有逻辑原样收进一个函数，方便 selfhosted 失败时回退，也方便双跑取另一侧） */
async function viaGoatCounter() {
  if (TOKEN) {
    const series = await fromApi();
    const r = await apiPages();
    return { source: 'goatcounter-api', series, pages: r.pages, allTime: r.total };
  }
  console.log(`[stats] 没给 token，走公开计数端点逐日取 ${DAYS} 天 + 逐页取总量（较慢）…`);
  return { source: 'goatcounter-counter', series: await fromCounter(), pages: await counterPages(), allTime: null };
}

/** 某一侧在这次窗口里的摘要（双跑对比用） */
function sideSummary(label, r, comparisonSince = SELFHOSTED_SINCE) {
  const pages = r.pages || {};
  const since = r.series.filter((x) => x.d >= comparisonSince);
  return {
    label,
    metric: 'visits',
    since: comparisonSince,
    comparableTotal: since.reduce((s, x) => s + x.n, 0),
    total: r.series.reduce((s, x) => s + x.n, 0),
    allTime: r.allTime,
    activeDays: r.series.filter((x) => x.n > 0).length,        // 窗口内有数的天
    zeroSince: since.filter((x) => !x.n).length,               // 上线日之后仍为 0 的天（"缺日"只看这个）
    pages: Object.keys(pages).length,
    pagesWithData: Object.values(pages).filter((n) => n > 0).length,
  };
}

const fmtSide = (s) => (s ? `${s.total}` : '—');
const fmtAllTime = (s) => (s && s.allTime !== null && s.allTime !== undefined ? `${s.allTime}` : '—');

/**
 * 双跑对比（§6.1）：把两边数字写进 Job Summary 与 `tools/stat-dual-run.log`，**绝不写进 stats.json**。
 * 日志行是同一天只留最新一条（避免一天两次运行产生两条重复记录，也避免无谓的提交）。
 */
async function dualRun(gc, sh) {
  if (!gc && !sh) return;
  const day = iso(new Date());
  const line = [
    day,
    `gc_total=${fmtSide(gc)}`, `sh_total=${fmtSide(sh)}`,
    `gc_allTime=${fmtAllTime(gc)}`, `sh_allTime=${fmtAllTime(sh)}`,
    `gc_days=${gc ? gc.activeDays : '-'}`, `sh_days=${sh ? sh.activeDays : '-'}`,
    `sh_zero_since=${sh ? sh.zeroSince : '-'}`,
    `gc_pages=${gc ? `${gc.pagesWithData}/${gc.pages}` : '-'}`, `sh_pages=${sh ? `${sh.pagesWithData}/${sh.pages}` : '-'}`,
    `sh_metric=${sh ? sh.metric : '-'}`, `sh_since=${sh ? sh.since : '-'}`,
    `gc_comparable=${gc ? gc.comparableTotal : '-'}`, `sh_comparable=${sh ? sh.comparableTotal : '-'}`,
  ].join('\t');

  const LOG = new URL('./stat-dual-run.log', import.meta.url);
  try {
    const prevLog = await readFile(LOG, 'utf8').catch(() => '');
    const lines = prevLog.split('\n').filter(Boolean);
    const header = '# 双跑日志：新行 sh_metric=visits 为 8 小时同页去重；旧行未标 metric 的自建数据为 PV。gc_comparable/sh_comparable 从 sh_since 起比较，累计起点不同。';
    const body = lines.filter((l) => !l.startsWith('#') && !l.startsWith(day + '\t'));   // 同一天只留最新一条
    const nextLog = [header, ...body, line].join('\n') + '\n';
    if (nextLog !== prevLog) await writeFile(LOG, nextLog, 'utf8');
  } catch (e) {
    console.log(`[stats] 双跑日志没写成：${String(e?.message ?? e).slice(0, 60)}`);
  }

  const table = [
    '| 指标 | GoatCounter（按页 visits） | 自建 stat.x1shang.top（按页 visits） |',
    '|---|---|---|',
    `| 窗口内合计（近 ${DAYS} 天） | ${fmtSide(gc)} | ${fmtSide(sh)} |`,
    `| 终身累计 | ${fmtAllTime(gc)} | ${fmtAllTime(sh)} |`,
    `| ${sh?.since ?? '自建 visits 启用日'} 起合计 | ${gc ? gc.comparableTotal : '—'} | ${sh ? sh.comparableTotal : '—'} |`,
    `| 窗口内有数的天 | ${gc ? gc.activeDays : '—'} | ${sh ? sh.activeDays : '—'} |`,
    `| 按页有数的页面 | ${gc ? `${gc.pagesWithData}/${gc.pages}` : '—'} | ${sh ? `${sh.pagesWithData}/${sh.pages}` : '—'} |`,
    `| 对比起点后仍为 0 的天（需检查采集） | — | ${sh ? sh.zeroSince : '—'} |`,
  ].join('\n');
  console.log(`[stats] 双跑：${line.split('\t').slice(1).join('  ')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await writeFile(process.env.GITHUB_STEP_SUMMARY,
        `\n## 双跑对比（不进 stats.json）\n\n${table}\n\n> 两侧都按会话内同页去重，累计起点不同；从自建 visits 启用日比较趋势。它们都不是全站独立人数。启用当天只覆盖部分时段。\n`,
        { flag: 'a' });
    } catch { /* 摘要写不了就算了 */ }
  }
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
let gcSide = null;   // 双跑：GoatCounter 侧
let shSide = null;   // 双跑：自建侧
try {
  if (DEMO) {
    source = 'demo';
    series = demo();
    let seed = 424242;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const p of await knownPaths()) pages[p] = Math.round(rnd() * 40);
  } else if (!SITE && !HAS_SELFHOSTED) {
    console.log('[stats] 跳过：既没有 GOATCOUNTER_SITE 也没有 STATS_API_URL（也没给 --demo）。');
    console.log('        用法见 tools/fetch-stats.mjs 顶部注释；关于页那张图会一直显示“数据还在积累”。');
    await bail(0);
  } else {
    /* 双跑期：两边都取一遍。**另一侧失败不致命**（只影响对比表），主 provider 失败才走失败处理。 */
    let gcErr = null;
    if (HAS_SELFHOSTED) {
      try { shSide = await fromSelfHosted(); }
      catch (e) { console.log(`[stats] 自建 API 这次没取到（${String(e?.message ?? e).slice(0, 70)}）`); }
    }
    if (SITE) {
      try { gcSide = await viaGoatCounter(); }
      catch (e) { gcErr = e; }
    }

    if (PROVIDER === 'selfhosted') {
      if (shSide) {
        source = 'selfhosted'; series = shSide.series; pages = shSide.pages; allTimeFromApi = shSide.allTime;
      } else if (gcSide) {
        console.log('[stats] ⚠️  自建 API 取不到数 → 按设计回退 GoatCounter（Phase 3 的兜底）。');
        source = gcSide.source; series = gcSide.series; pages = gcSide.pages; allTimeFromApi = gcSide.allTime;
      } else {
        throw gcErr ?? new Error('自建与 GoatCounter 都没取到数');
      }
    } else if (gcSide) {
      source = gcSide.source; series = gcSide.series; pages = gcSide.pages; allTimeFromApi = gcSide.allTime;
    } else if (shSide) {
      console.log('[stats] ⚠️  GoatCounter 取不到数 → 暂用自建统计顶上（stats.json 的 source 会变成 selfhosted）。');
      source = 'selfhosted'; series = shSide.series; pages = shSide.pages; allTimeFromApi = shSide.allTime;
    } else {
      throw gcErr ?? new Error('GoatCounter 与自建都没取到数');
    }
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
  site: source === 'selfhosted' ? `${STATS_API_URL}/` : (BASE ? `${BASE}/` : ''),
  metric: 'visits',
  ...(source === 'selfhosted' ? { since: shSide.since, sessionHours: 8 } : {}),
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
/* 防误伤：**公开计数端点**模式（goatcounter-counter）在国内/未开启后台开关时常常全返回 0 ——
   2026-10-12 实测：本地 `npm run stats`（无 token）把 10-11 抓到的真实数据（total=1、daily 有值）
   整个刷成 0，等于把好数据删了。所以：这种模式下若新数据全空而旧数据非空，就拒绝写入。
   确实想清零（比如站点真没人来了）就加 --force。
   注：自建 provider 不适用这条护栏 —— 它是自己的库，读到 0 就是真的 0。 */
const allZero = (p) => (p.series || []).every((x) => !x.n) && !Object.values(p.pages || {}).some((n) => n > 0);
let prevPayload = null;
try { prevPayload = JSON.parse(prev); } catch { /* 没有旧文件 / 旧文件坏了 */ }
const wouldWipe = !DEMO && source === 'goatcounter-counter'
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
  const unit = '次页面访问（会话内同页去重）';
  console.log(`✅ 已写入 ${OUT}：source=${source}，近 ${DAYS} 天 ${total} ${unit}` + (allTime === null ? '' : `，累计 ${allTime}`));
  console.log(`   按页数据：${Object.keys(pages).length} 页（其中 ${withData} 页有数据）—— 跑一次 npm run build 让文章热度生效。`);
}
/* 双跑对比（§6.1）：放在最后，且**只记录**，不影响上面的 stats.json 写入 */
if (!DEMO) {
  const comparisonSince = shSide?.since?.slice(0, 10) || SELFHOSTED_SINCE;
  await dualRun(
    gcSide ? sideSummary('goatcounter', gcSide, comparisonSince) : null,
    shSide ? sideSummary('selfhosted', shSide, comparisonSince) : null,
  );
}
if (DEMO) console.log('⚠️  这是演示数据，别提交（git checkout -- stats.json 可以还原）。');
