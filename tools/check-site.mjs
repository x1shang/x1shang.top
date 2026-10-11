// 上线前体检：语法 + 本地引用是否都存在
//   node x1shang/tools/check-site.mjs               # 检查工作区里的导航页仓库（../../site）
//   node x1shang/tools/check-site.mjs path/to/page.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAV_SITE = path.join(HERE, '..', '..', 'site');
const SITE = path.resolve(process.argv[2] ? path.dirname(process.argv[2]) : (process.env.SITE_DIR ?? NAV_SITE));
const targets = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : ['index.html', '404.html', 'sorting/index.html', 'lujiazui/index.html', 'threebody/index.html']
      .map((p) => path.join(SITE, p))
      .filter((p) => fs.existsSync(p));

let bad = 0;
for (const file of targets) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(process.cwd(), file);
  console.log('\n■ ' + rel + '  (' + (html.length / 1024).toFixed(1) + ' KB)');

  // 1) 内联 script 语法
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  blocks.forEach((code, i) => {
    try { new Function(code); console.log(`  ✓ script#${i + 1} 语法通过`); }
    catch (e) { bad++; console.log(`  ✗ script#${i + 1} 语法错误: ${e.message}`); }
  });

  // 2) 本地引用（跳过 http(s)/data:/mailto:/#/纯锚点）
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const r = m[1];
    if (/^(https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i.test(r)) continue;
    refs.add(r.split(/[?#]/)[0]);
  }
  for (const r of refs) {
    if (!r) continue;
    const base = path.dirname(file);
    const full = path.resolve(base, r);
    const ok = fs.existsSync(full) || fs.existsSync(path.join(full, 'index.html'));
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${r}`);
  }
}

console.log(bad === 0 ? '\n✅ 全部通过' : `\n❌ 有 ${bad} 处问题`);
process.exit(bad === 0 ? 0 : 1);
