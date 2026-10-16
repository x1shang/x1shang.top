/**
 * tools/stat-worker/src/index.js — stat.x1shang.top：自建访客统计（Workers + D1）
 *
 * 计划：`计划-Cloudflare迁移与统计自建.md` §5（Phase 2）
 *
 * 四个端点
 *   GET  /s.js                beacon 脚本（公开、自己托管、~0.5KB、无第三方依赖）
 *   POST /c                   采集：浏览器回报一次页面浏览（公开，但校验 Origin/Referer + path 正则）
 *   GET  /api/stats?days=30   数据端：返回**与 stats.json 同形状**的 JSON，给 CI/本地取数用（Bearer token）
 *   GET  /api/export          全量导出（备份用，Bearer token）
 *   GET  /robots.txt          计数器主机不做内容，整站 Disallow
 *
 * 口径：**PV（页面浏览量）**，不是 UV。与 GoatCounter 的"访客数"不同口径，
 *       双跑期（§6.1）允许绝对值有差异，但**不允许缺日/断档**。
 *       要 UV 见 §5.1 的 `visitors(day, vid_hash)` 方案（Phase 2.5，可选）。
 *
 * 隐私：无 cookie、无 IP、无 UA、无第三方脚本。只记「哪一天 / 哪一页 / 几次」。
 *
 * 兼容性硬约束（别改）：`/api/stats` 的字段名与类型必须和 tools/fetch-stats.mjs 写出的
 * `stats.json` 完全一致 —— Phase 3 要把它直接当 provider 用，`build-content.mjs` 零改动。
 */

const VERSION = '1.0.0';

/* ------------------------------------------------------------------ 配置 */

/**
 * 允许上报的来源域（含其子域）。
 * 个人站 x1shang.top + 导航页 navi.x1shang.top 都命中 'x1shang.top'。
 * 将来若要统计老域名跳转桩，把 punycode 形式加进来：'xn--vnqp08bwj8a.xn--0iv.gay'
 */
const ALLOWED_HOSTS = ['x1shang.top'];

/**
 * 日界偏移（分钟）。**0 = UTC，与计划 §5.1 的 schema 注释一致。**
 * 改成 480 会按北京时间切天，但**已经写进库的历史行不会跟着变** → 双跑对比会出现断层。
 * 结论：上线前定好，之后别动。
 */
const DAY_OFFSET_MINUTES = 0;

