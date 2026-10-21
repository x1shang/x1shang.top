/* app.js — 纯静态站点：视图、检索、播放器
   内容 = content.auto.js（自动扫描 content/ 与 assets/）+ content.js（手工条目，同 id 优先）
   排序 = 先热度（front matter 的热力值 / 作品用 GitHub 星数快照）后时间
   检索 = 底部常驻命令行（全站含正文）
   阅读页 = 简约版式；索引页 = 仿 okmij.org Index 的自适应均衡分栏链接
   没有留言、点赞、友链申请：整站静态，互动层已移除。 */
(() => {
  'use strict';
  const { t: tr, ui } = window.SiteLanguage;
  const A = window.AUTO || {};
  const S = window.SITE || {};
  const R = window.Render || {
    escape: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    md: (s) => ui`<p>${String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
    sanitizeHtml: (s) => String(s ?? ''),
    renderFile: (f) => ui`<p>${String(f.body ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>`,
    math: () => {},
  };

  /* ------------------------------------------------------------------ 工具 */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v) => R.escape(v);
  /** 链接/资源地址：相对路径原样返回（file:// 直接双击打开也能用），只挡危险协议 */
  const safe = (u) => {
    const raw = String(u ?? '').trim();
    if (!raw) return '#';
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      try {
        const p = new URL(raw);
        return ['http:', 'https:', 'mailto:', 'file:'].includes(p.protocol) ? esc(p.href) : '#';
      } catch { return '#'; }
    }
    return esc(raw);
  };
  /* 站点根：从 app.js 自己的绝对地址反推（todo.md §1.4 修法 A）。
     根路径 → https://x1shang.top/ ｜ 预渲染页 → …/articles/x/../../app.js → 仍是根 ｜ file:// 双击 → 本地目录。三者都对。
     为什么需要它：下面的 fetch / href / img / audio 用的是相对路径，而相对路径按「当前文档 URL」解析，
     于是硬打开 /articles/<id>/ 的会话里全都指到 /articles/<id>/ 下面 → 访客图、照片、音乐、RSS 全 404。 */
  const SITE_ROOT = (() => {
    const src = document.currentScript?.src || document.querySelector('script[src$="app.js"]')?.src;
    try { return src ? new URL('.', src).href : new URL('.', location.href).href; }
    catch { return new URL('.', location.href).href; }
  })();
  /** 站内相对地址 → 绝对地址；本来就是绝对 URL（http / mailto / file / data）的原样返回 */
  const at = (p) => { try { return new URL(String(p ?? ''), SITE_ROOT).href; } catch { return String(p ?? ''); } };
  const fmt = (d) => String(d || '').slice(0, 10);
  const fmtCn = (d) => { if (window.SiteLanguage.get() === 'en') return fmt(d); const m = fmt(d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? ui`${m[1]}年${Number(m[2])}月${Number(m[3])}日` : fmt(d); };
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  const testBadge = (it) => (it && it.test ? tr('<span class="badge" title="测试样例：检查完可以删掉对应文件">测试样例</span>') : '');
  /** 搜索 / 摘要用的可读纯文本：剥掉 HTML 标签与 Markdown、LaTeX 记号 */
  const plain = (s) => String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\(begin|end)\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[#*`_>~|{}[\]$\\]/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  /** 断言通常没有标题：用正文开头当标题（有 title 就用 title），截断时不留半个英文单词 */
  const assertionLabel = (a, n = 30) => {
    const full = plain(a.title || a.body || (a.tags || []).join(' '));
    if (full.length <= n) return full;
    let cut = full.slice(0, n);
    if (/[A-Za-z0-9]$/.test(cut) && /[A-Za-z0-9]/.test(full[n] || '')) cut = cut.replace(/[A-Za-z0-9]+$/, '').trimEnd();
    return ui`${cut}…`;
  };

  const sections = [
    ['home', '主页', 'Home'], ['academic', '学术', 'Academic'], ['articles', '文章', 'Articles'],
    ['assertions', '断言', 'Thoughts'], ['photography', '摄影', 'Photography'],
    ['music', '音乐', 'Music'], ['friends', '友链', 'Friends'], ['about', '关于', 'About'],
  ];
  /** 作品不再由本站承载：侧栏「作品」直接外链到导航页（磁贴 + 作品区都在那边） */
  const WORKS_URL = 'https://navi.x1shang.top/';
  const NAV = [
    ['home', '主页'], ['academic', '学术'], ['articles', '文章'], ['assertions', '断言'],
    ['__works', '作品'], ['photography', '摄影'], ['music', '音乐'], ['friends', '友链'], ['about', '关于'],
  ];
  const descriptions = {
    academic: '论文、研究，与尚未解答的问题。', articles: '给值得展开的想法，留一整页的空间。',
    assertions: '短一点的文字，未必轻一点。',
    photography: '快门落下时，留住片刻的光。', music: '让旋律继续，让思绪慢下来。',
    friends: '互联网很大，很高兴与你相遇。', about: '这座小站的记录与刻度。',
  };

  /* ------------------------------------------------------------------ 内容模型 */
  function normalize(kind, auto, manual) {
    const map = new Map();
    for (const it of auto || []) if (it && it.id) map.set(String(it.id), { ...it, _kind: kind });
    for (const it of manual || []) if (it && it.id) map.set(String(it.id), { ...it, _kind: kind });
    return [...map.values()].map((it) => ({ ...it, tags: it.tags || [], heat: Number(it.heat ?? it.likes) || 0 }));
  }
  const C = {
    articles: normalize('article', A.articles, S.articles),
    assertions: normalize('assertion', A.assertions, S.assertions),
    papers: normalize('paper', A.papers, S.papers),
    photos: normalize('photo', A.photos, S.photos),
    tracks: normalize('track', A.tracks, S.tracks),
    friends: normalize('friend', A.friends, S.friends),
    about: A.about || S.about || '',
    generated: A.generated || '',
    count: (A.stats && Object.values(A.stats).reduce((a, b) => a + b, 0)) || 0,
  };
  const newestDate = () => [C.articles, C.assertions, C.papers, C.photos, C.tracks].flat()
    .map((x) => fmt(x.date)).filter(Boolean).sort().pop() || fmt(A.recent) || fmt(new Date());

  /**
   * 排序：① 测试样例（front matter `test: true`）**永远置底**；② 再按热度；③ 同热度按时间倒序；④ 再按标题。
   * 热度：文章 / 断言 / 论文用「访客总量」（构建期由 tools/fetch-stats.mjs 抓进 stats.json，
   * 再由 tools/build-content.mjs 写进内容包的 heat 字段，不联网）；照片 / 音乐 / 友链用 front matter 的
   * heat（旧字段 likes 兼容）。
   */
  const heatOf = (it) => Number(it.heat) || 0;
  const byHeatThenTime = (a, b) => (Number(!!a.test) - Number(!!b.test))
    || (heatOf(b) - heatOf(a))
    || String(b.date || '').localeCompare(String(a.date || ''))
    || String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), 'zh');

  /** 音乐的唯一顺序：音乐页、首页索引与播放器共用同一份排序。
   *  播放器以前直接用 C.tracks（构建扫描顺序），和页面按热度/时间排出来的顺序不一致，
   *  于是点第 3 首会播成另一首、"下一首"也不按页面往下走。
   *  以后往 assets/music/ 加歌，只要显示仍走 musicList()，播放顺序就自动跟着显示顺序变。 */
  const musicList = () => [...C.tracks].sort(byHeatThenTime);

  /* ------------------------------------------------------------------ 检索索引 */
  let searchIndex = [];
  function buildSearchIndex() {
    const push = (kind, label, item, route, extra = '') => {
      if (!item) return;
      searchIndex.push({
        kind, label, route,
        title: item.title || item.name || '',
        date: fmt(item.date),
        heat: heatOf(item), test: !!item.test,
        text: plain([item.summary, item.abstract, item.description, item.body, item.caption, item.location, (item.tags || []).join(' '), item.authors, item.venue, extra].filter(Boolean).join(' \n ')),
      });
    };
    searchIndex = [];
    for (const [id, label] of sections) searchIndex.push({ kind: 'page', label: tr('页面'), route: ui`#${id}`, title: tr(label), date: '', text: tr(descriptions[id] || '') });
    for (const a of C.articles) push('article', tr('文章'), a, ui`#articles/${encodeURIComponent(a.id)}`);
    for (const a of C.assertions) push('assertion', tr('断言'), { ...a, title: assertionLabel(a, 42) }, ui`#assertions/${encodeURIComponent(a.id)}`);
    for (const p of C.papers) push('paper', tr('学术'), p, ui`#academic/${encodeURIComponent(p.id)}`);
    for (const p of C.photos) push('photo', tr('摄影'), p, ui`#photography/${encodeURIComponent(p.id)}`);
    for (const t of C.tracks) push('track', tr('音乐'), t, ui`#music/${encodeURIComponent(t.id)}`, t.artist || '');
    for (const f of C.friends) push('friend', tr('友链'), f, f.url || '#friends', f.url || '');
    searchIndex.push({ kind: 'page', label: tr('作品'), route: WORKS_URL, title: tr('作品导航'), date: '', text: tr('作品 导航 磁贴') });
  }

  const KIND_PREFIX = { article: '文章', assertion: '断言', paper: '学术', photo: '摄影', track: '音乐', friend: '友链', page: '页面' };
  function search(raw) {
    let q = String(raw || '').trim(), filter = '';
    const m = q.match(/^(?:([a-z]+)|(文章|断言|学术|论文|摄影|照片|音乐|友链|页面))[:：]\s*(.*)$/);
    if (m) {
      const key = m[1] || Object.keys(KIND_PREFIX).find((k) => KIND_PREFIX[k] === m[2]);
      if (KIND_PREFIX[key]) { filter = key; q = m[3].trim(); }
    }
    if (!q) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    for (const entry of searchIndex) {
      if (filter && entry.kind !== filter) continue;
      const title = entry.title.toLowerCase(), text = entry.text.toLowerCase();
      let score = 0, firstAt = -1;
      for (const t of terms) {
        const inTitle = title.includes(t), inText = text.includes(t);
        if (!inTitle && !inText) { score = -1; break; }
        score += (inTitle ? 6 : 0) + (inText ? 1 : 0) + (inText ? Math.min(text.split(t).length - 1, 4) : 0);
        if (firstAt < 0 && inText) firstAt = text.indexOf(t);
      }
      if (score < 0) continue;
      let snip = '';
      if (firstAt >= 0) {
        const from = Math.max(0, firstAt - 38);
        snip = (from > 0 ? '…' : '') + entry.text.slice(from, firstAt + 62).replace(/\s+/g, ' ') + '…';
      } else snip = entry.text.replace(/\s+/g, ' ').slice(0, 76);
      hits.push({ ...entry, score, snip });
    }
    return hits.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date))).slice(0, 60);
  }

  function markTerms(text, q) {
    let out = esc(text);
    for (const t of String(q).trim().split(/\s+/).filter((x) => x.length > 1)) {
      try { out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (s) => ui`<mark>${s}</mark>`); } catch { /* 忽略 */ }
    }
    return out;
  }

  /* ------------------------------------------------------------------ 搜索与导航命令 */
  const ENTRY_ALIASES = { '/': 'pages', home: 'pages', index: 'pages', 主页: 'pages', a: 'articles', 文章: 'articles', papers: 'academic', 学术: 'academic', t: 'assertions', 断言: 'assertions', p: 'photography', photos: 'photography', 摄影: 'photography', m: 'music', 音乐: 'music', f: 'friends', 友链: 'friends', 关于: 'about', w: 'works', 作品: 'works' };
  function commandEntries(scope) {
    scope = ENTRY_ALIASES[scope.toLowerCase()] || scope.toLowerCase();
    if (scope === 'all') return [...searchIndex];
    const kinds = { articles: 'article', academic: 'paper', assertions: 'assertion', photography: 'photo', music: 'track', friends: 'friend' };
    const rows = scope === 'pages' ? searchIndex.filter(x => x.kind === 'page') : kinds[scope] ? searchIndex.filter(x => x.kind === kinds[scope]).sort(byHeatThenTime) : searchIndex.filter(x => x.kind === 'page' && x.route === ui`#${scope}`);
    // 当页渲染出的正文链接、播放器及照片操作也能按编号访问。
    if (scope === currentPage || (scope === 'pages' && currentPage === 'home')) {
      for (const el of $$('#main a[href], #main button, #player:not([hidden]) button')) {
        const route = el.getAttribute('href');
        const title = el.textContent.trim() || el.getAttribute('aria-label') || el.querySelector('img')?.alt || tr('打开照片');
        if (route && rows.some(x => x.route === route)) continue;
        if (el.matches('button') && (el.hidden || el.disabled)) continue;
        rows.push({ kind: 'action', label: el.matches('button') ? tr('操作') : tr('链接'), title, route: route || '', action: () => el.click() });
      }
    }
    return rows;
  }
  const dock = window.createSiteDock({
    search, esc, markTerms, entries: commandEntries,
    path: () => {
      const raw = (location.hash.startsWith('#search/') ? dock.baseHash.slice(1) : location.hash.slice(1)) || routeFromPath() || 'home';
      return raw === 'content' ? 'home' : raw;
    },
    navigate: route => {
      if (/^https?:/i.test(route)) { window.open(route, '_blank', 'noopener,noreferrer'); return; }
      if (!route.startsWith('#')) return;
      if (route === location.hash) render(); else location.hash = route;
    },
  });

  /* ------------------------------------------------------------------ 视图 */
  const head = (id, title) => ui`<div class="eyebrow"><span>PERSONAL INDEX / ${(sections.find((x) => x[0] === id) || [, , 'READING'])[2].toUpperCase()}</span><span>x1shang / ${new Date().getFullYear()}</span></div><h1 class="page-title">${esc(tr(title))}</h1><p class="lead">${tr(descriptions[id] || '')}</p>`;
  const empty = (title, text = tr('新的内容会慢慢出现在这里。')) => ui`<div class="empty"><b>${title}</b>${text}</div>`;
  const runLink = (href, label, extra = '') => ui`<a href="${safe(href)}"${extra}>${esc(label)}</a>`;
  const joinRun = (rows, fallback) => rows.length ? rows.join('<span class="dot">·</span>') : ui`<span class="meta">${fallback}</span>`;

  /* 音乐：本地音频用仓库里的文件；只写了网易云 ID 的曲目走公开外链
     （music.163.com/song/media/outer/url?id=<ID>.mp3，302 到 CDN，浏览器会自动把 http 目标升级成 https）。
     能不能播是 tools/fetch-netease.mjs 在构建期探好的：playable === false 就是网易云不给直链。 */
  const neteaseOuter = (id) => ui`https://music.163.com/song/media/outer/url?id=${encodeURIComponent(String(id).trim())}.mp3`;
  const trackSrc = (t) => (t && (t.src || (t.netease && t.playable !== false ? neteaseOuter(t.netease) : ''))) || '';

  /* 分享：国内社媒（微信/QQ/小红书/微博正文）基本不读 OG 卡片，所以不走"分享到 X"那套，
     只做一件事——点一下把「标题 + 链接」复制到剪贴板，用户自己粘。文章与论文的详情页末尾各一个。
     站内 SPA 与预渲染的真实路径页共用这段逻辑（预渲染页也会被 app.js 接管）。 */
  function shareBar(kind, id) {
    const it = (kind === 'academic' ? C.papers : C.articles).find((x) => String(x.id) === id);
    if (!it) return '';
    const dir = kind === 'academic' ? 'academic' : 'articles';
    const base = ((A.site && A.site.url) || location.origin).replace(/\/$/, '');
    const url = ui`${base}/${dir}/${encodeURIComponent(id)}/`;
    return ui`<div class="share" data-share data-title="${esc(it.title || id)}" data-url="${esc(url)}">
      <button type="button" class="share-btn" data-share-btn>复制标题与链接</button>
      <span class="share-note">有意思的想法值得分享</span>
    </div>`;
  }

  /** 复制到剪贴板：先走异步 API（https / localhost 才有），失败退回 textarea + execCommand（http、file:// 也能用） */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* 落到下面的兜底 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }

  async function onShareClick(box) {
    const btn = box.querySelector('[data-share-btn]');
    const text = ui`${box.dataset.title}\n${box.dataset.url}`;
    const ok = await copyText(text);
    if (!btn) return;
    btn.textContent = ok ? tr('已复制 ✓') : tr('复制失败，请手动选择');
    btn.classList.toggle('is-done', ok);
    clearTimeout(btn._shareTimer);
    btn._shareTimer = setTimeout(() => { btn.textContent = tr('复制标题与链接'); btn.classList.remove('is-done'); }, 1800);
  }

  /* 首页：仿 okmij.org Index —— 自适应均衡分栏链接 */
  const INDEX_LIMIT = 100;
  const MOBILE_INDEX_LIMIT = 10;
  /** 手机态每个板块只列 10 条，桌面仍是最多 100 条；以本次渲染时的视口宽度为准。 */
  const indexLimit = () => (matchMedia('(max-width:760px)').matches ? MOBILE_INDEX_LIMIT : INDEX_LIMIT);
  function home() {
    const limit = indexLimit();
    const articles = [...C.articles].sort(byHeatThenTime);
    const papers = [...C.papers].sort(byHeatThenTime);
    const assertions = [...C.assertions].sort(byHeatThenTime);
    const photos = [...C.photos].sort(byHeatThenTime);
    const tracks = musicList();
    const friends = [...C.friends].sort(byHeatThenTime);
    const cat = (title, rows, opts = {}) => ui`<section class="idx-cat${opts.short ? ' short' : ''}"><h3>${esc(title)}</h3><p class="idx-run">${rows}</p>${opts.note ? ui`<p class="idx-sub">${opts.note}</p>` : ''}${opts.more ? ui`<p class="idx-more">${opts.more}</p>` : ''}</section>`;

    const shortcuts = [
      ['#articles', tr('文章')], ['#assertions', tr('断言')], ['#academic', tr('学术')],
      ['#photography', tr('摄影')], ['#music', tr('音乐')], ['#friends', tr('友链')], ['#about', tr('关于')],
    ].map(([h, l]) => runLink(h, l));
    shortcuts.splice(3, 0, ui`<a href="${WORKS_URL}" target="_blank" rel="noopener noreferrer">作品</a>`);
    shortcuts.push(ui`<a href="${safe(at('feed.xml'))}" type="application/rss+xml">RSS</a>`, ui`<a href="${safe(at('atom.xml'))}" type="application/atom+xml">Atom</a>`,
      ui`<a href="https://github.com/${encodeURIComponent(S.github)}" target="_blank" rel="noopener noreferrer">GitHub</a>`);

    /* 动态：全站最新的三条「非测试样例」更新（文章 / 断言 / 学术 / 摄影 / 音乐） */
    const UPD_KIND = { article: tr('文章'), assertion: tr('断言'), paper: tr('学术'), photo: tr('摄影'), track: tr('音乐') };
    const updates = [
      ...C.articles.map((x) => ['article', x, ui`#articles/${encodeURIComponent(x.id)}`]),
      ...C.assertions.map((x) => ['assertion', x, ui`#assertions/${encodeURIComponent(x.id)}`]),
      ...C.papers.map((x) => ['paper', x, ui`#academic/${encodeURIComponent(x.id)}`]),
      ...C.photos.map((x) => ['photo', x, ui`#photography/${encodeURIComponent(x.id)}`]),
      ...C.tracks.map((x) => ['track', x, ui`#music/${encodeURIComponent(x.id)}`]),
    ]
      .filter(([, it]) => !it.test && fmt(it.date))
      .sort((a, b) => fmt(b[1].date).localeCompare(fmt(a[1].date)))
      .slice(0, 3);
    const updateRow = ([kind, it, href]) =>
      ui`${runLink(href, it.title || it.location || assertionLabel(it, 24) || tr('未命名'))}<span class="meta">${UPD_KIND[kind]} · ${esc(fmt(it.date))}</span>`;

    const categories = [
      cat(tr('快捷入口'), joinRun(shortcuts, '—'), { short: true }),
      cat(tr('动态'), updates.length
        ? joinRun(updates.map(updateRow), '—')
        : tr('<span class="meta">还没有更新：新发布的内容会自动出现在这里。</span>'),
        { short: true, note: updates.length ? tr('最近三条 · 不含测试样例') : '' }),
      cat(tr('学术'), joinRun(papers.slice(0, limit).map((p) => runLink(ui`#academic/${encodeURIComponent(p.id)}`, p.title)), tr('论文列表还是空的：把 .md/.tex 丢进 content/papers/ 就行')),
        { note: papers.length ? ui`${papers.length} 篇` : '' }),
      cat(tr('摄影'), joinRun(photos.slice(0, limit).map((p) => runLink(ui`#photography/${encodeURIComponent(p.id)}`, p.title || p.location || tr('照片'))), tr('还没有照片：丢进 inbox/photos/')),
        { note: photos.length ? ui`${photos.length} 张 / 自动压缩为 WebP` : '' }),
      cat(tr('音乐'), joinRun(tracks.slice(0, limit).map((t) => runLink(ui`#music/${encodeURIComponent(t.id)}`, t.title)), tr('还没有音乐：把音频放进 assets/music/'))),

      cat(tr('文章'), joinRun(articles.slice(0, limit).map((a) => runLink(ui`#articles/${encodeURIComponent(a.id)}`, a.title)), tr('还没有文章：把 .md 丢进 content/articles/')),
        { note: articles.length ? ui`${articles.length} 篇` : '', more: articles.length ? tr('<a href="#articles">全部文章 →</a>') : '' }),
      cat(tr('断言'), joinRun(assertions.slice(0, limit).map((a) => runLink(ui`#assertions/${encodeURIComponent(a.id)}`, assertionLabel(a, 26))), tr('还没有断言：把短句丢进 content/assertions/')),
        { note: assertions.length ? ui`${assertions.length} 则` : '', more: assertions.length ? tr('<a href="#assertions">全部断言 →</a>') : '' }),
      cat(tr('友链'), joinRun(friends.slice(0, limit).map((f) => ui`<a href="${safe(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`), tr('还没有友链：写进 content/friends/')),
        { more: tr('<a href="#friends">友链 →</a>') }),

      cat(tr('作品'), ui`<a href="${WORKS_URL}" target="_blank" rel="noopener noreferrer">导航页</a>`,
        { note: tr('作品与磁贴入口都在站外的导航页') }),
      cat(tr('索引与元信息'), joinRun([runLink('#about', tr('关于本站')), ui`<a href="#search/%E7%89%A9%E7%90%86">检索「物理」</a>`], '—'),
        { short: true, note: tr('按 / 进入命令模式，输入 help 查看帮助') }),
      cat(tr('关于'), ui`<span class="meta">${esc(tr(S.intro || ''))}</span>`, { short: true }),
    ];

    return ui`<div class="idx-head">
        <h1 class="idx-title">Index</h1>
        <p class="idx-note">除非另有说明，本站的文字、照片与代码均由作者维护。内容按<b>热度</b>在前、<b>时间</b>在后排列。</p>
        <p class="idx-recent"><b>最近更新：</b> ${esc(fmtCn(newestDate()))}<span class="sep">|</span><a href="${safe(at('feed.xml'))}">RSS</a><span class="sep">|</span><a href="${safe(at('atom.xml'))}">Atom</a></p>
      </div>
      <div class="idx-columns">${categories.join('')}</div>
      <p class="idx-foot">共 ${C.articles.length} 篇文章 · ${C.assertions.length} 则断言 · ${C.papers.length} 篇论文 · ${C.photos.length} 张照片 · ${C.tracks.length} 首音乐 · ${C.friends.length} 个友链${C.generated ? ui` · 内容包生成于 ${esc(fmt(C.generated))}` : ''}</p>`;
  }

  /* 板块列表：密集索引行 */
  function idxList(items, rowFn, opts = {}) {
    if (!items.length) return empty(opts.emptyTitle || tr('这里还空着'), opts.emptyText);
    return ui`<ol class="idx-list">${items.map((it, i) => ui`<li class="idx-item${it.test ? ' is-test' : ''}">
      <span class="rank">${String(i + 1).padStart(2, '0')}</span><span class="tt">${rowFn(it, i)}</span>
      ${opts.sub ? ui`<span class="sub">${opts.sub(it)}</span>` : ''}
      <span class="date">${esc(fmt(it.date))}</span>
    </li>`).join('')}</ol>`;
  }

  function academicList() {
    const papers = [...C.papers].sort(byHeatThenTime);
    /* 学术页的机构邮箱（todo.md §2.2）：投稿 / 竞赛 / 暑研表格常点名要机构邮箱，
       而 ciallo@ 回信进 @sjtu.edu.cn 会被 SJTU 的 rspamd 灰名单拦进垃圾箱（§2.3），所以这里留 SJTU 这一封。 */
    return head('academic', tr('学术'))
      + ui`<p class="lead contact">学术联系：<a href="mailto:zhu_jiahe2008@sjtu.edu.cn">zhu_jiahe2008@sjtu.edu.cn</a></p>`
      + idxList(papers, (p) => ui`<a href="#academic/${encodeURIComponent(p.id)}">${esc(p.title)}</a>${testBadge(p)}`,
      { sub: (p) => [p.authors, p.venue].filter(Boolean).map(esc).join(' · '), emptyTitle: tr('研究记录，待续'), emptyText: tr('把 .md / .tex 丢进 content/papers/ 就会出现在这里。') });
  }

  function academicDetail(id) {
    const p = C.papers.find((x) => String(x.id) === id);
    if (!p) return empty(tr('论文未找到'), tr('<a href="#academic">返回学术列表</a>'));
    return ui`<a class="backlink" href="#academic">← 学术</a>
      <div class="reading-head"><h1>${esc(p.title)}</h1>${testBadge(p)}
      <div class="reading-meta"><span>${esc(fmt(p.date))}</span>${p.authors ? ui`<span>${esc(p.authors)}</span>` : ''}${p.venue ? ui`<span>${esc(p.venue)}</span>` : ''}${p.url ? ui`<span><a href="${safe(p.url)}" target="_blank" rel="noopener noreferrer">原文 ↗</a></span>` : ''}</div></div>
      ${p.abstract ? ui`<p class="lead">${esc(p.abstract)}</p>` : ''}
      <article class="prose" data-format="${esc(p.format || 'md')}">${p.body ? R.renderFile({ format: p.format, body: p.body }) : tr('<p class="meta">这条记录没有正文，只有上面的信息。</p>')}</article>`;
  }

  function articlesList() {
    const list = [...C.articles].sort(byHeatThenTime);
    return head('articles', tr('文章')) + idxList(list, (a) => ui`<a href="#articles/${encodeURIComponent(a.id)}">${esc(a.title)}</a>${testBadge(a)}`,
      { sub: (a) => [...(a.tags || []).map((t) => '#' + t), a.summary].filter(Boolean).join(' '), emptyTitle: tr('还没有文章'), emptyText: tr('把 .md / .html / .tex / .txt 丢进 content/articles/，刷新即可。') });
  }

  function articlesDetail(id) {
    const a = C.articles.find((x) => String(x.id) === id);
    if (!a) return empty(tr('文章未找到'), tr('<a href="#articles">返回文章列表</a>'));
    return ui`<a class="backlink" href="#articles">← 所有文章</a>
      <div class="reading-head"><h1>${esc(a.title)}</h1>${testBadge(a)}
      <div class="reading-meta"><span>${esc(fmt(a.date))}</span>${(a.tags || []).map((t) => ui`<span>#${esc(t)}</span>`).join('')}<span>${esc(a.format || 'md')}</span></div></div>
      <article class="prose" data-format="${esc(a.format || 'md')}">${R.renderFile({ format: a.format, body: a.body })}</article>`;
  }

  function assertionsList() {
    const list = [...C.assertions].sort(byHeatThenTime);
    if (!list.length) return head('assertions', tr('断言')) + empty(tr('等待下一个念头'), tr('把短句丢进 content/assertions/，一个文件一则。'));
    return head('assertions', tr('断言')) + list.map((a) => ui`<article class="idx-item${a.test ? ' is-test' : ''}" style="display:block">
        <div class="reading-meta"><span>${esc(fmt(a.date))}</span>${(a.tags || []).map((t) => ui`<span>#${esc(t)}</span>`).join('')}${a.test ? testBadge(a) : ''}</div>
        <div class="prose" style="margin:10px 0 0">${R.renderFile({ format: a.format, body: a.body })}</div>
      </article>`).join('');
  }

  function assertionDetail(id) {
    const a = C.assertions.find((x) => String(x.id) === id);
    if (!a) return empty(tr('断言未找到'), tr('<a href="#assertions">返回断言列表</a>'));
    return ui`<a class="backlink" href="#assertions">← 断言</a>
      <div class="reading-head"><h1>${esc(assertionLabel(a, 46) || tr('断言'))}</h1>${testBadge(a)}
      <div class="reading-meta"><span>${esc(fmt(a.date))}</span>${(a.tags || []).map((t) => ui`<span>#${esc(t)}</span>`).join('')}</div></div>
      <article class="prose" data-format="${esc(a.format || 'md')}">${R.renderFile({ format: a.format, body: a.body })}</article>`;
  }

  function worksPage() {
    return head('works', tr('作品'))
      + ui`<p class="note">作品都在站外的导航页：<a href="${WORKS_URL}" target="_blank" rel="noopener noreferrer">导航页</a>（磁贴入口 + 作品区都在那边）。</p>`;
  }

  function photographyPage(detail) {
    if (!C.photos.length) return head('photography', tr('摄影')) + empty(tr('留一个位置，给下一束光'), tr('把照片拖进 <code>inbox/photos/</code>，流水线会自动压缩成 WebP（该目录已 gitignore）。'));
    const list = [...C.photos].sort(byHeatThenTime);
    return head('photography', tr('摄影')) + ui`<div class="photo-grid">${list.map((p) => ui`<figure class="photo" id="photo-${esc(p.id)}" style="margin:0">
        <button class="shot" data-photo="${esc(p.id)}" aria-label="放大：${esc(p.title || tr('照片'))}"><img loading="lazy" src="${safe(at(p.thumb || p.src))}" alt="${esc(p.title || '')}"></button>
        <figcaption class="cap"><span>${esc(p.title || '')}${testBadge(p)}</span><span class="meta">${esc(p.location || '')}</span><span class="date">${esc(fmt(p.date))}</span></figcaption>
      </figure>`).join('')}</div>
      <p class="note">照片来自 <code>inbox/photos/</code>（原始文件不入库），构建时自动旋转、压缩并转成 WebP。</p>`;
  }

  function musicPage(detail) {
    const list = musicList();
    const rows = list.length ? list.map((t, i) => {
      const src = trackSrc(t);
      const sub = [t.artist, t.album].filter(Boolean).join(' · ');
      const note = [sub, t.netease ? (t.playable === false ? tr('网易云 · 无直链（VIP / 独家 / 无版权）') : tr('网易云外链')) : '', t.test ? tr('测试样例') : ''].filter(Boolean).join(' · ');
      return ui`<div class="idx-item music-row${t.test ? ' is-test' : ''}" id="track-${esc(t.id)}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <button class="track" data-track="${esc(t.id)}" style="flex:1;border:0;padding:0"><span><strong>${esc(t.title)}</strong><small>${esc(note)}</small></span><span class="track-play">${src ? tr('播放 ↗') : tr('暂无音频')}</span></button>
        <span class="date">${esc(fmt(t.date))}</span></div>`;
    }).join('')
      : empty(tr('歌单，正在酝酿'), tr('把音频放进 <code>assets/music/</code>，或放一个只写 <code>netease: &lt;歌曲ID&gt;</code> 的 .md。'));
    return head('music', tr('音乐')) + rows;
  }

  function friendsPage() {
    const list = [...C.friends].sort(byHeatThenTime);
    const rows = list.length ? idxList(list, (f) => ui`<a href="${safe(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)} ↗</a>${testBadge(f)}`,
      { sub: (f) => esc(f.description || host(f.url)) })
      : empty(tr('期待在这里，遇见同路人'));
    const avatar = 'https://x1shang.top/assets/img/x1shang-avatar.webp';
    // 友链卡片给别人抄：订阅地址写成带域名的绝对地址，复制粘贴就能用
    const home = String(S.url || 'https://x1shang.top').replace(/\/$/, '');
    const feed = `${home}/feed.xml`;
    const atomUrl = `${home}/atom.xml`;
    return head('friends', tr('友链')) + rows
      + ui`<div class="friend-apply glass">
          <p>${tr('如想添加请')}<a href="mailto:ciallo@x1shang.top">${tr('邮箱')}</a>${tr('联系，并使用以下信息添加我进入你的友链哦')}</p>
          <dl>
            <dt>${tr('名称：')}</dt><dd>x1shang-山与回响</dd>
            <dt>${tr('简介：')}</dt><dd>${tr('山有轮廓，思绪没有')}</dd>
            <dt>${tr('链接：')}</dt><dd><a href="https://www.x1shang.top" target="_blank" rel="noopener noreferrer">https://www.x1shang.top</a></dd>
            <dt>${tr('RSS：')}</dt><dd><a href="${safe(feed)}" target="_blank" rel="noopener noreferrer">${esc(feed)}</a></dd>
            <dt>${tr('Atom：')}</dt><dd><a href="${safe(atomUrl)}" target="_blank" rel="noopener noreferrer">${esc(atomUrl)}</a></dd>
            <dt>${tr('头像：')}</dt><dd><a href="${avatar}" target="_blank" rel="noopener noreferrer">${avatar}</a></dd>
          </dl>
        </div>`;
  }

  function aboutPage() {
    const about = window.SiteLanguage.get() === 'en' ? (A.aboutEn || C.about) : C.about;
    const days = Math.max(1, Math.floor((Date.now() - new Date(ui`${S.since}T00:00:00+08:00`)) / 86400000) + 1);
    const stats = [[days, tr('建站天数')], [C.articles.length + C.assertions.length + C.papers.length, tr('文字记录')], [C.photos.length, tr('摄影作品')], [C.tracks.length, tr('音乐')], [C.friends.length, tr('友链')]];
    return head('about', tr('关于'))
      + ui`<div class="stats">${stats.map(([n, label]) => ui`<div class="stat glass"><strong>${n}</strong><span>${label}</span></div>`).join('')}</div>`
      + (about ? ui`<article class="prose" style="margin-top:32px">${R.renderFile({ format: 'md', body: about })}</article>` : '')
      + ui`<article class="row" style="margin-top:28px"><h3>这座小站怎么运转</h3>
          <p>整站是纯静态的 HTML / CSS / JavaScript：文字丢进 <code>content/</code>（文章 / 断言 / 学术 / 友链）、照片丢进 <code>inbox/photos/</code>、音乐丢进 <code>assets/music/</code>，跑一次构建就编入索引。照片目录已被 gitignore，只有压缩后的 WebP 会进仓库。</p>
          <p>页面底部常驻一条命令行检索：按 <kbd>/</kbd> 或 <kbd>&gt;</kbd> 聚焦，↑↓ 选择，Enter 打开。文章、断言与论文正文用简约阅读版式，公式由 KaTeX 渲染。</p>
        </article>
        <article class="row"><h3>订阅与统计</h3><p><a href="${safe(at('feed.xml'))}">RSS</a> · <a href="${safe(at('atom.xml'))}">Atom</a> · 内容数量来自站内数据，建站天数按设定日期计算。</p></article>
        <article class="row"><h3>访客</h3>
          <div class="visits" id="visits" data-state="loading"><p class="note">正在读取访客数据…</p></div>
          <p class="note">图表只读站内的静态快照 <code>stats.json</code>（由 <code>tools/fetch-stats.mjs</code> 刷新）；访客的浏览器不会为这张图请求任何统计服务。</p>
        </article>`;
  }

  /** 关于页最下方：访客量图（读站内的 stats.json；拿不到就安静降级，不留破图） */
  async function hydrateVisits() {
    const box = document.getElementById('visits');
    if (!box) return;
    let data = null, why = '';
    try {
      const res = await fetch(at('stats.json'), { cache: 'no-store' });
      if (res.ok) {
        try { data = await res.json(); } catch { why = tr('stats.json 解析失败'); }
      } else why = ui`暂时读不到 stats.json（HTTP ${res.status}）`;
    } catch { why = tr('读取失败，可能是断网'); }
    const raw = data && Array.isArray(data.series) ? data.series : [];
    const series = raw.filter((x) => x && typeof x.n === 'number' && x.d).slice(-30);
    if (!series.length) {
      box.dataset.state = 'empty';
      // 三分支：真失败 → 说清楚失败在哪；拿到了但没数据 → 才说"还在积累"
      box.innerHTML = why
        ? ui`<p class="note">${esc(why)}</p>`
        : tr('<p class="note">统计刚上线，数据还在积累。</p>');
      return;
    }
    const W = 640, H = 170, T = 12, B = 26, L = 6, R = 6;
    const max = Math.max(1, ...series.map((x) => x.n));
    const bw = (W - L - R) / series.length;
    const bars = series.map((x, i) => {
      const h = Math.round((H - T - B) * (x.n / max));
      const bx = L + i * bw + bw * 0.18, by = H - B - h;
      return ui`<rect class="vb" x="${bx.toFixed(1)}" y="${by}" width="${Math.max(1.2, bw * 0.64).toFixed(1)}" height="${Math.max(1, h)}" rx="1.6"><title>${esc(x.d)}：${x.n} 位访客</title></rect>`;
    }).join('');
    const total = Number(data.total || series.reduce((s, x) => s + x.n, 0));
    const updated = data.updated ? String(data.updated).slice(0, 10) : '';
    const first = series[0].d, last = series[series.length - 1].d;
    box.dataset.state = 'ready';
    box.innerHTML = ui`
      <p class="visits-total"><strong>${total}</strong><span>近 ${series.length} 天访客</span>${data.allTime ? ui`<span class="visits-all">累计 ${data.allTime}</span>` : ''}</p>
      <svg class="visits-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${series.length} 天每日访客数">
        <line class="vaxis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"></line>
        <text class="vmax" x="${L}" y="${T - 1}">${max}</text>
        ${bars}
        <text class="vlabel" x="${L}" y="${H - 8}">${esc(first)}</text>
        <text class="vlabel" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(last)}</text>
      </svg>
      ${updated ? ui`<p class="note">更新于 ${esc(updated)}${data.site ? ui` · 数据源 <a href="${safe(data.site)}" target="_blank" rel="noopener noreferrer">GoatCounter</a>` : ''}</p>` : ''}`;
  }

  /* ------------------------------------------------------------------ 渲染调度 */
  let currentPage = 'home';

  /**
   * 预渲染的真实路径 → 站内路由：/articles/<id>/ 这类地址（爬虫、分享、搜索结果来的）
   * 也能落到对应文章；本地双击 articles/<id>/index.html 同样认得（file:// 也能用）。
   */
  const DETAIL_KIND = { articles: 1, assertions: 1, academic: 1 };
  function routeFromPath() {
    const m = location.pathname.match(/\/(articles|assertions|academic)\/([^/]+)\/(?:index\.html)?$/);
    if (!m) return '';
    try { return ui`${m[1]}/${decodeURIComponent(m[2])}`; } catch { return ui`${m[1]}/${m[2]}`; }
  }

  /**
   * 访客统计补报：GoatCounter 按 location.pathname 记账，哈希路由（#articles/x）原本全算在 / 上。
   * 因此站内跳转到文章 / 断言 / 论文时手工补一条真实路径的 pageview；直接从真实路径进来的
   * 那一次由 count.js 自己记，不重复补报。
   */
  function trackVisit(route, detail) {
    const gc = window.goatcounter;
    if (!gc || typeof gc.count !== 'function' || !detail || !DETAIL_KIND[route]) return;
    try { gc.count({ path: ui`/${route}/${encodeURIComponent(detail)}/` }); } catch { /* 统计失败不影响阅读 */ }
  }

  function render(options = {}) {
    const fromPath = routeFromPath();
    const raw = location.hash.slice(1) || fromPath;
    const [route, ...rest] = raw.split('/');
    let detail = ''; try { detail = decodeURIComponent(rest.join('/')); } catch { detail = rest.join('/'); }
    if (!options.languageOnly && detail && !(fromPath && fromPath === raw)) trackVisit(route, detail);
    const isSection = sections.some((x) => x[0] === route);
    currentPage = isSection ? route : 'home';
    const reading = (currentPage === 'articles' && detail) || (currentPage === 'academic' && detail) || (currentPage === 'assertions' && detail);
    document.body.classList.toggle('reading', !!reading);
    $('#hero').hidden = currentPage !== 'home' || !!detail;
    $$('[data-page]').forEach((a) => {
      const active = a.dataset.page === currentPage;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const title = (sections.find((x) => x[0] === currentPage) || [, , 'Index'])[1];
    document.title = `${tr(title)} · x1shang`;

    let body;
    if (currentPage === 'home') body = home();
    else if (currentPage === 'academic') body = detail ? academicDetail(detail) : academicList();
    else if (currentPage === 'articles') body = detail ? articlesDetail(detail) : articlesList();
    else if (currentPage === 'assertions') body = detail ? assertionDetail(detail) : assertionsList();
    else if (currentPage === 'photography') body = photographyPage(detail);
    else if (currentPage === 'music') body = musicPage(detail);
    else if (currentPage === 'friends') body = friendsPage();
    else if (currentPage === 'about') body = aboutPage();
    else body = home();

    $('#main').innerHTML = body;
    // 文章 / 论文详情页末尾挂一个"复制标题与链接"（预渲染页与站内 SPA 都会走到这里）
    if (reading && (currentPage === 'articles' || currentPage === 'academic')) {
      $('#main').insertAdjacentHTML('beforeend', shareBar(currentPage, detail));
    }
    if (R.math) { try { R.math($('#main')); } catch { /* 公式渲染失败不影响阅读 */ } }
    if (currentPage === 'about') hydrateVisits();
    if (currentPage === 'music') {
      renderLyrics(); updateTime();
      if (detail) {
        const idx = playlist.findIndex((t) => String(t.id) === detail);
        if (idx >= 0 && audio.dataset.track !== detail) startTrack(idx);
      }
    }
    if (currentPage === 'photography' && detail) openPhoto(detail);
    if (currentPage === 'home') {
      alignMountain();
      if (location.hash === '#content') requestAnimationFrame(() => $('#content').scrollIntoView());
      else window.scrollTo(0, 0);
    } else window.scrollTo(0, 0);
    if (dock.command) dock.input.focus({ preventScroll: true });
    else if (!reading) $('#main').focus({ preventScroll: true });
    if (location.hash.startsWith('#search/')) {
      try { dock.input.value = decodeURIComponent(location.hash.slice(8)); } catch { /* 忽略 */ }
      dock.render(dock.input.value);
    }
  }

  /* ------------------------------------------------------------------ 交互 */
  document.addEventListener('click', (e) => {
    const shareBox = e.target.closest('[data-share]');
    if (shareBox) { onShareClick(shareBox); return; }
    const shot = e.target.closest('[data-photo]');
    if (shot && !shot.closest('dialog')) { openPhoto(shot.dataset.photo); return; }
    const track = e.target.closest('[data-track]');
    if (track) {
      const t = playlist.find((x) => String(x.id) === track.dataset.track);
      if (t && t.src) { location.hash = ui`#music/${encodeURIComponent(t.id)}`; startTrack(playlist.indexOf(t)); }
      return;
    }
  });

  /* ------------------------------------------------------------------ 照片弹窗 */
  function openPhoto(id) {
    const p = C.photos.find((x) => String(x.id) === id);
    if (!p) return;
    $('#large-photo').src = at(p.src);
    $('#large-photo').alt = p.title || '';
    $('#photo-caption').textContent = [p.title, p.location, fmt(p.date), p.caption].filter(Boolean).join(' · ');
    const dialog = $('#photo-dialog');
    if (!dialog.open) dialog.showModal();
  }
  $('#close-photo').onclick = () => $('#photo-dialog').close();
  $('#photo-dialog').addEventListener('click', (e) => { if (e.target === $('#photo-dialog')) e.target.close(); });

  /* ------------------------------------------------------------------ 音乐播放器 */
  /* 播放列表 = 音乐页的显示顺序（同一份 musicList()），不是 C.tracks 的扫描顺序。
     页面渲染、点歌下标、上一首/下一首、播完顺延、坏链跳过都只认这一个数组。 */
  const playlist = musicList();
  const PLAY_MODE_KEY = 'x1-play-mode';
  const PLAY_MODES = ['order', 'random', 'single'];
  const PLAY_MODE_LABEL = { order: '顺序播放', random: '随机播放', single: '单曲循环' };
  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2L19 12z"/></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5.4h3.2v13.2H7.5zM13.3 5.4h3.2v13.2h-3.2z"/></svg>';
  const MODE_ICON = {
    order: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h8.6M4 12h6.2M4 18h8.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.6 9.2 19 12l-3.4 2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    random: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>',
    single: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>',
  };
  let activeTrack = -1, timedLyrics = [], lyricIndex = -1, failStreak = 0;
  const LOCAL_RETRY_LIMIT = 2;
  let playMode = (() => {
    try { const saved = localStorage.getItem(PLAY_MODE_KEY); return PLAY_MODES.includes(saved) ? saved : 'order'; }
    catch { return 'order'; }
  })();
  let randomHistory = [], errorSkipTimer = 0, retryTimer = 0, modeTipTimer = 0, retryCount = 0;
  const audio = $('#audio');
  /** 播放器提示：锁住 #now-lyric，避免 loadedmetadata / timeupdate 把「重试中 / 点击播放」覆盖成 ♪ */
  let lyricNotice = '';
  function setPlayerNotice(text) { lyricNotice = text; $('#now-lyric').textContent = tr(text); }
  function clearPlayerNotice() { lyricNotice = ''; }
  function parseLrc(source) {
    const rows = [];
    String(source || '').split('\n').forEach((line) => {
      const text = line.replace(/\[.*?\]/g, '').trim();
      for (const m of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) rows.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
    });
    return rows.sort((a, b) => a.time - b.time);
  }
  function renderLyrics() {
    $('#lyrics')?.remove();
    const track = playlist[activeTrack];
    const row = track && document.getElementById(ui`track-${track.id}`);
    if (!row) return;
    const box = document.createElement('div');
    box.id = 'lyrics'; box.className = 'lyrics track-lyrics';
    box.setAttribute('aria-label', ui`${track.title} · 同步歌词`);
    row.after(box);
    box.innerHTML = timedLyrics.length ? timedLyrics.map((l, i) => ui`<div class="lyric" data-lyric="${i}">${esc(l.text)}</div>`).join('')
      : ui`<p class="meta">${activeTrack < 0 ? tr('选择一首曲目，旋律从这里开始。') : tr('这首还没有歌词（同名 .lrc 会自动读取）。')}</p>`;
    lyricIndex = timedLyrics.length ? -1 : -2;
  }
  async function play() {
    try {
      await audio.play();
    } catch (err) {
      // 切歌会中止上一首的 play()，这不是故障；自动播放被拦也不是地址问题。
      if (err && err.name === 'AbortError') return;
      if (err && err.name === 'NotAllowedError') { setPlayerNotice('点击播放键开始播放'); return; }
      if (audio.error) return; // 真正的加载失败交给 error 事件统一重试
      setPlayerNotice('无法播放，请检查网络后重试');
    }
  }
  function paintPlayMode() {
    const btn = $('#play-mode');
    if (!btn) return;
    const label = tr('播放模式：' + PLAY_MODE_LABEL[playMode] + '（点击切换）');
    btn.innerHTML = MODE_ICON[playMode];
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  function paintPlayToggle() {
    const btn = $('#play-toggle');
    if (!btn) return;
    const paused = audio.paused;
    btn.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
    btn.setAttribute('aria-label', tr(paused ? '播放' : '暂停'));
    btn.title = btn.getAttribute('aria-label');
  }
  function syncPlayerLabels() {
    const set = (selector, text) => {
      const el = $(selector);
      if (!el) return;
      const label = tr(text);
      el.setAttribute('aria-label', label);
      el.title = label;
    };
    set('#prev-track', '上一首');
    set('#next-track', '下一首');
    set('#close-player', '停止并关闭');
    set('#seek', '播放进度');
    paintPlayToggle();
    paintPlayMode();
  }
  function showModeTip(text) {
    const tip = $('#play-mode-tip');
    if (!tip) return;
    tip.textContent = text;
    tip.classList.add('is-show');
    clearTimeout(modeTipTimer);
    modeTipTimer = setTimeout(() => tip.classList.remove('is-show'), 1200);
  }
  function setPlayMode(mode, { announce = false } = {}) {
    playMode = PLAY_MODES.includes(mode) ? mode : 'order';
    randomHistory = [];
    try { localStorage.setItem(PLAY_MODE_KEY, playMode); } catch { /* 隐私模式也能用 */ }
    paintPlayMode();
    if (announce) showModeTip(tr(PLAY_MODE_LABEL[playMode]));
  }
  function nextTrackIndex() {
    if (!playlist.length) return -1;
    if (activeTrack < 0) return 0;
    if (playMode === 'random') {
      if (playlist.length < 2) return activeTrack;
      let next = activeTrack;
      while (next === activeTrack) next = Math.floor(Math.random() * playlist.length);
      return next;
    }
    return (activeTrack + 1) % playlist.length;
  }
  function startTrack(index, opts = {}) {
    const t = playlist[index];
    if (!t) return;
    const src = trackSrc(t);
    if (!src) return;
    if (!opts.retry) retryCount = 0;
    clearTimeout(errorSkipTimer);
    clearTimeout(retryTimer);
    retryTimer = 0;
    // 随机模式记下上一首，才能让“上一首”真的退回去；顺序/单曲按数组下标走即可。
    if (playMode === 'random' && !opts.fromHistory && activeTrack >= 0 && activeTrack !== index) {
      randomHistory.push(activeTrack);
      if (randomHistory.length > 50) randomHistory.shift();
    }
    activeTrack = index;
    // 本地音频失败重试时加 ?retry=N：绕开浏览器/GitHub Pages 可能缓存的失败响应。
    const url = at(src);
    const retryUrl = opts.retry && /^https?:/i.test(url)
      ? ui`${url}${url.includes('?') ? '&' : '?'}retry=${retryCount}`
      : url;
    audio.src = retryUrl;
    audio.dataset.track = String(t.id);
    timedLyrics = parseLrc(t.lyrics);
    $('#player').hidden = false;
    $('#now-title').textContent = ui`${t.title}${t.artist ? ' · ' + t.artist : ''}`;
    const cover = $('#now-cover');
    if (cover) {
      if (t.cover) { cover.src = at(t.cover); cover.hidden = false; }
      else { cover.hidden = true; cover.removeAttribute('src'); }
    }
    const seek = $('#seek');
    if (seek) { seek.value = 0; seek.style.setProperty('--seek', '0%'); }
    $('#time').textContent = '0:00 / 0:00';
    setPlayerNotice(opts.notice || '正在加载…');
    renderLyrics(); play();
  }
  function nextTrack() {
    const index = nextTrackIndex();
    if (index >= 0) startTrack(index);
  }
  function prevTrack() {
    if (!playlist.length) return;
    if (activeTrack < 0) { startTrack(playlist.length - 1); return; }
    if (playMode === 'random' && randomHistory.length) {
      startTrack(randomHistory.pop(), { fromHistory: true });
      return;
    }
    startTrack((activeTrack - 1 + playlist.length) % playlist.length, { fromHistory: true });
  }
  const timeText = (n) => ui`${Math.floor((Number.isFinite(n) ? n : 0) / 60)}:${String(Math.floor((Number.isFinite(n) ? n : 0) % 60)).padStart(2, '0')}`;
  function updateTime() {
    const duration = audio.duration;
    $('#time').textContent = ui`${timeText(audio.currentTime)} / ${timeText(duration)}`;
    const seek = $('#seek');
    if (seek) {
      const percent = Number.isFinite(duration) && duration > 0 ? (audio.currentTime / duration) * 100 : 0;
      seek.value = percent;
      seek.style.setProperty('--seek', `${percent}%`);
    }
    if (lyricNotice) return;
    let i = -1;
    timedLyrics.forEach((l, k) => { if (l.time <= audio.currentTime) i = k; });
    if (i !== lyricIndex) {
      lyricIndex = i;
      $('#now-lyric').textContent = (timedLyrics[i] && timedLyrics[i].text) || '♪';
      $$('.lyric').forEach((el, k) => el.classList.toggle('current', k === i));
      const el = $(ui`[data-lyric="${i}"]`), box = $('#lyrics');
      if (el && box) {
        // 把当前这句钉在歌词框正中：用 rect 差值算，别用 offsetTop（那是相对 offsetParent 的，
        // 减去 box.offsetTop 会算成一个负数 → 每次都被夹到 0，于是永远钉在顶端）
        const boxRect = box.getBoundingClientRect(), elRect = el.getBoundingClientRect();
        box.scrollTo({
          top: box.scrollTop + (elRect.top - boxRect.top) - box.clientHeight / 2 + elRect.height / 2,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }
    }
  }
  audio.addEventListener('timeupdate', updateTime);
  audio.addEventListener('loadedmetadata', updateTime);
  audio.addEventListener('play', paintPlayToggle);
  audio.addEventListener('playing', () => {
    failStreak = 0;
    retryCount = 0;
    clearTimeout(retryTimer);
    retryTimer = 0;
    clearPlayerNotice();
    updateTime();
  });
  audio.addEventListener('pause', paintPlayToggle);
  // 缓冲提示：只在“已经播过一点、又卡住”时显示；初次加载仍显示「正在加载…」
  const showBuffering = () => {
    if (activeTrack >= 0 && !audio.paused && audio.currentTime > 0) setPlayerNotice('缓冲中…');
  };
  audio.addEventListener('waiting', showBuffering);
  audio.addEventListener('stalled', showBuffering);
  audio.addEventListener('error', () => {
    if (activeTrack < 0) return;
    const t = playlist[activeTrack];
    if (!t) return;
    if (t.netease) {
      // 网易云对 VIP / 独家 / 无版权曲目不签发直链（302 到 music.163.com/404）→ 提示并顺延，最多绕一圈
      setPlayerNotice('网易云没给这首歌直链（VIP / 独家 / 无版权），换下一首');
      if (failStreak < playlist.length - 1) {
        failStreak++;
        clearTimeout(errorSkipTimer);
        errorSkipTimer = setTimeout(() => {
          // 单曲循环也不能困在一首坏歌里：坏链一律按当前模式往后跳。
          const index = nextTrackIndex();
          if (index >= 0) startTrack(index, { fromHistory: true });
        }, 1600);
      }
      return;
    }
    // 本地文件仍在 GitHub Pages 上：网络抖动/断流时先原地重试两次，不要立刻判死。
    if (retryCount < LOCAL_RETRY_LIMIT && !retryTimer) {
      retryCount++;
      setPlayerNotice('网络波动，正在重试…');
      retryTimer = setTimeout(() => {
        retryTimer = 0;
        if (activeTrack >= 0) startTrack(activeTrack, { retry: true, notice: '网络波动，正在重试…' });
      }, 900 * retryCount);
      return;
    }
    setPlayerNotice('音频加载失败，请检查网络后重试');
  });
  audio.addEventListener('ended', () => {
    if (!playlist.length) return;
    if (playMode === 'single') { audio.currentTime = 0; play(); return; }
    nextTrack();
  });
  $('#play-toggle').onclick = () => {
    if (!audio.paused) { audio.pause(); return; }
    // 已经报错过一次：点播放键 = 重新加载（否则 error 状态下的 play() 不会恢复）
    if (audio.error && activeTrack >= 0) { startTrack(activeTrack); return; }
    play();
  };
  const prevButton = $('#prev-track');
  if (prevButton) prevButton.onclick = prevTrack;
  const nextButton = $('#next-track');
  if (nextButton) nextButton.onclick = nextTrack;
  const modeButton = $('#play-mode');
  if (modeButton) modeButton.onclick = () => setPlayMode(PLAY_MODES[(PLAY_MODES.indexOf(playMode) + 1) % PLAY_MODES.length], { announce: true });
  $('#close-player').onclick = () => { audio.pause(); $('#player').hidden = true; };
  $('#seek').oninput = (e) => { if (Number.isFinite(audio.duration)) audio.currentTime = (Number(e.target.value) / 100) * audio.duration; };
  syncPlayerLabels();

  /* ------------------------------------------------------------------ 首页细节 */
  function alignMountain() {
    const box = $('.landscape'); if (!box) return;
    const rect = box.getBoundingClientRect(), scale = Math.max(rect.width / 1607, rect.height / 1080), dx = (rect.width - 1607 * scale) / 2, dy = (rect.height - 1080 * scale) / 2;
    const ridge = [[0, 606], [28, 590], [53, 555], [77, 520], [110, 502], [138, 509], [160, 541], [181, 561], [224, 590], [268, 582], [300, 571], [323, 554], [348, 523], [367, 552], [389, 591], [403, 583], [421, 610], [448, 590], [469, 616], [490, 627], [513, 644], [530, 640], [541, 660], [567, 629], [598, 584], [635, 542], [670, 501], [689, 479], [703, 453], [719, 440], [745, 406], [768, 379], [795, 342], [821, 308], [847, 273], [877, 239], [897, 252], [915, 264], [932, 292], [949, 318], [962, 345], [980, 367], [995, 391], [1012, 414], [1040, 438], [1083, 453], [1118, 471], [1138, 467], [1145, 453], [1155, 476], [1187, 493], [1201, 509], [1225, 511], [1238, 529], [1255, 525], [1277, 508], [1293, 516], [1307, 535], [1336, 550], [1368, 568], [1385, 612], [1400, 633], [1413, 637], [1428, 657], [1441, 637], [1473, 633], [1498, 629], [1514, 639], [1540, 646], [1563, 674], [1607, 702], [1607, 1080], [0, 1080]];
    const fg = $('.foreground');
    if (fg) fg.style.clipPath = ui`polygon(${ridge.map(([x, y]) => ui`${(x * scale + dx).toFixed(2)}px ${(y * scale + dy).toFixed(2)}px`).join(',')})`;
  }
  addEventListener('resize', alignMountain);
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    document.documentElement.style.setProperty('--x', ui`${e.clientX}px`);
    document.documentElement.style.setProperty('--y', ui`${e.clientY}px`);
  });
  function clock() { $('#local-clock').textContent = ui`${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })} / UTC+8`; }

  /* ------------------------------------------------------------------ 启动 */
  $('#year').textContent = new Date().getFullYear();
  $('#profile-github').href = ui`https://github.com/${encodeURIComponent(S.github)}`;
  function renderNavigation() { $('#navigation').innerHTML = NAV.map(([id, label], i) => (id === '__works'
    ? ui`<a class="is-out" href="${WORKS_URL}" target="_blank" rel="noopener noreferrer"><span>${String(i + 1).padStart(2, '0')}</span>${tr(label)}</a>`
    : ui`<a href="#${id}" data-page="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${tr(label)}</a>`)).join(''); }
  renderNavigation();
  clock(); setInterval(clock, 60000);
  buildSearchIndex();
  alignMountain();
  addEventListener('hashchange', render);
  addEventListener('languagechange', () => {
    const scroll = window.scrollY;
    const focus = document.activeElement;
    const lyric = $('#now-lyric');
    // Translate player status messages, but keep timed lyrics verbatim.
    if (lyricIndex < 0) lyric.textContent = tr(window.SiteLanguage.source(lyric.textContent));
    syncPlayerLabels();
    renderNavigation(); buildSearchIndex(); render({ languageOnly: true });
    dock.refreshLanguage();
    window.scrollTo(0, scroll);
    if (focus?.isConnected) focus.focus({ preventScroll: true });
  });
  $('#now-lyric').textContent = tr('等待播放');
  render();
})();
