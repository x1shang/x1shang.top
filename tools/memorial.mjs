#!/usr/bin/env node
/* 11.11 悼念模式（只作用于首页，不含子页面）——由 GitHub Actions 自动开关。
   .github/workflows/memorial-1111.yml 在 11.11 的 00:00 / 23:59（北京时间 UTC+8）调用它。

   它只干一件事：在 index.html 里加/删一段 <!-- home-only:start -->…<!-- home-only:end --> 区块。
   区块内是两处改动：
     1) 首页灰度：body:not(.reading) > * { filter: grayscale(1) }
     2) hero 标语换成「谨致哀思，永怀不忘 / In loving memories of my grandfather」
        （原文案只隐藏、不删除，撤下时原样回来）

   为什么是「整段插入/删除」而不是「改原文、到点再改回来」：
     · 幂等：定时任务重跑、被 GitHub 延后、手动触发多少次，都只有 0 段或 1 段；
     · 可逆：收尾就是删掉这一段，不依赖「记得原文是什么」；
     · 不漏进子页：index.html 同时是子页模板，tools/build-content.mjs 生成子页时会剔除 home-only 区块。

   用法：
     node tools/memorial.mjs                  # auto：按北京时间判断（窗口内上线、窗口外下线）
     node tools/memorial.mjs --state on|off    # 强制，用于预览 / 手动收尾
     node tools/memorial.mjs --state on --dry-run   # 只看会做什么，不写文件
*/

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');

const START = '<!-- home-only:start -->';
const END = '<!-- home-only:end -->';
const BLOCK = `${START}
<!-- 11.11 · 悼念（姥爷忌日）：首页灰度 + 换标语，北京时间 00:00 上线 / 23:59 下线。
     由 .github/workflows/memorial-1111.yml 自动开关（tools/memorial.mjs 写入）；
     整段包在 home-only 里，tools/build-content.mjs 生成子页时会剔除，子页面不受影响。 -->
<style>
/* 灰度逐块加在 body 的直接子元素上：不能加在 html / body 上，
   否则 position:fixed 的底栏与播放器会被拽成随页面滚动 */
body:not(.reading)>*{filter:grayscale(1)}
/* 原标语让位给悼念文案；子页面、以及首页里打开的文章/论文阅读视图都带 body.reading，不显示悼念文案 */
body:not(.reading) .hero .hero-caption:not(.memorial){display:none}
body.reading .hero-caption.memorial{display:none}
</style>
<div class="hero-caption memorial">谨致哀思，永怀不忘<span>In loving memories of my grandfather</span></div>
${END}`;

/* 插在原标语那一行之后（原标语必须留着：撤下时它就是最终态） */
const CAPTION_LINE = /^([ \t]*<div class="hero-caption">.*<\/div>[ \t]*\r?\n)/m;
/* 删整段：开标记到闭标记，连带行首缩进与行尾换行 */
const BLOCK_RE = /[ \t]*<!-- home-only:start -->[\s\S]*?<!-- home-only:end -->[ \t]*\r?\n?/;
/* 原文案（撤下后必须还在，作为「没把首页改坏」的硬校验） */
const ORIGINAL_CAPTION = '山有轮廓，思绪没有。';

const BJ_OFFSET_MS = 8 * 3600 * 1000; // 中国标准时间 UTC+8，全年无夏令时
const pad = (n) => String(n).padStart(2, '0');
function beijingParts(date = new Date()) {
  const t = new Date(date.getTime() + BJ_OFFSET_MS);
  return {
    year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(),
    hour: t.getUTCHours(), minute: t.getUTCMinutes(),
  };
}
const stamp = (p) => `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}（UTC+8）`;

/* 上线窗口：11-11 00:00 ≤ now < 11-11 23:59（北京时间）。
   用「窗口」而不是「日期等于 11-11」，是为了让 23:59 那次定时任务真的能下线：
   GitHub 的 cron 常被延后几分钟，23:59 触发、23:59:40 才真正跑起来时已经出了窗口。
   下线任务若失败/被跳过，每天 12:00 的守护任务会在窗口外把它收掉——所以状态年年自愈。 */
