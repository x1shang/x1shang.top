/**
 * tools/stat-worker/smoke-test.mjs — 部署前本地冒烟测试
 *
 * 用一个内存版 D1 假实现把 Worker 的四个端点整体跑一遍，验证：
 *   ① /s.js 能出脚本且指向当前 origin
 *   ② /c 合法请求写库、非法 Origin / 非法 path / 超大 body 一律不写库且都返回 204
 *   ③ /api/stats 的形状与 stats.json **逐字段一致**、逐日补零、鉴权生效
 *   ④ /api/export 全量导出、鉴权生效
 *
 * 跑法：node tools/stat-worker/smoke-test.mjs
 * 通过：打印 "全部通过"，退出码 0；失败：打印差异并退出码 1。
 */
import worker from './src/index.js';

/* ---------------------------------------------- 内存版 D1（只认本 Worker 用到的几条 SQL） */

const store = new Map(); // `${day}|${path}` -> n
const key = (d, p) => `${d}|${p}`;

const DB = {
  prepare(sql) {
    const stmt = {
      args: [],
      bind(...a) { this.args = a; return this; },
      async run() {
        if (/INSERT INTO hits/i.test(sql)) {
          const k = key(this.args[0], this.args[1]);
          store.set(k, (store.get(k) ?? 0) + 1);
          return { success: true };
        }
        throw new Error('未预期的 run: ' + sql);
      },
      async all() {
        const rows = [...store.entries()].map(([k, n]) => {
          const [day, path] = k.split('|');
          return { day, path, n };
        });
        if (/GROUP BY day/i.test(sql)) {                       // series
          const from = this.args[0];
          const m = new Map();
          for (const r of rows) if (r.day >= from) m.set(r.day, (m.get(r.day) ?? 0) + r.n);
          return { results: [...m.entries()].map(([d, n]) => ({ d, n })) };
        }
        if (/GROUP BY path/i.test(sql)) {                      // pages
          const m = new Map();
          for (const r of rows) m.set(r.path, (m.get(r.path) ?? 0) + r.n);
          return { results: [...m.entries()].map(([path, n]) => ({ path, n })) };
        }
        if (/ORDER BY day, path/i.test(sql)) {                 // export
          return { results: rows.sort((a, b) => (a.day + a.path).localeCompare(b.day + b.path)) };
        }
        throw new Error('未预期的 all: ' + sql);
      },
      async first() {
        if (/SUM\(n\)/i.test(sql)) return { t: [...store.values()].reduce((s, n) => s + n, 0) };
        throw new Error('未预期的 first: ' + sql);
      },
    };
    return stmt;
  },
};

const env = { DB, API_TOKEN: 'test-token-123' };
const BASE = 'https://stat.x1shang.top';

/* ------------------------------------------------------------------ 断言 */

