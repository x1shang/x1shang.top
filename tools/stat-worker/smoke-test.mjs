/** Worker 回归测试：真实 SQLite 执行迁移及 D1 SQL，VM 执行线上 beacon。
 * Node 22.13+：node tools/stat-worker/smoke-test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from './src/index.js';

let checks = 0;
function check(label, fn) { fn(); checks++; console.log(`  ✅ ${label}`); }
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE hits(day TEXT, path TEXT, n INTEGER, PRIMARY KEY(day,path));');
sqlite.prepare('INSERT INTO hits VALUES(?,?,?)').run('2026-10-16', '/legacy/', 9);
const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
sqlite.exec(schema);
sqlite.exec(schema);
check('增量迁移可重复执行，旧 PV 保留且不伪造 visits', () => {
  assert.equal(sqlite.prepare('SELECT SUM(n) n FROM hits').get().n, 9);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM visits').get().n, 0);
});

// 使用真实 SQLite，避免用正则假数据库把错误的 SQL 也测试通过。
const DB = {
  prepare(sql) {
    const native = sqlite.prepare(sql);
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async run() { return { success: true, meta: native.run(...this.args) }; },
      async all() { return { results: native.all(...this.args) }; },
      async first() { return native.get(...this.args) ?? null; },
      execute() { return native.run(...this.args); },
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = statements.map((s) => ({ success: true, meta: s.execute() }));
      sqlite.exec('COMMIT'); return result;
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};
const env = { DB, API_TOKEN: 'local-test-secret' };
const base = 'https://stat.x1shang.top';
const auth = { Authorization: `Bearer ${env.API_TOKEN}` };
const headers = { Origin: 'https://x1shang.top', 'CF-Connecting-IP': '192.0.2.1', 'User-Agent': 'Mozilla/5.0 Firefox/143.0' };
const call = (path, init) => worker.fetch(new Request(base + path, init), env);
const post = (p, extra = {}) => call('/c', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ p }) });
const stats = async (metric = 'visits') => (await call(`/api/stats?days=30&metric=${metric}`, { headers: auth })).json();
const count = (table, path) => Number(sqlite.prepare(`SELECT COALESCE(SUM(n),0) n FROM ${table} WHERE path=?`).get(path).n);
const rows = (table) => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const originalNow = Date.now;
let now = Date.parse('2026-10-18T12:00:00Z');
Date.now = () => now;

try {
  console.log('\n① 浏览器脚本');
  const response = await call('/s.js');
  const script = await response.text();
  check('脚本返回 JavaScript 且不写 cookie/localStorage', () => {
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.doesNotMatch(script, /document\.cookie|localStorage/);
  });
  function browser(pathname = '/', hash = '', accepted = true) {
    const events = new Map(), sent = [];
    const location = { pathname, hash };
    const context = { location, document: { visibilityState: 'visible' },
      navigator: { sendBeacon: (url, body) => { sent.push({ url, ...JSON.parse(body) }); return accepted; } },
      history: { pushState() {}, replaceState() {} },
      addEventListener: (name, fn) => events.set(name, fn) };
    vm.runInNewContext(script, context);
    return { ...context, sent, emit: (name) => events.get(name)?.() };
  }
  const b = browser();
  b.document.visibilityState = 'hidden'; b.emit('visibilitychange'); b.emit('pagehide');
  check('加载只发一次，切后台和关闭不重复上报', () => assert.deepEqual(b.sent, [{ url: `${base}/c`, p: '/' }]));
  b.location.hash = '#about'; b.emit('hashchange');
  check('栏目和普通锚点不被当成新的文章路径', () => assert.equal(b.sent.length, 1));
  b.location.hash = '#articles/到上海去'; b.emit('hashchange');
  check('哈希文章路由按真实路径上报', () => assert.equal(b.sent.at(-1).p, '/articles/%E5%88%B0%E4%B8%8A%E6%B5%B7%E5%8E%BB/'));
  b.emit('hashchange');
  check('同一文章的重复路由事件不再上报', () => assert.equal(b.sent.length, 2));
  b.location.hash = '#academic/paper'; b.emit('hashchange');
  b.location.hash = '#articles/到上海去'; b.emit('hashchange');
  check('离开再返回会上报，由服务端负责会话去重', () => assert.equal(b.sent.length, 4));
  b.location.hash = ''; b.location.pathname = '/articles/push/'; b.history.pushState();
  b.location.pathname = '/articles/replace/'; b.history.replaceState();
  b.location.pathname = '/articles/back/'; b.emit('popstate');
  check('pushState、replaceState、前进后退均覆盖', () => assert.deepEqual(b.sent.slice(-3).map((x) => x.p),
    ['/articles/push/', '/articles/replace/', '/articles/back/']));
  check('直接打开预渲染页只报真实路径', () => assert.equal(browser('/articles/direct/').sent[0].p, '/articles/direct/'));
  check('带文章哈希直接进入时定位文章', () => assert.equal(browser('/', '#assertions/example').sent[0].p, '/assertions/example/'));
  const failedBeacon = browser('/', '', false); failedBeacon.emit('pagehide');
  check('sendBeacon 返回 false 后仍允许重试', () => assert.equal(failedBeacon.sent.length, 2));

  console.log('\n② 会话与路径计数');
  await Promise.all(Array.from({ length: 20 }, () => post('/articles/reload/')));
  check('并发刷新 20 次：20 PV、1 visit，尾斜杠统一', () => {
    assert.equal(count('hits', '/articles/reload'), 20); assert.equal(count('visits', '/articles/reload'), 1);
  });
  await post('/articles/other/'); await post('/articles/reload');
  check('访问另一页加一，返回原页不加 visits', () => {
    assert.equal(count('visits', '/articles/other'), 1); assert.equal(count('visits', '/articles/reload'), 1);
  });
  await post('/articles/reload/', { 'CF-Connecting-IP': '192.0.2.2' });
  await post('/articles/reload/', { 'User-Agent': 'Mozilla/5.0 Chrome/140.0' });
  check('不同 IP 或不同 UA 分别识别会话', () => assert.equal(count('visits', '/articles/reload'), 3));
  await post('/articles/reload/', { Origin: 'https://navi.x1shang.top' });
  check('同一统计站点下的子域共享会话口径', () => assert.equal(count('visits', '/articles/reload'), 3));
  await post('/t%65st/'); await post('/test');
  check('等价 URI 编码归一到同一页面', () => assert.equal(count('visits', '/test'), 1));
  const longPath = '/articles/' + encodeURIComponent('我为什么写记叙文：作文中的有用与无用').repeat(2);
  await post(longPath + '/');
  check('正常中文长路径不会被旧的 200 字符限制漏掉', () => assert.equal(count('visits', longPath), 1));
  now += 7 * 3600000; await post('/articles/reload');
  now += 3600000; await post('/articles/reload');
  check('8 小时从首次访问计时，刷新不延长会话', () => assert.equal(count('visits', '/articles/reload'), 4));
  now = Date.parse('2026-10-18T23:55:00Z'); await post('/cross-midnight', { 'CF-Connecting-IP': '192.0.2.3' });
  now += 10 * 60000; await post('/cross-midnight', { 'CF-Connecting-IP': '192.0.2.3' });
  check('跨 UTC 午夜仍在原会话内，不按天强制重计', () => assert.equal(count('visits', '/cross-midnight'), 1));

  console.log('\n③ 过滤与隐私');
  const before = count('hits', '/') + rows('visits');
  for (const p of ['/a?b=1', '/a#b', 'no-slash', '/../etc', '/%2e%2e/etc', '/a//b', '/%2fadmin', '/%5cadmin', '/a b', '/bad%ZZ', '/' + 'x'.repeat(2050), null, 12]) {
    assert.equal((await post(p)).status, 204);
  }
  await post('/', { Origin: 'https://evil.example' });
  await post('/', { Origin: 'https://x1shang.top.evil.example' });
  await post('/', { Origin: '' });
  await post('/', { 'CF-Connecting-IP': '' });
  await post('/', { 'User-Agent': '' });
  await post('/', { 'User-Agent': 'Googlebot/2.1' });
  await post('/', { 'User-Agent': 'curl/8.0' });
  await call('/c', { method: 'POST', headers, body: '{bad json' });
  await call('/c', { method: 'POST', headers, body: 'x'.repeat(9000) });
  check('非法来源/编码/路径/体积、缺失身份及常见机器人均不入库', () => assert.equal(count('hits', '/') + rows('visits'), before));
  check('数据库无原始 IP / UA，会话 key 为 HMAC 和随机 UUID', () => {
    const session = sqlite.prepare('SELECT * FROM sessions LIMIT 1').get();
    assert.deepEqual(Object.keys(session), ['visitor_key', 'session_id', 'expires_at']);
    assert.match(session.visitor_key, /^[a-f0-9]{64}$/); assert.match(session.session_id, /^[a-f0-9-]{36}$/);
  });
  const visitTotal = (await stats()).allTime;
  now += 9 * 3600000; await stats();
  check('取数时清理过期会话和已见路径，累计 visits 保留', () => {
    assert.equal(rows('sessions'), 0); assert.equal(rows('session_paths'), 0);
    assert.equal(sqlite.prepare('SELECT SUM(n) n FROM visits').get().n, visitTotal);
  });

  console.log('\n④ API、旧数据与导出');
  assert.equal((await call('/api/stats')).status, 401);
  assert.equal((await call('/api/export')).status, 401);
  assert.equal((await call('/api/stats', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  check('统计及导出必须带正确 token', () => {});
  const j = await stats();
  check('保留 stats.json 字段，明确 visits 口径、8 小时及开始时间', () => {
    for (const field of ['source', 'site', 'updated', 'days', 'total', 'allTime', 'series', 'pages']) assert.ok(field in j);
    assert.equal(j.source, 'selfhosted'); assert.equal(j.metric, 'visits'); assert.equal(j.sessionHours, 8);
    assert.equal(j.since, '2026-10-18T12:00:00.000Z');
    assert.equal(j.series.length, 30); assert.equal(j.total, j.series.reduce((s, x) => s + x.n, 0));
    assert.ok(j.series.every((x, i, a) => i === 0 || a[i - 1].d < x.d));
    assert.equal(j.pages['/legacy/'], undefined);
  });
  const pv = await stats('pageviews');
  check('旧 PV 可单独查询，与新 visits 分开', () => { assert.equal(pv.metric, 'pageviews'); assert.equal(pv.pages['/legacy/'], 9); assert.ok(pv.allTime > j.allTime); });
  assert.equal((await call('/api/stats?metric=invalid', { headers: auth })).status, 400);
  const clamp = await (await call('/api/stats?days=9999', { headers: auth })).json();
  check('日期上限和逐日补零保持兼容', () => { assert.equal(clamp.days, 365); assert.equal(clamp.series.length, 365); });
  const exported = await (await call('/api/export', { headers: auth })).json();
  check('旧备份 data 保持 PV，同时导出新 visits，不导出会话身份', () => {
    assert.equal(exported.rows, exported.data.length); assert.equal(exported.metric, 'pageviews');
    assert.ok(exported.data.some((r) => r.path === '/legacy/' && r.n === 9));
    assert.ok(exported.visits.length > 0); assert.equal(exported.visitsSince, j.since);
    assert.doesNotMatch(JSON.stringify(exported), /visitor_key|session_id|192\.0\.2|Mozilla/);
  });
  const service = await (await call('/')).json();
  check('服务自述声明 v2 与新口径', () => { assert.equal(service.version, '2.0.0'); assert.equal(service.metric, 'visits'); });
  assert.equal((await call('/robots.txt')).status, 200); assert.equal((await call('/nope')).status, 404);
  console.log(`\n全部通过 ✅（${checks} 组检查，真实 SQLite + 浏览器脚本 VM）\n`);
} finally { Date.now = originalNow; sqlite.close(); }
