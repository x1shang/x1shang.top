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
 * 口径：visits，与 GoatCounter 默认规则接近：8 小时固定会话，同一页只计一次。
 *       各页 visits 求和不是全站独立人数。旧 PV 留在 hits，不冒充历史 visits。
 *
 * 隐私：无 cookie。IP + UA 仅用于服务端 HMAC，原文不落库；采集和取数时清理过期会话。
 *
 * 兼容性硬约束（别改）：`/api/stats` 的字段名与类型必须和 tools/fetch-stats.mjs 写出的
 * `stats.json` 完全一致 —— Phase 3 要把它直接当 provider 用，`build-content.mjs` 零改动。
 */

const VERSION = '2.0.0';
const SESSION_MS = 8 * 60 * 60 * 1000;

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
const MAX_PATH_LEN = 2048;
const MAX_BODY_BYTES = 8192;
const MAX_DAYS = 365;
const BOT_RE = /bot\b|spider|crawler|slurp|headlesschrome|facebookexternalhit|bingpreview|\b(?:curl|wget|python-requests|python-urllib|httpclient|go-http-client)\//i;

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
function p(){var m=location.hash.match(new RegExp('^#(articles|assertions|academic)/(.+)$'));if(m){try{return '/'+m[1]+'/'+encodeURIComponent(decodeURIComponent(m[2]))+'/'}catch(e){}}return location.pathname}
function n(){var q=p();if(!q||q===L)return;try{if(navigator.sendBeacon(U,JSON.stringify({p:q})))L=q}catch(e){}}
n();
addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')n()},{passive:true});
addEventListener('pagehide',n,{passive:true});
['pushState','replaceState'].forEach(function(m){var f=history[m];history[m]=function(){var r=f.apply(this,arguments);n();return r}});
addEventListener('popstate',n,{passive:true});
addEventListener('hashchange',n,{passive:true});})();`;
  return new Response(js, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}

/** 与 GoatCounter 的路径键对齐：去结尾斜杠，统一 URI 编码；拒绝编码后的穿越。 */
function normalizePath(p) {
  if (typeof p !== 'string' || !p || p.length > MAX_PATH_LEN || !PATH_RE.test(p) || p.includes('//')) return null;
  try {
    const parts = p.split('/').map((part) => {
      const text = decodeURIComponent(part);
      if (text === '.' || text === '..' || /[/\\\x00-\x1f\x7f]/.test(text)) throw new Error('invalid path');
      return encodeURIComponent(text);
    });
    return parts.join('/').replace(/\/+$/, '') || '/';
  } catch { return null; }
}

/** 只信任 Cloudflare 提供的连接 IP，不接受客户端自报的 ID / X-Forwarded-For。 */
async function visitorKey(request, env) {
  const ip = request.headers.get('CF-Connecting-IP');
  const ua = request.headers.get('User-Agent');
  if (!ip || !ua || !env.API_TOKEN || BOT_RE.test(ua) || request.cf?.botManagement?.verifiedBot) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.API_TOKEN),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(JSON.stringify(['x1shang-stats-session-v1', ip, ua])));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
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

    let body;
    try { body = JSON.parse(raw); } catch { return NO_CONTENT(cors); }
    const p = normalizePath(body?.p);
    if (!p) return NO_CONTENT(cors);
    const key = await visitorKey(request, env);
    if (!key) return NO_CONTENT(cors);

    const now = Date.now(), day = dayKeyAt(now);
    // D1 batch 是事务：并发刷新也只能把同一 session/path 的 visits 加一。
    // 会话从首次访问起固定 8 小时，跨 UTC 午夜不会重新计数。
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
      env.DB.prepare('INSERT OR IGNORE INTO sessions (visitor_key, session_id, expires_at) VALUES (?1, ?2, ?3)')
        .bind(key, crypto.randomUUID(), now + SESSION_MS),
      env.DB.prepare("INSERT OR IGNORE INTO stats_meta (key, value) VALUES ('visits_since', ?1)")
        .bind(new Date(now).toISOString()),
      env.DB.prepare(`INSERT INTO hits (day, path, n) VALUES (?1, ?2, 1)
        ON CONFLICT(day, path) DO UPDATE SET n = hits.n + 1`).bind(day, p),
      env.DB.prepare(`INSERT INTO visits (day, path, n)
        SELECT ?1, ?2, 1 FROM sessions s WHERE s.visitor_key = ?3
          AND NOT EXISTS (SELECT 1 FROM session_paths sp WHERE sp.session_id = s.session_id AND sp.path = ?2)
        ON CONFLICT(day, path) DO UPDATE SET n = visits.n + 1`).bind(day, p, key),
      env.DB.prepare(`INSERT OR IGNORE INTO session_paths (session_id, path)
        SELECT session_id, ?1 FROM sessions WHERE visitor_key = ?2`).bind(p, key),
    ]);
  } catch {
    /* 不把 IP / UA / 路径写进日志；返回仍是 204。 */
    console.error('[stats] collection failed');
  }
  return NO_CONTENT(cors);
}

/* ------------------------------------------------------------ 数据端 */

/** GET /api/stats?days=30 —— 与 stats.json 同形状（多一个 source 字段：'selfhosted'） */
async function apiStats(request, url, env) {
  if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(Date.now()).run();

  const asked = Number.parseInt(url.searchParams.get('days') ?? '30', 10);
  const days = Math.min(Math.max(Number.isFinite(asked) ? asked : 30, 1), MAX_DAYS);
  const list = lastDays(days);
  const from = list[0];
  const metric = url.searchParams.get('metric') || 'visits';
  if (!['visits', 'pageviews'].includes(metric)) return json({ error: 'invalid metric' }, 400);
  const table = metric === 'visits' ? 'visits' : 'hits';

  const [byDay, allTimeRow, pagesRows, since] = await Promise.all([
    env.DB.prepare(`SELECT day AS d, SUM(n) AS n FROM ${table} WHERE day >= ?1 GROUP BY day`).bind(from).all(),
    env.DB.prepare(`SELECT COALESCE(SUM(n), 0) AS t FROM ${table}`).first(),
    env.DB.prepare(`SELECT path, SUM(n) AS n FROM ${table} GROUP BY path`).all(),
    env.DB.prepare("SELECT value FROM stats_meta WHERE key = 'visits_since'").first(),
  ]);

  const seen = new Map((byDay.results ?? []).map((r) => [r.d, Number(r.n) || 0]));
  const series = list.map((d) => ({ d, n: seen.get(d) ?? 0 }));      // 逐日补零，绝不缺日

  const pages = {};
  for (const r of pagesRows.results ?? []) pages[r.path] = Number(r.n) || 0;

  return json({
    source: 'selfhosted',
    metric,
    sessionHours: metric === 'visits' ? 8 : null,
    since: metric === 'visits' ? (since?.value ?? null) : '2026-10-16T00:00:00Z',
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
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(Date.now()).run();
  const r = await env.DB.prepare(`SELECT day, path, n FROM hits ORDER BY day, path`).all();
  const rows = r.results ?? [];
  const visits = await env.DB.prepare('SELECT day, path, n FROM visits ORDER BY day, path').all();
  const since = await env.DB.prepare("SELECT value FROM stats_meta WHERE key = 'visits_since'").first();
  return json({
    source: 'selfhosted',
    exported: new Date().toISOString(),
    schema: 'hits(day TEXT, path TEXT, n INTEGER)',
    rows: rows.length,
    data: rows,
    metric: 'pageviews',             // 保持旧备份 data 字段的口径，历史 PV 不丢失
    visits: visits.results ?? [],
    visitsSince: since?.value ?? null,
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
        return json({ service: 'x1shang-stats', version: VERSION, metric: 'visits', sessionHours: 8,
          endpoints: ['/s.js', '/c', '/api/stats', '/api/export'] });
      default:
        return new Response('not found\n', { status: 404 });
    }
  },
};
