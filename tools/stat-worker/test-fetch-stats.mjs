/** 用隔离目录和 fetch 替身验证 provider 选择；不联网、不改真实 stats.json/日志。 */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = await mkdtemp(path.join(tmpdir(), 'x1shang-stat-test-'));
try {
  await mkdir(path.join(temp, 'tools'));
  const target = path.join(temp, 'tools', 'fetch-stats.mjs');
  await copyFile(new URL('../fetch-stats.mjs', import.meta.url), target);
  for (const scenario of ['goat-default', 'selfhosted', 'legacy-pv', 'selfhosted-failed']) {
    const loader = `
      const scenario = ${JSON.stringify(scenario)};
      const today = new Date().toISOString().slice(0,10);
      globalThis.fetch = async function(url) {
        url = String(url);
        if (url.startsWith('https://mock-stat.invalid/')) {
          if (scenario === 'selfhosted-failed') return new Response('{}', {status:401});
          return Response.json({metric: scenario === 'legacy-pv' ? 'pageviews' : 'visits',
            since: today+'T01:00:00Z', allTime:6, series:[{d:today,n:6}], pages:{'/example':6}});
        }
        if (!url.startsWith('https://mock-goat.goatcounter.com/')) throw new Error('unexpected URL');
        return Response.json({total:4,hits:[{path:'/example',count:4,stats:[{day:today,daily:4}]}]});
      };
    `;
    const out = path.join(temp, scenario + '.json');
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(loader), target], {
      cwd: temp, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, GOATCOUNTER_SITE: 'mock-goat', GOATCOUNTER_TOKEN: 'fake-goat-token',
        STATS_API_URL: 'https://mock-stat.invalid', STATS_API_TOKEN: 'fake-stat-token',
        STATS_PROVIDER: scenario === 'goat-default' ? '' : 'selfhosted', STATS_OUT: out,
        STATS_DAYS: '30', GITHUB_STEP_SUMMARY: path.join(temp, 'summary.md') },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const data = JSON.parse(await readFile(out, 'utf8'));
    const selfhosted = scenario === 'selfhosted';
    assert.equal(data.source, selfhosted ? 'selfhosted' : 'goatcounter-api');
    assert.equal(data.metric, 'visits');
    assert.equal(data.total, selfhosted ? 6 : 4);
    assert.equal(data.site, selfhosted ? 'https://mock-stat.invalid/' : 'https://mock-goat.goatcounter.com/');
    if (selfhosted) { assert.equal(data.sessionHours, 8); assert.ok(data.since); }
    if (scenario === 'legacy-pv') assert.match(result.stdout, /拒绝把历史 PV/);
    console.log(`  ✅ provider ${scenario}：来源、口径、回退及 site 字段正确`);
  }
  const log = await readFile(path.join(temp, 'tools', 'stat-dual-run.log'), 'utf8');
  assert.match(log, /sh_metric=/); assert.match(log, /gc_comparable=/);
  console.log('全部通过 ✅（4 种 provider 场景，隔离运行）');
} finally {
  // 仅删除 mkdtemp 在系统临时目录内创建的本测试目录。
  assert.ok(temp.startsWith(path.join(tmpdir(), 'x1shang-stat-test-')));
  await rm(temp, { recursive: true, force: true });
}
