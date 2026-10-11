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
 * 参数：--days 30（默认 30）· --out stats.json
 * 输出：{ source, site, updated, days, total, allTime, series: [{ d:'YYYY-MM-DD', n:number }] }
 * 口径：GoatCounter 的 daily / count 都是「访客数」（它的 count_unique 与 count 相同）。
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

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

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

/** 模式 1：API + token，一次拿到逐日访客数 */
async function fromApi() {
  const start = `${dayList[0]}T00:00:00Z`;
  const end = `${dayList[dayList.length - 1]}T23:59:59Z`;
  const url = `${BASE}/api/v0/stats/hits?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=100&group=day`;
  const data = await getJson(url, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  });
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
if (DEMO) {
  source = 'demo';
  series = demo();
} else if (!SITE) {
  console.log('[stats] 跳过：没有配置 GOATCOUNTER_SITE（也没给 --demo）。');
  console.log('        用法见 tools/fetch-stats.mjs 顶部注释；关于页那张图会一直显示“数据还在积累”。');
  process.exit(0);
} else if (TOKEN) {
  source = 'goatcounter-api';
  series = await fromApi();
} else {
  source = 'goatcounter-counter';
  console.log(`[stats] 没给 token，走公开计数端点逐日取 ${DAYS} 天（较慢）…`);
  series = await fromCounter();
}

const total = series.reduce((s, x) => s + x.n, 0);
const allTime = DEMO ? total : await fetchAllTime();
const payload = {
  source,
  site: BASE ? `${BASE}/` : '',
  updated: new Date().toISOString(),
  days: DAYS,
  total,
  allTime,
  series,
};
await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`✅ 已写入 ${OUT}：source=${source}，近 ${DAYS} 天 ${total} 位访客` + (allTime === null ? '' : `，累计 ${allTime}`));
if (DEMO) console.log('⚠️  这是演示数据，别提交（git checkout -- stats.json 可以还原）。');