/** path 白名单正则（计划 §5.1）：只允许 URL path 里合法且无歧义的字符 */
const PATH_RE = /^\/[A-Za-z0-9%._~!$&'()*+,;=:@/-]*$/;
const MAX_PATH_LEN = 200;
const MAX_BODY_BYTES = 1024;
const MAX_DAYS = 365;

/* ------------------------------------------------------------ 小工具 */

const NO_CONTENT = (headers = {}) => new Response(null, { status: 204, headers });

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj, null, 2) + '\n', {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

/** 某毫秒时刻落在哪一天（'YYYY-MM-DD'） */
const dayKeyAt = (ms) => new Date(ms + DAY_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
const dayKey = () => dayKeyAt(Date.now());

/** 最近 n 天的日期列表（含今天），升序 —— series 必须逐日给全，缺日会让那张图画断 */
function lastDays(n) {
  const now = Date.now();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKeyAt(now - i * 86400000));
  return out;
}

/** Origin/Referer 白名单：Origin 优先；没有 Origin 才看 Referer（老浏览器/某些隐私模式） */
function originAllowed(request) {
  const hostOk = (value) => {
    if (!value) return false;
    try {
      const h = new URL(value).hostname.toLowerCase();
      return ALLOWED_HOSTS.some((d) => h === d || h.endsWith('.' + d));
    } catch {
      return false;
    }
  };
  const origin = request.headers.get('Origin');
  if (origin) return hostOk(origin);            // 有 Origin 就以它为准，不合法直接拒
  return hostOk(request.headers.get('Referer'));
}

/** Bearer token 校验（secret: API_TOKEN） */
function authed(request, env) {
  const secret = env.API_TOKEN;
  if (!secret) return false;
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  return !!m && m[1] === secret;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400' };
}

/* ------------------------------------------------------------ 采集端 */

/**
 * beacon 脚本。要点：
 *  - 同路径去重：visibilitychange→hidden 与 pagehide 都会触发，不去重会**一次访问记两次**
 *  - 顺手接管 SPA 的 pushState/replaceState/popstate：站内切文章也各算一次浏览
 *  - 用 sendBeacon：不阻塞卸载，字符串体默认 text/plain → 不触发 CORS 预检
 *  - 采集地址从**当前请求的 origin** 推出来，所以 workers.dev 预览域名也能用
 */
function beaconScript(origin) {
  const js = `(function(){var U=${JSON.stringify(origin + '/c')},L='';
function s(p){if(!p||p===L)return;L=p;try{navigator.sendBeacon(U,JSON.stringify({p:p}))}catch(e){}}
function n(){s(location.pathname)}
n();
addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')n()},{passive:true});
addEventListener('pagehide',n,{passive:true});
['pushState','replaceState'].forEach(function(m){var f=history[m];history[m]=function(){var r=f.apply(this,arguments);n();return r}});
addEventListener('popstate',n,{passive:true});})();`;
  return new Response(js, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}

/**
 * POST /c —— 记一次浏览。
 * **任何情况都返回 204**（合法、非法、垃圾都一样），不给探测者任何反馈。
 */
async function collect(request, env) {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return NO_CONTENT(cors);
  if (request.method !== 'POST') return NO_CONTENT(cors);

  try {
    if (!originAllowed(request)) return NO_CONTENT();   // 不合法来源：连 CORS 头都不给

    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return NO_CONTENT(cors);

    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY_BYTES) return NO_CONTENT(cors);

    const p = JSON.parse(raw)?.p;
    if (typeof p !== 'string' || !p || p.length > MAX_PATH_LEN) return NO_CONTENT(cors);
    // PATH_RE 只管**字符集**（`..` 和 `//` 里的 `.` `/` 都是合法字符，能过正则），
    // 所以语义垃圾要单独挡：计数器没有文件系统、`..` 不构成穿越，但没必要让脏键进库。
    if (!PATH_RE.test(p) || p.includes('//') || p.includes('..')) return NO_CONTENT(cors);

    await env.DB.prepare(
      `INSERT INTO hits (day, path, n) VALUES (?1, ?2, 1)
       ON CONFLICT(day, path) DO UPDATE SET n = hits.n + 1`
    ).bind(dayKey(), p).run();
  } catch {
    /* 静默丢弃：统计端点绝不能因为垃圾请求而 5xx，也不能泄漏失败原因 */
  }
  return NO_CONTENT(cors);
}

/* ------------------------------------------------------------ 数据端 */

/** GET /api/stats?days=30 —— 与 stats.json 同形状（多一个 source 字段：'selfhosted'） */
async function apiStats(request, url, env) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

  const asked = Number.parseInt(url.searchParams.get('days') ?? '30', 10);
  const days = Math.min(Math.max(Number.isFinite(asked) ? asked : 30, 1), MAX_DAYS);
  const list = lastDays(days);
  const from = list[0];

  const [byDay, allTimeRow, pagesRows] = await Promise.all([
    env.DB.prepare(`SELECT day AS d, SUM(n) AS n FROM hits WHERE day >= ?1 GROUP BY day`).bind(from).all(),
    env.DB.prepare(`SELECT COALESCE(SUM(n), 0) AS t FROM hits`).first(),
    env.DB.prepare(`SELECT path, SUM(n) AS n FROM hits GROUP BY path`).all(),
  ]);

  const seen = new Map((byDay.results ?? []).map((r) => [r.d, Number(r.n) || 0]));
  const series = list.map((d) => ({ d, n: seen.get(d) ?? 0 }));      // 逐日补零，绝不缺日

  const pages = {};
  for (const r of pagesRows.results ?? []) pages[r.path] = Number(r.n) || 0;

  return json({
    source: 'selfhosted',
    site: url.origin + '/',
    updated: new Date().toISOString(),
    days,
    total: series.reduce((s, x) => s + x.n, 0),
    allTime: Number(allTimeRow?.t ?? 0),
    series,
    pages,
  });
}

/** GET /api/export —— 全量导出（每周拉一次落进仓库，§8.7「数据别只在别人手里」） */
async function apiExport(request, env) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  const r = await env.DB.prepare(`SELECT day, path, n FROM hits ORDER BY day, path`).all();
  const rows = r.results ?? [];
  return json({
    source: 'selfhosted',
    exported: new Date().toISOString(),
    schema: 'hits(day TEXT, path TEXT, n INTEGER)',
    rows: rows.length,
    data: rows,
  });
}

/* ------------------------------------------------------------ 入口 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/s.js':
        return beaconScript(url.origin);
      case '/c':
        return collect(request, env);
      case '/api/stats':
        return apiStats(request, url, env);
      case '/api/export':
        return apiExport(request, env);
      case '/robots.txt':
        return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      case '/':
        return json({ service: 'x1shang-stats', version: VERSION, endpoints: ['/s.js', '/c', '/api/stats', '/api/export'] });
      default:
        return new Response('not found\n', { status: 404 });
    }
  },
};
