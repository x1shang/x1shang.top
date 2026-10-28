/*!
 * render.js — x1shang 个人站的「浏览器零依赖渲染器」
 * ---------------------------------------------------------------------------
 * 纯字符串实现，无构建、无依赖：
 *   Render.escape(s)            HTML 转义
 *   Render.md(src[, opts])      Markdown(GFM 子集) → HTML；opts.rawHtml===false 时把 HTML 当纯文本
 *   Render.sanitizeHtml(html)   原始 HTML 白名单清洗（删 script/style/iframe/…、on*= 事件、javascript: 链接）
 *   Render.renderFile({format, body})  按格式分发：md/markdown、html/htm、tex/latex、txt（未知按 txt）
 *                                      tex 会先做 LaTeX→HTML 结构转换（章节/字体/列表/引用/居中/
 *                                      图 figure+includegraphics、表 tabular、文献 thebibliography），
 *                                      数学片段原样保留交给 Render.math（KaTeX）
 *   Render.math(root)           异步懒加载 KaTeX 渲染 root 内 .math-inline/.math-block；失败加 .math-fallback
 *                               CDN 依次尝试 jsdelivr → unpkg → bootcdn（各 3s 超时，CSS/JS 同源）
 *
 * 数学占位方案：扫描阶段就把 $…$ / $$…$$ / \(…\) / \[…\] 整段抽成 \u0000F<idx>\u0000 不可见占位符，
 * 原文（含定界符）转义后存进片段表，因此后续的转义/强调/链接替换永远碰不到 TeX，最后一步再统一还原。
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  /* ========================= 0. 常量与基础工具 ========================= */

  const KATEX_VERSION = '0.16.11';
  const KATEX_TIMEOUT = 3000;    // 每个 CDN 的尝试上限（毫秒）
  // 依次尝试；同一轮里 CSS 与 JS 取自同一个 CDN，保证字体路径/版本一致
  const KATEX_CDNS = [
    {
      name: 'jsdelivr',
      css: 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.css',
      js: 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VERSION + '/dist/katex.min.js'
    },
    {
      name: 'unpkg',
      css: 'https://unpkg.com/katex@' + KATEX_VERSION + '/dist/katex.min.css',
      js: 'https://unpkg.com/katex@' + KATEX_VERSION + '/dist/katex.min.js'
    },
    {
      name: 'bootcdn',
      css: 'https://cdn.bootcdn.net/ajax/libs/KaTeX/' + KATEX_VERSION + '/katex.min.css',
      js: 'https://cdn.bootcdn.net/ajax/libs/KaTeX/' + KATEX_VERSION + '/katex.min.js'
    }
  ];

  const NUL = '\u0000';          // 片段占位符包裹字符（输入里的 NUL 会先被剥掉）
  const BR = '\u0001';           // 硬换行内部标记（同样是生成出来的，输入里不存在）
  const FRAG_ONE = /^\u0000F(\d+)\u0000$/;

  const ESC_ALL = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const ESC_TEXT = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

  /** HTML 全量转义（& < > " '） */
  function escape(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_ALL[c]); }
  /** 文本节点转义（正文里 " 无害，留给属性侧单独处理，避免二次转义） */
  function escapeText(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ESC_TEXT[c]); }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }
  function str(v) { return v == null ? '' : String(v); }

  /* ========================= 1. HTML 白名单清洗 ========================= */

  const ALLOWED_TAGS = new Set(('a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup '
    + 'dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd '
    + 'li main mark nav ol p picture pre q rp rt ruby s samp section small span strong sub summary sup table tbody '
    + 'td tfoot th thead time tr u ul var wbr video audio source track canvas svg math semantics mrow mi mn mo ms '
    + 'mtext mspace mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover '
    + 'munderover mtable mtr mtd maction').split(' '));
  const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  // 这些元素的「内容」也一并丢弃：保留会把脚本源码当正文显示出来
  const DROP_CONTENT = new Set('script style xmp textarea title noscript template iframe object embed link meta base'.split(' '));
  const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'cite', 'background', 'longdesc', 'data', 'ping']);
  const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp', 'ftps', 'irc', 'ircs', 'news', 'nntp', 'sms', 'callto', 'magnet', 'geo', 'xmpp', 'webcal']);

  /** 解码实体后再判协议，防止 &#106;avascript: / &colon; 之类绕过 */
  function decodeForCheck(v) {
    return str(v)
      .replace(/&#x([0-9a-f]+);?/gi, (m, h) => { const n = parseInt(h, 16); return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
      .replace(/&#(\d+);?/g, (m, d) => { const n = Number(d); return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
      .replace(/&(colon|tab|newline|sol|quest|num|percnt|ast|excl|nbsp);/gi, (m, n) => ({
        colon: ':', tab: '\t', newline: '\n', sol: '/', quest: '?', num: '#', percnt: '%', ast: '*', excl: '!', nbsp: ' '
      })[n.toLowerCase()] || '');
  }

  /** URL 协议白名单：相对路径/#锚点放行，未知协议与 javascript: 一律降级为 '#' */
  function safeUrl(raw) {
    const s = str(raw).trim();
    if (!s) return '';
    const probe = decodeForCheck(s).replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
    const m = /^([a-z][a-z0-9+.\-]*):/.exec(probe);
    if (!m) return s;
    const scheme = m[1];
    if (scheme === 'data') return /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml);/i.test(probe) ? s : '#';
    if (scheme === 'javascript' || scheme === 'vbscript') return '#';
    return SAFE_SCHEMES.has(scheme) ? s : '#';
  }

  /** 从 from 处找到标签的 '>'（跳过引号内的 >）；找不到返回 -1 */
  function findTagEnd(s, from) {
    let quote = '';
    for (let i = from; i < s.length; i++) {
      const c = s[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') return i;
    }
    return -1;
  }

  /** 解析标签内部属性串（手写扫描，避免正则回溯） */
  function parseAttrs(inner) {
    const attrs = [];
    let i = 0;
    while (i < inner.length) {
      while (i < inner.length && /\s/.test(inner[i])) i++;
      if (i >= inner.length) break;
      if (inner[i] === '/') { i++; continue; }
      const from = i;
      while (i < inner.length && !/[\s=/>]/.test(inner[i])) i++;
      const name = inner.slice(from, i);
      if (!name) { i++; continue; }
      while (i < inner.length && /\s/.test(inner[i])) i++;
      let value = null;
      if (inner[i] === '=') {
        i++;
        while (i < inner.length && /\s/.test(inner[i])) i++;
        const quote = inner[i];
        if (quote === '"' || quote === "'") {
          i++;
          const start = i;
          while (i < inner.length && inner[i] !== quote) i++;
          value = inner.slice(start, i);
          if (inner[i] === quote) i++;
        } else {
          const start = i;
          while (i < inner.length && !/[\s>]/.test(inner[i])) i++;
          value = inner.slice(start, i);
        }
      }
      attrs.push([name, value]);
    }
    return attrs;
  }

  /** 过滤后的属性串 */
  function renderAttrs(attrs) {
    let out = '';
    for (const pair of attrs) {
      const name = str(pair[0]);
      if (!/^[a-zA-Z_:][a-zA-Z0-9_:.\-]*$/.test(name)) continue;
      const lower = name.toLowerCase();
      if (lower.slice(0, 2) === 'on') continue;            // on* 事件属性一律删除
      if (lower === 'srcdoc' || lower === 'http-equiv') continue;
      let value = pair[1];
      if (value == null) { out += ' ' + name; continue; }
      if (/javascript\s*:/i.test(decodeForCheck(value))) continue;   // 任意属性里的 javascript: 都删掉
      if (URL_ATTRS.has(lower)) value = safeUrl(value);
      out += ' ' + name + '="' + escapeAttr(value) + '"';
    }
    return out;
  }

  /** 找 </name ...> 结束位置（返回 '>' 之后的下标），找不到返回 -1 */
  function indexOfCloseTag(s, name, from) {
    const re = new RegExp('</' + name + '(?=[\\s>])', 'ig');
    re.lastIndex = from;
    const m = re.exec(s);
    if (!m) return -1;
    const gt = s.indexOf('>', m.index);
    return gt < 0 ? -1 : gt + 1;
  }

  /** 原始 HTML 白名单清洗（可被外部直接调用） */
  function sanitizeHtml(html) {
    const s = str(html);
    let out = '';
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { out += s.slice(i); break; }
      out += s.slice(i, lt);
      if (s.startsWith('<!--', lt)) {                       // 注释整段丢弃
        const end = s.indexOf('-->', lt + 4);
        if (end < 0) break;
        i = end + 3;
        continue;
      }
      if (s.startsWith('<!', lt) || s.startsWith('<?', lt)) {   // doctype / 处理指令丢弃
        const end = s.indexOf('>', lt);
        if (end < 0) break;
        i = end + 1;
        continue;
      }
      const close = /^<\/([a-zA-Z][a-zA-Z0-9:_-]*)\s*>/.exec(s.slice(lt, lt + 96));
      if (close) {
        const name = close[1].toLowerCase();
        if (ALLOWED_TAGS.has(name)) out += '</' + name + '>';
        i = lt + close[0].length;
        continue;
      }
      const open = /^<([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(s.slice(lt, lt + 96));
      if (!open) { out += '&lt;'; i = lt + 1; continue; }
      const name = open[1].toLowerCase();
      const end = findTagEnd(s, lt + open[0].length);
      if (end < 0) { out += '&lt;'; i = lt + 1; continue; }
      const inner = s.slice(lt + open[0].length, end);
      i = end + 1;
      if (DROP_CONTENT.has(name) && !ALLOWED_TAGS.has(name)) {    // script/style/…：标签与内容一起丢
        const closeAt = indexOfCloseTag(s, name, i);
        i = closeAt < 0 ? s.length : closeAt;
        continue;
      }
      if (!ALLOWED_TAGS.has(name)) continue;                      // 其余非法标签：只丢标签，保留内部文本
      out += '<' + name + renderAttrs(parseAttrs(inner)) + '>';
    }
    return out;
  }

  /* ========================= 2. 行内解析 ========================= */

  /** 往片段表放一段最终 HTML，返回不可见占位符 */
  function frag(ctx, html, block) {
    ctx.frag.push(html);
    ctx.isBlock.push(!!block);
    return NUL + 'F' + (ctx.frag.length - 1) + NUL;
  }

  /** 还原占位符：片段里可能又嵌了占位符（如链接文字里的行内代码/公式），所以多轮展开 */
  function restore(html, ctx) {
    if (html.indexOf(NUL) < 0) return html;
    let out = html;
    for (let round = 0; round < 8 && out.indexOf(NUL) >= 0; round++) {
      out = out.replace(/\u0000F(\d+)\u0000/g, (m, d) => {
        const v = ctx.frag[Number(d)];
        return v == null ? '' : v;
      });
    }
    return out;
  }

  const STRIP_TOKENS = /\u0000F\d+\u0000/g;

  function linkTag(href, text, title) {
    const url = safeUrl(href) || '#';
    const external = /^(?:https?:)?\/\//i.test(str(href).trim());
    return '<a href="' + escapeAttr(url) + '"'
      + (title ? ' title="' + escapeAttr(title) + '"' : '')
      + (external ? ' target="_blank" rel="noopener noreferrer"' : '')
      + '>' + text + '</a>';
  }

  /** 行内代码 `code`（等长反引号配对，未闭合则原样保留） */
  function extractCode(s, ctx) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] !== '`') { out += s[i]; i++; continue; }
      let run = 1;
      while (s[i + run] === '`') run++;
      let found = -1;
      let j = i + run;
      while (j < s.length) {
        if (s[j] === '`') {
          let m = 1;
          while (s[j + m] === '`') m++;
          if (m === run) { found = j; break; }
          j += m;
          continue;
        }
        j++;
      }
      if (found < 0) { out += s.slice(i, i + run); i += run; continue; }
      let code = s.slice(i + run, found).replace(/\n/g, ' ');
      if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1);
      out += frag(ctx, '<code>' + escape(code) + '</code>');
      i = found + run;
    }
    return out;
  }

  /** 行内原始 HTML 标签：逐个过白名单清洗后占位（裸 < 也占位，避免被二次转义） */
  function extractInlineHtml(s, ctx) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { out += s.slice(i); break; }
      out += s.slice(i, lt);
      if (s.startsWith('<!--', lt)) {
        const end = s.indexOf('-->', lt + 4);
        i = end < 0 ? s.length : end + 3;
        continue;
      }
      const head = /^<\/?[a-zA-Z][a-zA-Z0-9:_-]*/.exec(s.slice(lt, lt + 64));
      const end = head ? findTagEnd(s, lt + head[0].length) : -1;
      if (!head || end < 0 || end - lt > 2000) { out += frag(ctx, '&lt;'); i = lt + 1; continue; }
      const tag = s.slice(lt, end + 1);
      out += tag.indexOf('>') < 0 ? frag(ctx, '&lt;') : frag(ctx, sanitizeHtml(tag));
      i = end + 1;
    }
    return out;
  }

  /** 标签结束位置（] 之前不允许换行/嵌套 [） */
  function findLabelEnd(s, from) {
    for (let i = from; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === ']') return i;
      if (c === '\n' || c === '[') return -1;
    }
    return -1;
  }

  /** 从 '(' 开始找到配对的 ')'（含少量嵌套容错） */
  function matchParen(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '(') { depth++; if (depth > 8) return -1; }
      else if (c === ')') { depth--; if (depth === 0) return i; }
      else if (c === '\n') return -1;
    }
    return -1;
  }

  function unquote(t) {
    const s = str(t).trim();
    if (s.length < 2) return '';
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '(' && b === ')')) return s.slice(1, -1);
    return '';
  }

  /** 拆 [t](dest "title") 里的 dest 与 title */
  function splitDest(inner) {
    const s = str(inner).trim();
    let m = /^<([^<>\n]*)>(?:\s+("[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*$/.exec(s);
    if (m) return { dest: m[1], title: unquote(m[2]) };
    m = /^(\S+)(?:\s+("[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*$/.exec(s);
    if (m) return { dest: m[1], title: unquote(m[2]) };
    return { dest: s, title: '' };
  }

  /** 图片：alt 只要纯文本，所以在转义/强调之前先摘出来 */
  function extractImages(s, ctx) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (!(s[i] === '!' && s[i + 1] === '[')) { out += s[i]; i++; continue; }
      const close = findLabelEnd(s, i + 2);
      if (close < 0 || s[close + 1] !== '(') { out += s[i]; i++; continue; }
      const end = matchParen(s, close + 1);
      if (end < 0) { out += s[i]; i++; continue; }
      const alt = s.slice(i + 2, close).replace(STRIP_TOKENS, '').replace(/[*_~`]/g, '');
      const spec = splitDest(s.slice(close + 2, end));
      out += frag(ctx, '<img src="' + escapeAttr(safeUrl(spec.dest)) + '" alt="' + escapeAttr(escape(alt)) + '"'
        + (spec.title ? ' title="' + escapeAttr(spec.title) + '"' : '') + ' loading="lazy">');
      i = end + 1;
    }
    return out;
  }

  /** 链接（转义之后扫描，标签文本里可以已含强调/代码占位符） */
  function extractLinks(s, ctx) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] !== '[' || (i > 0 && s[i - 1] === '!')) { out += s[i]; i++; continue; }
      const close = findLabelEnd(s, i + 1);
      if (close < 0 || s[close + 1] !== '(') { out += s[i]; i++; continue; }
      const end = matchParen(s, close + 1);
      if (end < 0) { out += s[i]; i++; continue; }
      const label = s.slice(i + 1, close);
      const spec = splitDest(s.slice(close + 2, end));
      out += frag(ctx, linkTag(spec.dest, label, spec.title));
      i = end + 1;
    }
    return out;
  }

  /** 裸 URL / www. 自动链接 */
  function bareUrls(s, ctx) {
    return s.replace(/(^|[\s(（\[【"'`])((?:https?:\/\/|www\.)[^\s<>"'`）】\]]+)/g, (m, pre, url) => {
      const core = url.replace(/[.,;:!?、。]+$/, '');
      if (!core) return m;
      const tail = url.slice(core.length);
      const href = /^www\./i.test(core) ? 'http://' + core : core;
      return pre + frag(ctx, linkTag(href, core, '')) + tail;
    });
  }

  /** 行内渲染主流程：占位 → 转义 → 强调 → 链接 */
  function inline(text, ctx) {
    let s = str(text).split(BR).join(frag(ctx, '<br>'));
    s = extractCode(s, ctx);
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>~|$])/g, (m, c) => frag(ctx, escape(c)));
    s = s.replace(/<([a-zA-Z][a-zA-Z0-9+.\-]{1,31}:[^<>\s]*)>/g, (m, url) => frag(ctx, linkTag(url, escapeText(url), '')));
    if (ctx.rawHtml) s = extractInlineHtml(s, ctx);
    s = extractImages(s, ctx);
    s = escapeText(s);
    s = s.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '<strong><em>$2</em></strong>');
    s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    s = s.replace(/(?<![A-Za-z0-9_])_(?=\S)([^\n_]*?\S)_(?![A-Za-z0-9_])/g, '<em>$1</em>');
    s = s.replace(/\*(?=\S)([^\n*]*?\S)\*/g, '<em>$1</em>');
    s = extractLinks(s, ctx);
    s = bareUrls(s, ctx);
    return s;
  }

  /* ========================= 3. 块级解析 ========================= */

  const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
  const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
  const HTML_BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd '
    + 'details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header '
    + 'hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param pre script section source '
    + 'style summary table tbody td tfoot th thead title tr track ul video audio canvas svg math noscript template object '
    + 'embed meta').split(' '));

  function matchFence(line) {
    const m = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
    if (!m) return null;
    const info = m[2] || '';
    if (m[1][0] === '`' && info.indexOf('`') >= 0) return null;
    return { char: m[1][0], len: m[1].length, info: info.trim() };
  }

  function renderFence(fence, body) {
    const info = (fence.info || '').split(/\s+/)[0] || '';
    const lang = /^[A-Za-z0-9_+.#-]+$/.test(info) ? info : '';
    return '<pre><code' + (lang ? ' class="lang-' + escape(lang) + '"' : '') + '>' + escape(body) + '</code></pre>';
  }

  function indentOf(line) {
    const lead = /^[ \t]*/.exec(line)[0];
    return lead.replace(/\t/g, '    ').length;
  }

  function dedent(line, n) {
    let used = 0;
    let i = 0;
    while (i < line.length && used < n && (line[i] === ' ' || line[i] === '\t')) {
      used += line[i] === '\t' ? 4 : 1;
      i++;
    }
    return line.slice(i);
  }

  /** 块级 HTML 起始判定：返回标签名 / '!--' / '!' / '' */
  function htmlBlockName(line) {
    const m = /^ {0,3}<([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(line);
    if (m && HTML_BLOCK_TAGS.has(m[1].toLowerCase())) return m[1].toLowerCase();
    if (/^ {0,3}<!--/.test(line)) return '!--';
    if (/^ {0,3}<[!?]/.test(line)) return '!';
    return '';
  }

  function tagDepth(text, name) {
    const open = new RegExp('<' + name + '(?=[\\s/>])', 'gi');
    const close = new RegExp('</' + name + '\\s*>', 'gi');
    let o = 0;
    let c = 0;
    while (open.exec(text)) o++;
    while (close.exec(text)) c++;
    return o - c;
  }

  /** 原始 HTML 块的行范围（不含尾），非 HTML 块返回 -1 */
  function scanHtmlBlock(lines, i) {
    const name = htmlBlockName(lines[i]);
    if (!name) return -1;
    if (name === '!--') {
      for (let j = i; j < lines.length; j++) if (lines[j].indexOf('-->') >= 0) return j + 1;
      return lines.length;
    }
    if (name === '!') return i + 1;
    if (DROP_CONTENT.has(name) || name === 'pre') {          // 原始文本元素：到闭合标签为止
      let acc = '';
      for (let j = i; j < lines.length; j++) {
        acc += lines[j] + '\n';
        if (indexOfCloseTag(acc, name, 0) >= 0) return j + 1;
      }
      return lines.length;
    }
    let acc = '';
    for (let j = i; j < lines.length; j++) {
      acc += lines[j] + '\n';
      if (tagDepth(acc, name) <= 0) return j + 1;
      if (j + 1 >= lines.length || !lines[j + 1].trim()) return j + 1;
    }
    return lines.length;
  }

  function matchListMarker(line) {
    const m = /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/.exec(line);
    if (!m) return null;
    const indent = m[1].replace(/\t/g, '    ').length;
    const marker = m[2];
    const ordered = /^\d/.test(marker);
    const gap = m[3] ? m[3].replace(/\t/g, '    ').length : 1;
    return {
      indent: indent,
      marker: marker,
      ordered: ordered,
      delim: ordered ? marker.slice(-1) : marker,
      rest: m[4],
      contentIndent: indent + marker.length + gap
    };
  }

  function isDelimRow(line) {
    const t = str(line).trim();
    if (!t || t.indexOf('-') < 0) return false;
    if (!/^[|\-: \t]+$/.test(t)) return false;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.length > 0 && cells.every(c => /^[ \t]*:?-+:?[ \t]*$/.test(c));
  }

  function splitRow(line) {
    let t = str(line).trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|' && t.charAt(t.length - 2) !== '\\') t = t.slice(0, -1);
    const cells = [];
    let cur = '';
    let esc = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (esc) { cur += c; esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function alignAttr(cell) {
    const c = str(cell).trim();
    const left = c.charAt(0) === ':';
    const right = c.charAt(c.length - 1) === ':';
    if (left && right) return ' style="text-align:center"';
    if (right) return ' style="text-align:right"';
    if (left) return ' style="text-align:left"';
    return '';
  }

  function startsNewBlock(line, ctx) {
    return ATX.test(line) || HR.test(line) || !!matchFence(line)
      || /^ {0,3}>/.test(line) || (ctx.rawHtml && !!htmlBlockName(line));
  }

  /** 段落内的软/硬换行合并 */
  function joinLines(lines) {
    let out = '';
    for (let k = 0; k < lines.length; k++) {
      let L = lines[k];
      let hard = false;
      if (/[ \t]{2,}$/.test(L)) { hard = true; L = L.replace(/[ \t]+$/, ''); }
      else if (/\\$/.test(L)) { hard = true; L = L.slice(0, -1); }
      else L = L.replace(/[ \t]+$/, '');
      out += L;
      if (k < lines.length - 1) out += hard ? BR : ' ';
    }
    return out;
  }

  /** 列表：收集条目行 → 递归块解析 */
  function renderList(lines, ctx) {
    const first = matchListMarker(lines[0]);
    const ordered = first.ordered;
    const items = [];
    let cur = null;
    let loose = false;
    let j = 0;

    const sameKind = m => m.ordered === ordered && (ordered ? m.delim === first.delim : m.marker === first.marker);
    const continues = line => {
      const m = matchListMarker(line);
      if (m && m.indent <= first.indent && sameKind(m)) return true;
      return indentOf(line) >= first.contentIndent;
    };

    while (j < lines.length) {
      const line = lines[j];
      if (!line.trim()) {
        let k = j + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k >= lines.length || !continues(lines[k])) { j = k; break; }
        loose = true;
        if (cur) cur.push('');
        j = k;
        continue;
      }
      const m = matchListMarker(line);
      if (m && m.indent <= first.indent) {
        if (!sameKind(m)) break;
        if (cur) items.push(cur);
        cur = [m.rest];
        j++;
        continue;
      }
      if (!cur) break;
      if (indentOf(line) <= first.indent && startsNewBlock(line, ctx)) break;
      cur.push(dedent(line, first.contentIndent));
      j++;
    }
    if (cur) items.push(cur);

    const tag = ordered ? 'ol' : 'ul';
    const startNo = ordered ? (parseInt(first.marker, 10) || 1) : 1;
    const isTask = items.some(r => /^\[[ xX]\]([ \t]+|$)/.test(str(r[0])));
    let attr = ordered && startNo !== 1 ? ' start="' + startNo + '"' : '';
    if (isTask) attr += ' class="contains-task-list"';

    const lis = items.map(raw => {
      const body = raw.slice();
      const task = /^\[([ xX])\]([ \t]+|$)/.exec(str(body[0]));
      let box = '';
      if (task) {
        box = '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '> ';
        body[0] = str(body[0]).slice(task[0].length);
      }
      let html = renderBlocks(body, ctx).trim();
      if (!loose) html = html.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      return '<li' + (task ? ' class="task-list-item"' : '') + '>' + box + html + '</li>';
    });

    return { html: '<' + tag + attr + '>\n' + lis.join('\n') + '\n</' + tag + '>', next: j };
  }

  /** 块级渲染主入口 */
  function renderBlocks(lines, ctx) {
    const out = [];
    const n = lines.length;
    let i = 0;
    while (i < n) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      // 独立成块的数学占位符（$$…$$ / \[…\]）
      const bm = FRAG_ONE.exec(line.trim());
      if (bm && ctx.isBlock[Number(bm[1])]) { out.push(ctx.frag[Number(bm[1])]); i++; continue; }

      // 围栏代码块
      const fence = matchFence(line);
      if (fence) {
        let j = i + 1;
        let closed = false;
        while (j < n) {
          const f2 = matchFence(lines[j]);
          if (f2 && f2.char === fence.char && f2.len >= fence.len && !f2.info) { closed = true; break; }
          j++;
        }
        out.push(renderFence(fence, lines.slice(i + 1, j).join('\n')));
        i = closed ? j + 1 : j;
        continue;
      }

      // 块级原始 HTML（块内不再做 Markdown 解析）
      if (ctx.rawHtml) {
        const end = scanHtmlBlock(lines, i);
        if (end > i) {
          out.push(sanitizeHtml(lines.slice(i, end).join('\n')));
          i = end;
          continue;
        }
      }

      // ATX 标题
      const h = ATX.exec(line);
      if (h) {
        const lvl = h[1].length;
        const text = str(h[2]).replace(/\s*\{#[^}]*\}\s*$/, '').replace(/[ \t]+#+[ \t]*$/, '');
        out.push('<h' + lvl + '>' + inline(text, ctx) + '</h' + lvl + '>');
        i++;
        continue;
      }

      // 水平线
      if (HR.test(line)) { out.push('<hr>'); i++; continue; }

      // 引用（可嵌套）
      if (/^ {0,3}>/.test(line)) {
        const buf = [];
        while (i < n) {
          const m = /^ {0,3}>[ \t]?(.*)$/.exec(lines[i]);
          if (m) { buf.push(m[1]); i++; continue; }
          if (!lines[i].trim()) {
            let k = i + 1;
            while (k < n && !lines[k].trim()) k++;
            if (k < n && /^ {0,3}>/.test(lines[k])) { buf.push(''); i++; continue; }
          }
          break;
        }
        out.push('<blockquote>\n' + renderBlocks(buf, ctx) + '\n</blockquote>');
        continue;
      }

      // 表格
      if (line.indexOf('|') >= 0 && i + 1 < n && isDelimRow(lines[i + 1])) {
        const header = splitRow(line);
        const delim = splitRow(lines[i + 1]);
        if (header.length && header.length === delim.length) {
          const rows = [];
          let j = i + 2;
          while (j < n && lines[j].trim() && lines[j].indexOf('|') >= 0) {
            const cells = splitRow(lines[j]);
            while (cells.length < header.length) cells.push('');
            rows.push('<tr>' + cells.slice(0, header.length).map((c, k) =>
              '<td' + alignAttr(delim[k]) + '>' + inline(c, ctx) + '</td>').join('') + '</tr>');
            j++;
          }
          out.push('<table>\n<thead>\n<tr>' + header.map((c, k) =>
            '<th' + alignAttr(delim[k]) + '>' + inline(c, ctx) + '</th>').join('') + '</tr>\n</thead>\n'
            + (rows.length ? '<tbody>\n' + rows.join('\n') + '\n</tbody>\n' : '') + '</table>');
          i = j;
          continue;
        }
      }

      // 列表
      if (matchListMarker(line)) {
        const r = renderList(lines.slice(i), ctx);
        out.push(r.html);
        i += r.next > 0 ? r.next : 1;
        continue;
      }

      // 段落
      const buf = [line];
      i++;
      while (i < n) {
        const L = lines[i];
        if (!L.trim()) break;
        if (matchFence(L)) break;
        if (ctx.rawHtml && scanHtmlBlock(lines, i) > i) break;
        if (ATX.test(L) || HR.test(L) || /^ {0,3}>/.test(L) || matchListMarker(L)) break;
        const bm2 = FRAG_ONE.exec(L.trim());
        if (bm2 && ctx.isBlock[Number(bm2[1])]) break;
        if (L.indexOf('|') >= 0 && i + 1 < n && isDelimRow(lines[i + 1])) break;
        buf.push(L);
        i++;
      }
      out.push('<p>' + inline(joinLines(buf), ctx) + '</p>');
    }
    return out.join('\n');
  }

  /* ========================= 4. 数学抽离（占位符） ========================= */

  function runLen(s, i, ch) {
    let n = 0;
    while (s[i + n] === ch) n++;
    return n;
  }

  function findRun(s, from, ch, len) {
    let i = from;
    while (i < s.length) {
      if (s[i] === ch) {
        const m = runLen(s, i, ch);
        if (m === len) return i;
        i += m;
        continue;
      }
      i++;
    }
    return -1;
  }

  function findDollar(text, from, display) {
    const delim = display ? '$$' : '$';
    let i = from;
    while (i < text.length) {
      const at = text.indexOf(delim, i);
      if (at < 0) return -1;
      if (at > 0 && text[at - 1] === '\\') { i = at + 1; continue; }
      if (!display && text[at + 1] === '$') { i = at + 2; continue; }
      if (display && text[at + 2] === '$') { i = at + 3; continue; }
      return at;
    }
    return -1;
  }

  /** 公式是否独占若干整行（决定输出 div 还是 span）；引用符 `>` 与列表记号不算正文 */
  function isStandalone(text, start, end) {
    const before = text.slice(0, start);
    const after = text.slice(end);
    const cut = before.lastIndexOf('\n');
    const head = cut < 0 ? before : before.slice(cut + 1);
    const nl = after.indexOf('\n');
    const tail = nl < 0 ? after : after.slice(0, nl);
    const container = head.replace(/^[ \t]*(?:>[ \t]?)+/, '')
      .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/, '');
    return !container.trim() && !tail.trim();
  }

  function addMath(ctx, src, display, standalone) {
    const block = display && standalone;
    const html = (block ? '<div class="math-block">' : '<span class="math-inline">') + escape(src)
      + (block ? '</div>' : '</span>');
    return frag(ctx, html, block);
  }

  /** 扫描文本区，把数学片段抽成占位符（跳过行内代码，避免 `$x$` 被误抽） */
  function scanMath(text, ctx) {
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === '`') {
        const run = runLen(text, i, '`');
        const close = findRun(text, i + run, '`', run);
        if (close < 0) { out += text.slice(i); break; }
        out += text.slice(i, close + run);
        i = close + run;
        continue;
      }
      if (c === '\\' && (text[i + 1] === '(' || text[i + 1] === '[')) {
        const closer = text[i + 1] === '(' ? '\\)' : '\\]';
        const end = text.indexOf(closer, i + 2);
        if (end >= 0) {
          out += addMath(ctx, text.slice(i, end + 2), text[i + 1] === '[', isStandalone(text, i, end + 2));
          i = end + 2;
          continue;
        }
        out += c;
        i++;
        continue;
      }
      if (c === '$') {
        const display = text[i + 1] === '$';
        const delim = display ? '$$' : '$';
        const start = i + delim.length;
        if (!display && (start >= n || /\s/.test(text[start]))) { out += c; i++; continue; }
        const end = findDollar(text, start, display);
        if (end < 0) { out += c; i++; continue; }
        if (!display && end > start && /\s/.test(text[end - 1])) { out += c; i++; continue; }
        out += addMath(ctx, text.slice(i, end + delim.length), display, isStandalone(text, i, end + delim.length));
        i = end + delim.length;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  /** 先划出「围栏代码 / 原始 HTML 块 / 文本区」，文本区才做数学抽离 */
  function extractMath(lines, ctx) {
    const out = [];
    let i = 0;
    const n = lines.length;
    while (i < n) {
      const fence = matchFence(lines[i]);
      if (fence) {
        out.push(lines[i]);
        i++;
        while (i < n) {
          const f2 = matchFence(lines[i]);
          out.push(lines[i]);
          i++;
          if (f2 && f2.char === fence.char && f2.len >= fence.len && !f2.info) break;
        }
        continue;
      }
      if (ctx.rawHtml && htmlBlockName(lines[i])) {
        const end = scanHtmlBlock(lines, i);
        const stop = end > i ? end : i + 1;
        for (let k = i; k < stop; k++) out.push(lines[k]);
        i = stop;
        continue;
      }
      const buf = [];
      while (i < n && !matchFence(lines[i]) && !(ctx.rawHtml && htmlBlockName(lines[i]))) {
        buf.push(lines[i]);
        i++;
      }
      if (!buf.length) { out.push(lines[i]); i++; continue; }
      const replaced = scanMath(buf.join('\n'), ctx);
      const parts = replaced.split('\n');
      for (let k = 0; k < parts.length; k++) out.push(parts[k]);
    }
    return out;
  }

  /* ========================= 5. 对外：md ========================= */

  function md(src, opts) {
    const ctx = { rawHtml: !opts || opts.rawHtml !== false, frag: [], isBlock: [] };
    let text = str(src).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    const lines = extractMath(text.split('\n'), ctx);
    return restore(renderBlocks(lines, ctx), ctx).trim();
  }

  /* ========================= 6. 对外：renderFile ========================= */

  function stripTexComment(line) {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '\\') { out += c + str(line[i + 1]); i++; continue; }
      if (c === '%') break;
      out += c;
    }
    return out;
  }

  /* ============ 6b. tex/latex：先 LaTeX→HTML 结构转换，数学仍交给 KaTeX ============ */

  /** 单字符转义（\% \_ \& …）→ 字面字符 */
  const TEX_ESCAPES = {
    '%': '%', '_': '_', '&': '&', '#': '#', '$': '$', '{': '{', '}': '}', '~': '~', '^': '^',
    ' ': ' ', ',': ' ', ';': ' ', ':': ' ', '!': '', '-': '', '/': ''
  };

  /** 文档层命令（连同参数一起剥掉，不进正文） */
  const TEX_PREAMBLE_CMDS = ['documentclass', 'documentstyle', 'usepackage', 'title', 'author', 'date',
    'thanks', 'institute', 'subtitle', 'affil', 'affiliation', 'keywords', 'maketitle',
    // 排版类：正文里出现也只是版式设置，否则会被当成未知命令、把参数当正文印出来
    'graphicspath', 'geometry', 'hypersetup', 'captionsetup', 'pagestyle', 'thispagestyle',
    'setlength', 'renewcommand', 'newcommand'];

  /** 这些环境在 \begin{env} 之后还有「结构参数」（列格式 / 文献标签宽度），要从正文里跳过 */
  const TEX_ARG_ENVS = new Set(['tabular', 'tabular*', 'tabularx', 'longtable', 'array', 'thebibliography']);

  /** {..} 配平（跳过 \{ \}）；找不到闭合返回 -1 */
  function matchBrace(s, at) {
    let depth = 0;
    for (let i = at; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  /** 删除 \cmd[opt]{a}{b}… 整体（参数用花括号配平扫描） */
  function removeTexCommand(s, name) {
    const re = new RegExp('\\\\' + name + '(?![a-zA-Z])', 'g');
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      let i = m.index + m[0].length;
      let k = i;
      while (k < s.length && /[ \t\n]/.test(s[k])) k++;
      if (s[k] === '[') {
        const close = s.indexOf(']', k);
        if (close > 0) { i = close + 1; k = i; }
      }
      for (;;) {
        let t = i;
        while (t < s.length && /[ \t\n]/.test(s[t])) t++;
        if (s[t] !== '{') break;
        const e = matchBrace(s, t);
        if (e < 0) break;
        i = e + 1;
      }
      out += s.slice(last, m.index);
      last = i;
    }
    out += s.slice(last);
    return out;
  }

  /** 读一个命令：名字 / [opt] / 若干 {arg}（最多 4 个，防病态输入） */
  function peekTexCommand(s, i) {
    const m = /^\\([a-zA-Z]+)\*?/.exec(s.slice(i, i + 48));
    if (!m) return null;
    const star = m[0].charAt(m[0].length - 1) === '*';
    let j = i + m[0].length;
    let opt = null;
    let k = j;
    while (k < s.length && /[ \t\n]/.test(s[k])) k++;
    if (s[k] === '[') {
      const close = s.indexOf(']', k);
      if (close > 0) { opt = s.slice(k + 1, close); j = close + 1; }
    }
    const args = [];
    const spans = [];
    for (;;) {
      let t = j;
      while (t < s.length && /[ \t\n]/.test(s[t])) t++;
      if (s[t] !== '{') break;
      const e = matchBrace(s, t);
      if (e < 0) break;
      args.push(s.slice(t + 1, e));
      spans.push([t, e]);
      j = e + 1;
      if (args.length >= 4) break;
    }
    return { name: m[1], star: star, opt: opt, args: args, spans: spans, next: j };
  }

  /** 命令 → HTML；decl:true 表示声明式（\bfseries 之类），闭合标签由所在层收尾 */
  function texCommand(cmd) {
    const name = cmd.name;
    const arg = n => (cmd.args[n] != null ? texInline(cmd.args[n]) : '');
    switch (name) {
      case 'textbf': case 'bf': return { html: '<strong>' + arg(0) + '</strong>' };
      case 'emph': case 'textit': case 'it': case 'sl': return { html: '<em>' + arg(0) + '</em>' };
      case 'texttt': return { html: '<code>' + arg(0) + '</code>' };
      case 'underline': return { html: '<u>' + arg(0) + '</u>' };
      case 'bfseries': return { html: '<strong>', close: '</strong>', decl: true };
      case 'itshape': case 'em': case 'slshape': return { html: '<em>', close: '</em>', decl: true };
      case 'ttfamily': return { html: '<code>', close: '</code>', decl: true };
      case 'textsc': case 'textsf': case 'textrm': case 'textnormal': case 'textup': case 'mbox':
      case 'hbox': case 'ensuremath': return { html: arg(0) };
      case 'textsuperscript': return { html: '<sup>' + arg(0) + '</sup>' };
      case 'textsubscript': return { html: '<sub>' + arg(0) + '</sub>' };
      case 'caption': return { html: '<figcaption>' + arg(0) + '</figcaption>' };
      case 'footnote': return { html: '<span class="tex-footnote">（' + arg(0) + '）</span>' };
      case 'cite': case 'citep': case 'citet': case 'autocite': case 'parencite': case 'textcite':
        return { html: '<span class="tex-cite">[' + escape(str(cmd.args[0]).trim()) + ']</span>' };
      case 'href': return {
        html: '<a href="' + escapeAttr(safeUrl(str(cmd.args[0]).trim())) + '" target="_blank" rel="noopener noreferrer">'
          + (cmd.args[1] != null ? texInline(cmd.args[1]) : escape(str(cmd.args[0]).trim())) + '</a>'
      };
      case 'url': return {
        html: '<a href="' + escapeAttr(safeUrl(str(cmd.args[0]).trim())) + '" target="_blank" rel="noopener noreferrer">'
          + escape(str(cmd.args[0]).trim()) + '</a>'
      };
      case 'textcolor': case 'colorbox': case 'fcolorbox': case 'fbox': case 'framebox': case 'makebox':
      case 'parbox': case 'resizebox': case 'scalebox': case 'raisebox': case 'rotatebox':
        return { html: arg(cmd.args.length - 1) };                       // 取最后一个参数作为正文
      case 'label': case 'index': case 'bibliography': case 'bibliographystyle':
      case 'addcontentsline': case 'pageref': case 'eqref': case 'ref':
        return { html: '' };                                            // 结构性参数，不显示为正文
      /* 插图：宽度等选项忽略（交给 CSS 自适应），路径按站点根解析 */
      case 'includegraphics': {
        const src = str(cmd.args[0]).trim();
        if (!src) return { html: '' };
        const alt = src.split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '');
        return {
          html: '<img src="' + escape(safeUrl(src)) + '" alt="' + escape(alt)
            + '" loading="lazy" decoding="async">'
        };
      }
      case 'multicolumn': return { html: arg(2) };                      // {列数}{对齐}{正文}
      case 'item': case 'begin': case 'end': case 'maketitle':
      case 'vspace': case 'hspace': case 'vskip': case 'hskip':
        return { html: '' };
      /* 版式微调命令本身不出字，但它后面若紧跟一个花括号分组，那是「内容」不是参数：
         \smallskip{注：…} 里的注文必须留下来（peekTexCommand 会把它当参数吃掉）。 */
      case 'noindent': case 'centering': case 'hfill': case 'smallskip':
      case 'medskip': case 'bigskip': case 'clearpage': case 'pagebreak':
        return { html: cmd.args.map(a => texInline(a)).join('') };
      case 'newline': case 'linebreak': case 'newpage':
        return { html: '<br>' };
      case 'ldots': case 'dots': case 'textellipsis': return { html: '…' };
      case 'LaTeX': return { html: 'LaTeX' };
      case 'TeX': return { html: 'TeX' };
      case 'copyright': return { html: '©' };
      case 'textbackslash': return { html: '\\' };
      case 'textasciitilde': return { html: '~' };
      case 'textasciicircum': return { html: '^' };
      case 'quad': return { html: '  ' };
      case 'qquad': return { html: '    ' };
      default:
        // 未知命令：删掉命令名，保留参数文本（\foo{bar} → bar，\foo → 空）
        return { html: cmd.args.map(a => texInline(a)).join('') };
    }
  }

  /** 行内层：文本转义 + 命令转换；数学占位符原样穿过 */
  function texInline(s) {
    let out = '';
    const pending = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        const next = s[i + 1];
        if (next == null) { i++; continue; }                              // 结尾孤立反斜杠
        if (next === '\\') { out += '<br>'; i += 2; continue; }           // \\ 换行
        const cmd = peekTexCommand(s, i);
        if (!cmd) {
          const mapped = TEX_ESCAPES[next];
          out += escape(mapped != null ? mapped : next);
          i += 2;
          continue;
        }
        const info = texCommand(cmd);
        out += info.html;
        if (info.decl) pending.push(info.close);
        i = cmd.next;
        // TeX 会吃掉控制词后面的空格（{\bfseries X} 得到 <strong>X</strong>）
        if (!cmd.args.length && cmd.opt == null) {
          while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
        }
        continue;
      }
      if (c === '{') {                                                    // 分组：子层自己闭合声明
        const end = matchBrace(s, i);
        if (end < 0) { i++; continue; }
        out += texInline(s.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      if (c === '}') { i++; continue; }
      if (c === '-') {                                                   // TeX 的 -- → –、--- → —
        if (s[i + 1] === '-' && s[i + 2] === '-') { out += '—'; i += 3; continue; }
        if (s[i + 1] === '-') { out += '–'; i += 2; continue; }
        out += '-';
        i++;
        continue;
      }
      if (c === '~') { out += '&nbsp;'; i++; continue; }
      if (c === '\n') { out += ' '; i++; continue; }
      out += escape(c);
      i++;
    }
    while (pending.length) out += pending.pop();
    return out;
  }

  /** 单个 <p> 包裹时去掉外壳（列表项用） */
  function unwrapTexP(html) {
    const h = str(html).trim();
    if (h.slice(0, 3) === '<p>' && h.slice(-4) === '</p>' && h.indexOf('<p>', 3) < 0) return h.slice(3, -4);
    return h;
  }

  /** 按顶层 \item 切分列表体 */
  function splitTexItems(body) {
    const items = [];
    let depth = 0;
    let envDepth = 0;
    let start = -1;
    let i = 0;
    while (i < body.length) {
      const c = body[i];
      if (c === '\\') {
        const env = /^\\(begin|end)\{([a-zA-Z*]+)\}/.exec(body.slice(i, i + 40));
        if (env) { envDepth += env[1] === 'begin' ? 1 : -1; i += env[0].length; continue; }
        const it = /^\\item(?![a-zA-Z])/.exec(body.slice(i, i + 8));
        if (it && depth === 0 && envDepth === 0) {
          if (start >= 0) items.push(body.slice(start, i));
          i += it[0].length;
          let k = i;
          while (k < body.length && /[ \t]/.test(body[k])) k++;
          if (body[k] === '[') {                                          // \item[标签]：标签并入正文
            const close = body.indexOf(']', k);
            if (close > 0) i = k;                                         // 保留 [标签] 交给行内转换
          }
          start = i;
          continue;
        }
        i += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      i++;
    }
    if (start >= 0) items.push(body.slice(start));
    else if (body.trim()) items.push(body);
    return items;
  }

  /** tabular：按顶层 \\ 切行、顶层 & 切列；顶线/中线/底线只当「表头到此为止」的信号 */
  function renderTexTable(body, ctx) {
    const RULE = /\\(?:toprule|midrule|bottomrule|hline|addlinespace|cline|cmidrule)(?:\s*\([^)]*\))?(?:\s*\{[^}]*\})?/g;
    const rows = [];
    let cells = [];
    let buf = '';
    let depth = 0;
    const endRow = () => { cells.push(buf); rows.push(cells); cells = []; buf = ''; };
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '\\') {
        if (body[i + 1] === '\\') {
          if (depth === 0) {
            i++;
            let k = i + 1;
            while (k < body.length && /\s/.test(body[k])) k++;
            if (body[k] === '[') { const e = body.indexOf(']', k); if (e > 0) i = e; }   // \\[2pt]
            endRow();
            continue;
          }
          buf += '\\\\';
          i++;
          continue;
        }
        buf += c;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      if (c === '&' && depth === 0) { cells.push(buf); buf = ''; continue; }
      buf += c;
    }
    if (buf.trim() || cells.length) endRow();

    const mid = rows.findIndex(raw => /\\midrule/.test(raw.join(' ')));
    const split = mid < 0 ? 0 : mid;                                    // \midrule 所在行已是数据行
    const clean = rows.map(raw => raw.map(c => c.replace(RULE, ' ').trim()));
    const hasCell = row => row.some(c => c);
    const rowHtml = (row, tag) => '<tr>'
      + row.map(c => '<' + tag + '>' + texInline(c) + '</' + tag + '>').join('') + '</tr>';
    const head = clean.slice(0, split).filter(hasCell);
    const data = clean.slice(split).filter(hasCell);
    let html = '<div class="table-scroll"><table>';
    if (head.length) html += '<thead>' + head.map(r => rowHtml(r, 'th')).join('') + '</thead>';
    html += '<tbody>' + data.map(r => rowHtml(r, 'td')).join('') + '</tbody></table></div>';
    return html;
  }

  /** 渲染 \begin{env}…\end{env}，返回「已消费到 \end 之后」的下标 */
  function renderTexEnv(s, start, cmd, out, ctx) {
    const env = str(cmd.args[0]).trim();
    const openTok = '\\begin{' + env + '}';
    const closeTok = '\\end{' + env + '}';
    // 可选参数（\begin{table}[htbp]）与 tabular 的列格式、thebibliography 的标签宽度都在
    // \begin{env} 之后，属于结构参数，要从正文里跳过
    let from = start + openTok.length;
    if (TEX_ARG_ENVS.has(env) && cmd.next > start) from = Math.max(from, cmd.next);
    {                                                                   // 环境名后面的 [htbp] / [t]
      let k = from;
      while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++;
      if (s[k] === '[') {
        const close = s.indexOf(']', k);
        if (close > k && close - k < 40) from = close + 1;
      }
    }
    let depth = 0;
    let i = from;
    let bodyEnd = s.length;
    let end = s.length;
    while (i < s.length) {
      const no = s.indexOf(openTok, i);
      const nc = s.indexOf(closeTok, i);
      if (nc < 0) break;                                                  // 未闭合：吃到结尾
      if (no >= 0 && no < nc) { depth++; i = no + openTok.length; continue; }
      if (depth === 0) { bodyEnd = nc; end = nc + closeTok.length; break; }
      depth--;
      i = nc + closeTok.length;
    }
    const body = s.slice(from, bodyEnd);
    if (env === 'itemize' || env === 'enumerate' || env === 'description') {
      const tag = env === 'enumerate' ? 'ol' : 'ul';
      const items = splitTexItems(body).map(it => '<li>' + unwrapTexP(texBlocks(it, ctx)) + '</li>');
      out.push('<' + tag + '>\n' + items.join('\n') + '\n</' + tag + '>');
    } else if (env === 'quote' || env === 'quotation' || env === 'displayquote') {
      out.push('<blockquote>\n' + texBlocks(body, ctx) + '\n</blockquote>');
    } else if (env === 'center') {
      out.push('<div class="tex-center">\n' + texBlocks(body, ctx) + '\n</div>');
    } else if (env === 'verbatim' || env === 'lstlisting' || env === 'minted') {
      out.push('<pre><code>' + escape(body.replace(/^\n+/, '').replace(/\n+$/, '')) + '</code></pre>');
    } else if (env === 'figure' || env === 'figure*' || env === 'table' || env === 'table*') {
      // 图/表环境：内部照常排版，只把「独占一段的 caption」提到 figure 顶层（<p> 里不能放 figcaption）
      const inner = texBlocks(body, ctx)
        .replace(/<p>\s*(<figcaption>[\s\S]*?<\/figcaption>)\s*<\/p>/g, '$1');
      out.push('<figure>\n' + inner + '\n</figure>');
    } else if (env === 'tabular' || env === 'tabular*' || env === 'tabularx'
      || env === 'longtable' || env === 'array') {
      out.push(renderTexTable(body, ctx));
    } else if (env === 'thebibliography') {
      const items = splitTexItems(body.replace(/\\bibitem(\[[^\]]*\])?\s*\{[^}]*\}/g, '\\item '))
        .map(it => '<li>' + unwrapTexP(texBlocks(it, ctx)) + '</li>');
      out.push('<ol class="tex-bib">\n' + items.join('\n') + '\n</ol>');
    } else {
      out.push(texBlocks(body, ctx));                                     // 其余环境：只留内部内容
    }
    return end;
  }

  /** 块级：空行分段、章节命令成标题、环境成块、块级公式不套 <p> */
  function texBlocks(s, ctx) {
    const out = [];
    let buf = '';
    const flush = () => {
      const text = buf.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
      buf = '';
      if (!text) return;
      const sole = FRAG_ONE.exec(text);
      if (sole && ctx.isBlock[Number(sole[1])]) { out.push(ctx.frag[Number(sole[1])]); return; }
      const html = texInline(text);
      if (!html.trim()) return;                                          // 整段只有 \centering / \label 之类的版式命令
      out.push('<p>' + html + '</p>');
    };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') {                                                   // 空行 → 段落分隔
        let j = i + 1;
        while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
        if (j >= s.length || s[j] === '\n') {
          flush();
          i = s[j] === '\n' ? j + 1 : j;
          continue;
        }
        buf += '\n';
        i++;
        continue;
      }
      if (c === NUL) {                                                    // 数学占位符
        const tm = /^\u0000F(\d+)\u0000/.exec(s.slice(i, i + 24));
        if (tm) {
          const idx = Number(tm[1]);
          if (ctx.isBlock[idx]) { flush(); out.push(ctx.frag[idx]); }
          else buf += tm[0];
          i += tm[0].length;
          continue;
        }
        i++;
        continue;
      }
      if (c === '\\') {
        const cmd = peekTexCommand(s, i);
        if (cmd) {
          if (cmd.name === 'begin' && cmd.args.length) { flush(); i = renderTexEnv(s, i, cmd, out, ctx); continue; }
          if (cmd.spans.length && (cmd.name === 'section' || cmd.name === 'subsection'
            || cmd.name === 'subsubsection' || cmd.name === 'paragraph')) {
            flush();
            const lvl = cmd.name === 'section' ? 2 : cmd.name === 'subsection' ? 3 : 4;
            out.push('<h' + lvl + '>' + texInline(s.slice(cmd.spans[0][0] + 1, cmd.spans[0][1])) + '</h' + lvl + '>');
            i = cmd.next;
            continue;
          }
          if (cmd.name === 'caption' && cmd.spans.length) {               // 图/表题：独立成块，不塞进 <p>
            flush();
            out.push('<figcaption>' + texInline(s.slice(cmd.spans[0][0] + 1, cmd.spans[0][1])) + '</figcaption>');
            i = cmd.next;
            continue;
          }
        }
        buf += c;
        i++;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
    return out.join('\n');
  }

  /** tex/latex：剥 preamble → 结构转换 → 数学占位符还原（交给 Render.math 渲染） */
  function texToHtml(body) {
    let s = str(body).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    s = s.split('\n').map(stripTexComment).join('\n');
    s = s.replace(/\\(begin|end)[ \t\n]*\{/g, '\\$1{');                   // 归一化 \begin {x} 空白
    s = s.replace(/\\begin\{document\}/g, '').replace(/\\end\{document\}/g, '');
    for (const name of TEX_PREAMBLE_CMDS) s = removeTexCommand(s, name);
    s = s.replace(/\\par(?![a-zA-Z])/g, '\n\n');
    if (!s.trim()) return '';
    const ctx = { rawHtml: true, frag: [], isBlock: [] };
    const guarded = scanMath(s, ctx);                                     // 数学先占位，转换器碰不到 TeX
    return restore(texBlocks(guarded, ctx).trim(), ctx);
  }

  /** txt：空行分段，段内换行原样保留（横向空白交给 CSS） */
  function txtToHtml(body) {
    const text = str(body).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
    if (!text.trim()) return '';
    return text.split(/\n[ \t]*\n+/)
      .map(chunk => '<p>' + escape(chunk.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')) + '</p>')
      .join('\n');
  }

  const FORMATS = { md: 'md', markdown: 'md', html: 'html', htm: 'html', tex: 'tex', latex: 'tex', txt: 'txt' };

  function renderFile(file, opts) {
    const f = file && typeof file === 'object' ? file : {};
    const format = str(f.format).trim().toLowerCase().replace(/^\./, '');
    const kind = FORMATS[format] || 'txt';
    const body = str(f.body);
    if (kind === 'md') return md(body, opts);
    if (kind === 'html') return sanitizeHtml(body);
    if (kind === 'tex') return texToHtml(body);
    return txtToHtml(body);
  }

  /* ========================= 7. 对外：math（KaTeX 懒加载 + 降级） ========================= */

  function stripDelims(tex) {
    const t = str(tex).trim();
    if (t.length >= 4 && t.slice(0, 2) === '$$' && t.slice(-2) === '$$') return t.slice(2, -2).trim();
    if (t.length >= 2 && t.charAt(0) === '$' && t.charAt(t.length - 1) === '$') return t.slice(1, -1).trim();
    if (t.length >= 4 && t.slice(0, 2) === '\\(' && t.slice(-2) === '\\)') return t.slice(2, -2).trim();
    if (t.length >= 4 && t.slice(0, 2) === '\\[' && t.slice(-2) === '\\]') return t.slice(2, -2).trim();
    return t;
  }

  function katexReady() {
    return root.katex && typeof root.katex.render === 'function' ? root.katex : null;
  }

  /** 只加载一次：依次尝试多个 CDN，每个 3s 超时；全部失败走 fallback，不反复请求。
   *  同一轮里 CSS 与 JS 取自同一个 CDN，避免版本/字体路径错配。 */
  function loadKatex() {
    if (root.__RenderKatexPromise) return root.__RenderKatexPromise;
    root.__RenderKatexPromise = new Promise(resolve => {
      const doc = root.document;
      if (!doc) { resolve(null); return; }
      const already = katexReady();
      if (already) { resolve(already); return; }

      let index = -1;
      let current = null;
      let stop = false;
      const cleanup = () => {                                   // 换源时撤掉上一个源，避免 CSS/JS 不同源
        if (!current) return;
        try { if (current.link && current.link.parentNode) current.link.parentNode.removeChild(current.link); } catch (e) { /* 忽略 */ }
        try { if (current.script && current.script.parentNode) current.script.parentNode.removeChild(current.script); } catch (e) { /* 忽略 */ }
        current = null;
      };
      // 页面自己引入的 KaTeX 后到也算成功
      const poll = setInterval(() => {
        const k = katexReady();
        if (k) { stop = true; clearInterval(poll); cleanup(); resolve(k); }
      }, 80);

      const next = () => {
        if (stop) return;
        index++;
        if (index >= KATEX_CDNS.length) { stop = true; clearInterval(poll); cleanup(); resolve(null); return; }
        const cdn = KATEX_CDNS[index];
        cleanup();
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = cdn.css;
        link.setAttribute('data-render-katex', cdn.name);
        (doc.head || doc.documentElement).appendChild(link);
        const script = doc.createElement('script');
        script.src = cdn.js;
        script.async = true;
        script.setAttribute('data-render-katex', cdn.name);
        current = { link: link, script: script };
        let done = false;
        const settle = () => {
          if (done || stop) return;
          done = true;
          clearTimeout(timer);
          const k = katexReady();
          if (k) { stop = true; clearInterval(poll); resolve(k); return; }   // 成功：保留这一源的 CSS+JS
          next();                                                            // 失败/超时：换下一个源
        };
        const timer = setTimeout(settle, KATEX_TIMEOUT);
        script.onload = settle;
        script.onerror = settle;
        (doc.body || doc.head || doc.documentElement).appendChild(script);
      };
      next();
    });
    return root.__RenderKatexPromise;
  }

  function collectMathNodes(scope) {
    const list = [];
    if (scope && scope.nodeType === 1 && scope.matches && scope.matches('.math-inline,.math-block')) list.push(scope);
    if (scope && typeof scope.querySelectorAll === 'function') {
      const found = scope.querySelectorAll('.math-inline,.math-block');
      for (let i = 0; i < found.length; i++) list.push(found[i]);
    }
    return list;
  }

  /** 渲染 root（缺省 document）内所有数学节点；重复调用安全 */
  function math(scope) {
    const doc = root.document;
    if (!doc) return Promise.resolve({ rendered: 0, fallback: 0, reason: 'no-dom' });
    const target = scope && typeof scope.querySelectorAll === 'function' ? scope : doc;
    const nodes = collectMathNodes(target);
    if (!nodes.length) return Promise.resolve({ rendered: 0, fallback: 0 });
    return loadKatex().then(katex => {
      if (!katex) {
        nodes.forEach(el => { if (el.classList) el.classList.add('math-fallback'); });
        return { rendered: 0, fallback: nodes.length, reason: 'katex-unavailable' };
      }
      let rendered = 0;
      nodes.forEach(el => {
        if (!el.classList || (el.dataset && el.dataset.mathDone)) return;
        const display = el.classList.contains('math-block');
        try {
          katex.render(stripDelims(el.textContent), el, { displayMode: display, throwOnError: false, strict: false, trust: false });
          el.classList.remove('math-fallback');
          el.classList.add('math-rendered');
          if (el.dataset) el.dataset.mathDone = '1';
          rendered++;
        } catch (err) {
          el.classList.add('math-fallback');      // 单点失败不影响其它节点，原文保留可见
        }
      });
      return { rendered: rendered, fallback: nodes.length - rendered };
    }).catch(() => {
      nodes.forEach(el => { if (el.classList) el.classList.add('math-fallback'); });
      return { rendered: 0, fallback: nodes.length, reason: 'error' };
    });
  }

  /* ========================= 8. 导出 ========================= */

  root.Render = {
    version: '1.0.0',
    escape: escape,
    md: md,
    math: math,
    sanitizeHtml: sanitizeHtml,
    renderFile: renderFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
