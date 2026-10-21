#!/usr/bin/env node
/**
 * tools/fetch-repos.mjs — 把 GitHub 公开仓库数抓成 github.json（关于页计数卡片的数据源）
 *
 * 数据只有「公开仓库总数」一个：GET https://api.github.com/users/<login> → public_repos。
 * 和访客统计一样，站点只读仓库里的静态快照，访客的浏览器不请求 GitHub。
 *
 * 为什么单独一个文件、而不是塞进 stats.json：
 *   · 访客统计可能因 GoatCounter 抽风而整体失败/回退，仓库数不该混在随时可能失败的数据里；
 *   · 这个脚本在 Actions 里跟 stats 同一个 job 跑（顺便读一下），但只在自己那份快照变了才写文件。
 *
 * 用法：
 *   node tools/fetch-repos.mjs                  # 读 content.js 里的 github: 用户名
 *   node tools/fetch-repos.mjs --login x1shang  # 显式指定
 *   可选环境变量：GITHUB_TOKEN（Actions 里用默认 token，避免匿名配额）
 *
 * 失败处理：拿不到数时保留旧快照并正常退出（不把每天定时的 stats job 变红）；
 *          只有连旧快照都没有、站上真的没数可显示时才以 1 退出。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(path.join(HERE, '..'));
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const OUT = path.resolve(ROOT, flag('out', 'github.json'));
const TOKEN = String(process.env.GITHUB_TOKEN || '').trim();

/** 从 content.js 的 github: 'x1shang' 里取默认用户名，避免两处手写 */
async function loginFromConfig() {
  try {
    const cfg = await readFile(path.join(ROOT, 'content.js'), 'utf8');
    return (cfg.match(/\bgithub\s*:\s*['"`]([^'"`]*)['"`]/) || [])[1] || '';
  } catch {
    return '';
  }
}

const LOGIN = String(flag('login', process.env.GITHUB_LOGIN || '') || await loginFromConfig() || 'x1shang').trim();
if (!/^[A-Za-z0-9-]+$/.test(LOGIN)) {
  console.error(`[repos] ✗ 用户名不合法：${LOGIN}`);
  process.exit(1);
}

const headers = {
  'User-Agent': 'x1shang-site-build',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

async function getUser() {
  const url = `https://api.github.com/users/${encodeURIComponent(LOGIN)}`;
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (res.ok) return res.json();
      last = new Error(`HTTP ${res.status} ${res.statusText}`);
      if (![408, 429, 500, 502, 503, 504].includes(res.status)) break;
    } catch (e) {
      last = e;
    }
    if (i < 3) await new Promise((r) => setTimeout(r, 2 ** i * 1000));
  }
  throw last;
}

const prevRaw = await readFile(OUT, 'utf8').catch(() => '');
let prev = null;
try { prev = JSON.parse(prevRaw); } catch { /* 没有旧文件，或旧文件坏了 */ }

try {
  const user = await getUser();
  const publicRepos = Number(user.public_repos);
  if (!Number.isInteger(publicRepos) || publicRepos < 0) {
    throw new Error(`接口里的 public_repos 不是非负整数：${user.public_repos}`);
  }
  if (prev && prev.login === LOGIN && prev.publicRepos === publicRepos) {
    console.log(`[repos] 公开仓库数仍是 ${publicRepos}，保持 github.json 不动（不会产生提交）。`);
  } else {
    const next = JSON.stringify({ login: LOGIN, publicRepos, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n';
    await writeFile(OUT, next, 'utf8');
    const before = prev && Number.isInteger(prev.publicRepos) ? prev.publicRepos : '—';
    console.log(`✅ 公开仓库数 ${before} → ${publicRepos}，已写入 ${path.relative(ROOT, OUT)}。`);
  }
} catch (e) {
  const msg = String(e?.message ?? e);
  const hasPrev = Boolean(prev && Number.isInteger(prev.publicRepos));
  const line = hasPrev
    ? `⚠️  读取 GitHub 用户资料失败：${msg} —— 保留旧快照（${prev.publicRepos} 个公开仓库），不影响本次构建。`
    : `❌ 读取 GitHub 用户资料失败：${msg} —— 没有旧快照，关于页的仓库数会暂时显示「—」。`;
  console.warn(`[repos] ${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, `## GitHub 仓库数\n\n${line}\n`, { flag: 'a' });
    } catch { /* 摘要写不了就算了 */ }
  }
  if (!hasPrev) process.exitCode = 1;
}