function inWindow(p) {
  return p.month === 11 && p.day === 11 && !(p.hour === 23 && p.minute >= 59);
}

/* ---------------------------------------------------------------- 参数 */
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '') : undefined;
};
const state = String(flag('--state') ?? 'auto').trim().toLowerCase() || 'auto';
const dryRun = argv.includes('--dry-run');
if (!['auto', 'on', 'off'].includes(state)) {
  console.error(`✖ --state 只接受 auto / on / off，收到：${state}`);
  process.exit(2);
}

/* ---------------------------------------------------------------- 判定 */
const now = beijingParts();
const wantOn = state === 'on' ? true : state === 'off' ? false : inWindow(now);

const html = await readFile(INDEX, 'utf8');
/* 跟随文件本身的换行符（Windows 工作区可能被 autocrlf 换成 CRLF），别在一份文件里混两种行尾 */
const eol = html.includes('\r\n') ? '\r\n' : '\n';
const hasBlock = html.includes(START);
let next = html;

if (wantOn && !hasBlock) {
  if (!CAPTION_LINE.test(html)) {
    console.error('✖ index.html 里找不到 <div class="hero-caption"> 那一行，插入点失效——请先看一眼首页 hero 区是不是改过结构');
    process.exit(3);
  }
  const block = BLOCK.split('\n').join(eol);
  next = html.replace(CAPTION_LINE, (line) => `${line}${block}${eol}`);
} else if (!wantOn && hasBlock) {
  if (!BLOCK_RE.test(html)) {
    console.error(`✖ index.html 里有 ${START} 却没有配对的 ${END}，不敢动——请手动检查`);
    process.exit(3);
  }
  next = html.replace(BLOCK_RE, '');
}

/* 写盘前的硬校验：宁可让任务红，也别把首页改坏 */
if (wantOn) {
  if (!next.includes('hero-caption memorial') || !next.includes(ORIGINAL_CAPTION)) {
    console.error('✖ 插入后的自检没过（悼念文案或原文案缺失），不写文件');
    process.exit(4);
  }
} else if (next.includes('memorial') || !next.includes(ORIGINAL_CAPTION)) {
  console.error('✖ 删除后的自检没过（还有 memorial 残留，或原文案丢了），不写文件');
  process.exit(4);
}

const changed = next !== html;
if (!dryRun && changed) await writeFile(INDEX, next, 'utf8');

/* ---------------------------------------------------------------- 汇报 */
const what = wantOn ? '上线' : '下线';
const why = state === 'auto' ? (wantOn ? '在 11.11 窗口内' : '不在 11.11 窗口内') : `手动强制 ${state}`;
console.log(`🕯  11.11 悼念模式 → ${what}｜${why}｜北京时间 ${stamp(now)}｜${changed ? (dryRun ? '需要改动（dry-run，未写盘）' : '已写入 index.html') : '无需改动'}`);
if (dryRun && changed) {
  console.log('--- 改动预览（前 40 行）---');
  const before = new Set(html.split('\n'));
  console.log(next.split('\n').filter((l) => !before.has(l)).slice(0, 40).join('\n'));
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\nmode=${wantOn ? 'on' : 'off'}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const markdown = [
    '### 11.11 悼念模式',
    '',
    `| 项 | 值 |`,
    `| --- | --- |`,
    `| 目标状态 | **${what}**（${why}） |`,
    `| 北京时间（UTC+8） | ${stamp(now)} |`,
    `| index.html | ${changed ? (dryRun ? '需要改动（dry-run）' : '已改动') : '无变化'} |`,
    `| 读取 | 首页灰度 + hero 标语；子页面由 home-only 剔除，不受影响 |`,
    '',
  ].join('\n');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
}
