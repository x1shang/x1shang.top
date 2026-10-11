// 校验磁贴排版：把 headless 导出的 DOM 解析成格子坐标，检查①无重叠②不越界③正好铺满网格
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const G = html.match(/data-grid="(\d+)x(\d+)@(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)"/);
if (!G) { console.log('❌ 页面没有写出 data-grid（JS 可能没跑）'); process.exit(1); }
const [, cols, rows, U, GAP] = [G[0], +G[1], +G[2], +G[3], +G[4]];
const STEP = U + GAP;
console.log(`页面自报网格: ${cols} 列 × ${rows} 行，单位 ${U}px + 间距 ${GAP}px`);
const tiles = [...html.matchAll(/<(?:a|div)\s[^>]*class="tile[^"]*"[^>]*>/gi)].map((m) => m[0]);
const items = [];
for (const tag of tiles) {
  const id = (tag.match(/data-id="([^"]+)"/) || [])[1];
  const style = (tag.match(/style="([^"]*)"/) || [])[1] || '';
  const num = (k) => {
    const m = style.match(new RegExp('(?:^|;)\\s*' + k + ':\\s*([0-9.]+)px'));
    return m ? parseFloat(m[1]) : null;
  };
  const left = num('left'), top = num('top'), width = num('width'), height = num('height');
  if (!id || left === null || top === null || width === null || height === null) {
    items.push({ id: id || '?', missing: true });
    continue;
  }
  items.push({
    id,
    x: left / STEP, y: top / STEP,
    w: (width + GAP) / STEP, h: (height + GAP) / STEP,
  });
}

console.log('磁贴数量: ' + items.length);
const bad = [];
const occ = new Map();
let area = 0, maxX = 0, maxY = 0;
for (const t of items) {
  if (t.missing) { bad.push(t.id + ': 没有定位样式'); continue; }
  const ints = [t.x, t.y, t.w, t.h].every((n) => Math.abs(n - Math.round(n)) < 1e-6);
  console.log(`  ${t.id.padEnd(10)} x=${t.x} y=${t.y} w=${t.w} h=${t.h}${ints ? '' : '  ⚠️ 非整数格'}`);
  if (!ints) bad.push(t.id + ': 坐标不是整数格');
  for (let i = 0; i < Math.round(t.w); i++) for (let j = 0; j < Math.round(t.h); j++) {
    const k = (Math.round(t.x) + i) + ',' + (Math.round(t.y) + j);
    if (occ.has(k)) bad.push('重叠: ' + k + ' (' + occ.get(k) + ' 与 ' + t.id + ')');
    occ.set(k, t.id);
  }
  area += Math.round(t.w) * Math.round(t.h);
  maxX = Math.max(maxX, Math.round(t.x + t.w));
  maxY = Math.max(maxY, Math.round(t.y + t.h));
}
console.log(`占用格数: ${occ.size}（磁贴面积和 ${area}）  棋盘尺寸: ${maxX} × ${maxY}`);
const board = maxX * maxY;
const holes = [];
for (let y = 0; y < maxY; y++) for (let x = 0; x < maxX; x++) if (!occ.has(x + ',' + y)) holes.push(x + ',' + y);
if (holes.length) bad.push(`没有铺满：包围盒 ${maxX}×${maxY}=${board} 格里有 ${holes.length} 个空格（${holes.slice(0, 8).join(' ')}${holes.length > 8 ? ' …' : ''}）`);
if (bad.length) { console.log('\n❌ 问题:'); bad.forEach((b) => console.log('   ' + b)); process.exit(1); }
console.log(`\n✅ 无重叠、无越界、无空洞（${occ.size}/${board} 格全占）`);
console.log('   指纹: ' + items.map((t) => `${t.id}[${t.x},${t.y},${t.w}x${t.h}]`).join(' '));