let failed = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${extra ? '  → ' + extra : ''}`);
  if (!cond) failed++;
};
const call = (path, init) => worker.fetch(new Request(BASE + path, init), env);
const post = (body, origin) =>
  call('/c', { method: 'POST', headers: origin ? { Origin: origin } : {}, body: JSON.stringify(body) });

/* ------------------------------------------------------------------ 开跑 */

console.log('\n① /s.js');
{
  const res = await call('/s.js');
  const js = await res.text();
  ok(res.status === 200, 'HTTP 200');
  ok(/javascript/.test(res.headers.get('content-type')), 'content-type 是 js');
  ok(js.includes(`${BASE}/c`), 'beacon 指向当前 origin 的 /c', js.slice(js.indexOf("U='"), js.indexOf("U='") + 46));
  ok(js.includes('visibilitychange') && js.includes('pagehide'), '含 visibilitychange + pagehide');
  ok(/L=p/.test(js.replace(/\s/g, '')), '含同路径去重（避免一次访问记两次）');
  ok(js.length < 1200, `体积 ${js.length} B（目标 ~1KB 内）`);
}

console.log('\n② /c 采集：合法 vs 垃圾');
{
  const before = store.size;
  ok((await post({ p: '/' }, 'https://x1shang.top')).status === 204, '合法（apex）→ 204');
  ok((await post({ p: '/articles/foo/' }, 'https://navi.x1shang.top')).status === 204, '合法（子域）→ 204');
  ok(store.size === before + 2, '两条都写进库了', `库内 ${store.size} 行`);

  const n1 = store.size;
  ok((await post({ p: '/' })).status === 204, '无 Origin → 204');
  ok((await post({ p: '/' }, 'https://evil.example')).status === 204, '非法 Origin → 204');
  ok((await post({ p: '/a?b=1' }, 'https://x1shang.top')).status === 204, 'path 含 ? → 204');
  ok((await post({ p: '/a#b' }, 'https://x1shang.top')).status === 204, 'path 含 # → 204');
  ok((await post({ p: 'no-leading-slash' }, 'https://x1shang.top')).status === 204, 'path 不以 / 开头 → 204');
  ok((await post({ p: '/../../etc/passwd' }, 'https://x1shang.top')).status === 204, 'path 含 .. → 204');
  ok((await post({ p: '/a//b' }, 'https://x1shang.top')).status === 204, 'path 含 // → 204');
  ok((await post({ p: '/a b' }, 'https://x1shang.top')).status === 204, 'path 含空格 → 204');
  ok((await post({ p: '/' + 'x'.repeat(300) }, 'https://x1shang.top')).status === 204, '超长 path → 204');
  ok((await post({ nope: 1 }, 'https://x1shang.top')).status === 204, '缺 p 字段 → 204');
  ok((await post({ p: 123 }, 'https://x1shang.top')).status === 204, 'p 不是字符串 → 204');
  ok((await call('/c', { method: 'POST', headers: { Origin: 'https://x1shang.top' }, body: '{ 坏 json' })).status === 204, '坏 JSON → 204');
  ok((await call('/c', { method: 'POST', headers: { Origin: 'https://x1shang.top' }, body: 'x'.repeat(2000) })).status === 204, '超大 body → 204');
  ok((await call('/c', { method: 'GET' })).status === 204, 'GET /c → 204');
  ok(store.size === n1, '**以上全部没有写库**', `库内仍 ${store.size} 行`);

  // 同一页刷 3 次 → n 累加而不是新增行
  await post({ p: '/' }, 'https://x1shang.top');
  await post({ p: '/' }, 'https://x1shang.top');
  ok(store.get(key(new Date().toISOString().slice(0, 10), '/')) === 3, '同一页 3 次 → n=3（不是 3 行）');
}

console.log('\n③ /api/stats');
{
  ok((await call('/api/stats')).status === 401, '无 token → 401');
  ok((await call('/api/stats', { headers: { Authorization: 'Bearer wrong' } })).status === 401, '错 token → 401');

  const res = await call('/api/stats?days=7', { headers: { Authorization: 'Bearer test-token-123' } });
  const j = await res.json();
  ok(res.status === 200, '正确 token → 200');
  for (const f of ['source', 'site', 'updated', 'days', 'total', 'allTime', 'series', 'pages']) {
    ok(f in j, `含字段 ${f}`);
  }
  ok(j.source === 'selfhosted', "source = 'selfhosted'");
  ok(j.days === 7 && j.series.length === 7, 'series 正好 7 条（逐日补零，不缺日）');
  ok(j.series.every((x, i, a) => i === 0 || a[i - 1].d < x.d), 'series 升序且无重复');
  ok(j.series.at(-1).d === new Date().toISOString().slice(0, 10), '最后一天是今天');
  ok(j.series.every((x) => typeof x.n === 'number' && Number.isInteger(x.n)), '每天的 n 都是整数');
  ok(j.total === j.series.reduce((s, x) => s + x.n, 0), 'total = series 求和');
  ok(j.allTime === 4 && j.pages['/'] === 3 && j.pages['/articles/foo/'] === 1,
    'allTime / pages 正确', `allTime=${j.allTime} pages=${JSON.stringify(j.pages)}`);
  ok(j.days === 7, 'days 参数生效');
  const clamp = await (await call('/api/stats?days=9999', { headers: { Authorization: 'Bearer test-token-123' } })).json();
  ok(clamp.days === 365, 'days 上限被夹到 365');
}

console.log('\n④ /api/export');
{
  ok((await call('/api/export')).status === 401, '无 token → 401');
  const j = await (await call('/api/export', { headers: { Authorization: 'Bearer test-token-123' } })).json();
  ok(Array.isArray(j.data) && j.rows === j.data.length, '返回全量行', `${j.rows} 行`);
  ok(j.data.every((r) => r.day && r.path && typeof r.n === 'number'), '每行形状 {day,path,n}');
}

console.log('\n⑤ 其它路径');
{
  ok((await call('/robots.txt')).status === 200, '/robots.txt → 200（Disallow 全站）');
  ok((await call('/nope')).status === 404, '未知路径 → 404');
  const root = await (await call('/')).json();
  ok(root.service === 'x1shang-stats', '/ → 自述 JSON');
}

console.log(failed === 0 ? '\n全部通过 ✅\n' : `\n${failed} 项失败 ❌\n`);
process.exit(failed === 0 ? 0 : 1);
