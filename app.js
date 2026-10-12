/* app.js — 纯静态站点：视图、检索、播放器
   内容 = content.auto.js（自动扫描 content/ 与 assets/）+ content.js（手工条目，同 id 优先）
   排序 = 先热度（front matter 的热力值 / 作品用 GitHub 星数快照）后时间
   检索 = 底部常驻命令行（全站含正文）
   阅读页 = 简约版式；索引页 = 仿 okmij.org Index 的三栏密集链接
   没有留言、点赞、友链申请：整站静态，互动层已移除。 */
(() => {
  'use strict';
  const A = window.AUTO || {};
  const S = window.SITE || {};
  const R = window.Render || {
    escape: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    md: (s) => `<p>${String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
    sanitizeHtml: (s) => String(s ?? ''),
    renderFile: (f) => `<p>${String(f.body ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>`,
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
  const fmt = (d) => String(d || '').slice(0, 10);
  const fmtCn = (d) => { const m = fmt(d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : fmt(d); };
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  const testBadge = (it) => (it && it.test ? '<span class="badge" title="测试样例：检查完可以删掉对应文件">测试样例</span>' : '');
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
    return `${cut}…`;
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

  /* ------------------------------------------------------------------ 检索索引 */
  let searchIndex = [];
  function buildSearchIndex() {
    const push = (kind, label, item, route, extra = '') => {
      if (!item) return;
      searchIndex.push({
        kind, label, route,
        title: item.title || item.name || '',
        date: fmt(item.date),
        text: plain([item.summary, item.abstract, item.description, item.body, item.caption, item.location, (item.tags || []).join(' '), item.authors, item.venue, extra].filter(Boolean).join(' \n ')),
      });
    };
    searchIndex = [];
    for (const [id, label] of sections) searchIndex.push({ kind: 'page', label: '页面', route: `#${id}`, title: label, date: '', text: descriptions[id] || '' });
    for (const a of C.articles) push('article', '文章', a, `#articles/${encodeURIComponent(a.id)}`);
    for (const a of C.assertions) push('assertion', '断言', { ...a, title: assertionLabel(a, 42) }, `#assertions/${encodeURIComponent(a.id)}`);
    for (const p of C.papers) push('paper', '学术', p, `#academic/${encodeURIComponent(p.id)}`);
    for (const p of C.photos) push('photo', '摄影', p, `#photography/${encodeURIComponent(p.id)}`);
    for (const t of C.tracks) push('track', '音乐', t, `#music/${encodeURIComponent(t.id)}`, t.artist || '');
    for (const f of C.friends) push('friend', '友链', f, '#friends', f.url || '');
    searchIndex.push({ kind: 'page', label: '页面', route: '#about', title: '关于本站', date: '', text: '站点说明 建站天数 内容数量 订阅 RSS Atom 访客' });
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
      try { out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (s) => `<mark>${s}</mark>`); } catch { /* 忽略 */ }
    }
    return out;
  }

  /* ------------------------------------------------------------------ 底部命令行检索条 */
  const dock = {
    input: $('#dock-input'), results: $('#dock-results'),
    hits: [], cursor: -1, baseHash: '',
    render(q) {
      const hits = search(q);
      dock.hits = hits;
      dock.cursor = hits.length ? 0 : -1;
      if (!q.trim()) { dock.results.hidden = true; return; }
      dock.results.hidden = false;
      const prefix = (q.match(/^((?:[a-z]+|文章|断言|学术|论文|摄影|照片|音乐|友链|页面)[:：])/i) || [])[1] || '';
      dock.results.innerHTML = hits.length
        ? `<div class="dock-hits" role="listbox">${hits.map((h, i) => `<button class="dock-hit" role="option" data-hit="${i}" aria-selected="${i === dock.cursor}">
            <span class="n">${String(i + 1).padStart(3, '0')}</span><span class="kind">${esc(h.label)}</span>
            <span class="tt">${markTerms(h.title, q.slice(prefix.length))}</span><span class="snip">${markTerms(h.snip, q.slice(prefix.length))}</span><span class="date">${esc(h.date)}</span>
          </button>`).join('')}</div>`
        : `<p class="dock-empty">没有匹配「${esc(q)}」的内容。试试：文章: 关键词 · 摄影: 山 · work: blog</p>`;
    },
    select(i) {
      if (!dock.hits.length) return;
      dock.cursor = (i + dock.hits.length) % dock.hits.length;
      $$('.dock-hit').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.hit) === dock.cursor)));
      const el = $(`.dock-hit[data-hit="${dock.cursor}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    },
    open(i = dock.cursor) {
      const hit = dock.hits[i];
      if (!hit) return;
      dock.results.hidden = true;
      dock.hits = [];
      dock.input.value = '';
      dock.input.blur();
      if (hit.route === location.hash) render();
      else location.hash = hit.route;
    },
    close(keepHash) {
      dock.results.hidden = true;
      dock.hits = [];
      if (!keepHash && location.hash.startsWith('#search/')) location.hash = dock.baseHash || '#home';
    },
  };
  let dockTimer = 0;
  function dockSync() {
    const q = dock.input.value;
    if (!location.hash.startsWith('#search/')) dock.baseHash = location.hash;
    dock.render(q);
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => {
      if (q.trim()) history.replaceState(null, '', `#search/${encodeURIComponent(q)}`);
      else if (location.hash.startsWith('#search/')) history.replaceState(null, '', dock.baseHash || '#home');
    }, 500);
  }
  dock.input.addEventListener('input', dockSync);
  dock.input.addEventListener('focus', () => { if (!location.hash.startsWith('#search/')) dock.baseHash = location.hash; if (dock.input.value.trim()) dock.render(dock.input.value); });
  dock.input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); dock.select(dock.cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); dock.select(dock.cursor - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); dock.open(); }
    else if (e.key === 'Escape') { dock.input.value = ''; dock.close(); dock.input.blur(); }
  });
  dock.results.addEventListener('click', (e) => { const b = e.target.closest('[data-hit]'); if (b) dock.open(Number(b.dataset.hit)); });
  $('#dock').addEventListener('submit', (e) => { e.preventDefault(); dock.open(); });
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    if (typing) return;
    if (e.key === '/' || e.key === '>') { e.preventDefault(); dock.baseHash = location.hash.startsWith('#search/') ? dock.baseHash : location.hash; dock.input.focus(); }
    else if (e.key === 'Escape' && !dock.results.hidden) dock.close();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#dock') && document.activeElement === dock.input && !dock.input.value.trim()) dock.close();
  });

  /* ------------------------------------------------------------------ 视图 */
  const head = (id, title) => `<div class="eyebrow"><span>PERSONAL INDEX / ${(sections.find((x) => x[0] === id) || [, , 'READING'])[2].toUpperCase()}</span><span>x1shang / ${new Date().getFullYear()}</span></div><h1 class="page-title">${esc(title)}</h1><p class="lead">${descriptions[id] || ''}</p>`;
  const empty = (title, text = '新的内容会慢慢出现在这里。') => `<div class="empty"><b>${title}</b>${text}</div>`;
  const runLink = (href, label, extra = '') => `<a href="${safe(href)}"${extra}>${esc(label)}</a>`;
  const joinRun = (rows, fallback) => rows.length ? rows.join('<span class="dot">·</span>') : `<span class="meta">${fallback}</span>`;

  /* 音乐：本地音频用仓库里的文件；只写了网易云 ID 的曲目走公开外链
     （music.163.com/song/media/outer/url?id=<ID>.mp3，302 到 CDN，浏览器会自动把 http 目标升级成 https）。
     能不能播是 tools/fetch-netease.mjs 在构建期探好的：playable === false 就是网易云不给直链。 */
  const neteaseOuter = (id) => `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(String(id).trim())}.mp3`;
  const trackSrc = (t) => (t && (t.src || (t.netease && t.playable !== false ? neteaseOuter(t.netease) : ''))) || '';

  /* 分享：国内社媒（微信/QQ/小红书/微博正文）基本不读 OG 卡片，所以不走"分享到 X"那套，
     只做一件事——点一下把「标题 + 链接」复制到剪贴板，用户自己粘。文章与论文的详情页末尾各一个。
     站内 SPA 与预渲染的真实路径页共用这段逻辑（预渲染页也会被 app.js 接管）。 */
  function shareBar(kind, id) {
    const it = (kind === 'academic' ? C.papers : C.articles).find((x) => String(x.id) === id);
    if (!it) return '';
    const dir = kind === 'academic' ? 'academic' : 'articles';
    const base = ((A.site && A.site.url) || location.origin).replace(/\/$/, '');
    const url = `${base}/${dir}/${encodeURIComponent(id)}/`;
    return `<div class="share" data-share data-title="${esc(it.title || id)}" data-url="${esc(url)}">
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
    const text = `${box.dataset.title}\n${box.dataset.url}`;
    const ok = await copyText(text);
    if (!btn) return;
    btn.textContent = ok ? '已复制 ✓' : '复制失败，请手动选择';
    btn.classList.toggle('is-done', ok);
    clearTimeout(btn._shareTimer);
    btn._shareTimer = setTimeout(() => { btn.textContent = '复制标题与链接'; btn.classList.remove('is-done'); }, 1800);
  }

  /* 首页：仿 okmij.org Index —— 三栏密集链接 */
  function home() {
    const articles = [...C.articles].sort(byHeatThenTime);
    const papers = [...C.papers].sort(byHeatThenTime);
    const assertions = [...C.assertions].sort(byHeatThenTime);
    const photos = [...C.photos].sort(byHeatThenTime);
    const tracks = [...C.tracks].sort(byHeatThenTime);
    const friends = [...C.friends].sort(byHeatThenTime);
    const cat = (title, rows, opts = {}) => `<section class="idx-cat${opts.short ? ' short' : ''}"><h3>${esc(title)}</h3><p class="idx-run">${rows}</p>${opts.note ? `<p class="idx-sub">${opts.note}</p>` : ''}${opts.more ? `<p class="idx-more">${opts.more}</p>` : ''}</section>`;

    const shortcuts = [
      ['#articles', '文章'], ['#assertions', '断言'], ['#academic', '学术'],
      ['#photography', '摄影'], ['#music', '音乐'], ['#friends', '友链'], ['#about', '关于'],
    ].map(([h, l]) => runLink(h, l));
    shortcuts.splice(3, 0, `<a href="${WORKS_URL}" target="_blank" rel="noopener noreferrer">作品</a>`);
    shortcuts.push('<a href="feed.xml" type="application/rss+xml">RSS</a>', '<a href="atom.xml" type="application/atom+xml">Atom</a>',
      `<a href="https://github.com/${encodeURIComponent(S.github)}" target="_blank" rel="noopener noreferrer">GitHub</a>`);

    /* 动态：全站最新的三条「非测试样例」更新（文章 / 断言 / 学术 / 摄影 / 音乐） */
    const UPD_KIND = { article: '文章', assertion: '断言', paper: '学术', photo: '摄影', track: '音乐' };
    const updates = [
      ...C.articles.map((x) => ['article', x, `#articles/${encodeURIComponent(x.id)}`]),
      ...C.assertions.map((x) => ['assertion', x, `#assertions/${encodeURIComponent(x.id)}`]),
      ...C.papers.map((x) => ['paper', x, `#academic/${encodeURIComponent(x.id)}`]),
      ...C.photos.map((x) => ['photo', x, `#photography/${encodeURIComponent(x.id)}`]),
      ...C.tracks.map((x) => ['track', x, `#music/${encodeURIComponent(x.id)}`]),
    ]
      .filter(([, it]) => !it.test && fmt(it.date))
      .sort((a, b) => fmt(b[1].date).localeCompare(fmt(a[1].date)))
      .slice(0, 3);
    const updateRow = ([kind, it, href]) =>
      `${runLink(href, it.title || it.location || assertionLabel(it, 24) || '未命名')}<span class="meta">${UPD_KIND[kind]} · ${esc(fmt(it.date))}</span>`;

    const col1 = [
      cat('快捷入口', joinRun(shortcuts, '—'), { short: true }),
      cat('动态', updates.length
        ? joinRun(updates.map(updateRow), '—')
        : '<span class="meta">还没有更新：新发布的内容会自动出现在这里。</span>',
        { short: true, note: updates.length ? '最近三条 · 不含测试样例' : '' }),
      cat('学术', joinRun(papers.map((p) => runLink(`#academic/${encodeURIComponent(p.id)}`, p.title)), '论文列表还是空的：把 .md/.tex 丢进 content/papers/ 就行'),
        { note: papers.length ? `${papers.length} 篇` : '' }),
      cat('摄影', joinRun(photos.slice(0, 24).map((p) => runLink(`#photography/${encodeURIComponent(p.id)}`, p.title || p.location || '照片')), '还没有照片：丢进 inbox/photos/'),
        { note: photos.length ? `${photos.length} 张 / 自动压缩为 WebP` : '' }),
      cat('音乐', joinRun(tracks.map((t) => runLink(`#music/${encodeURIComponent(t.id)}`, t.title)), '还没有音乐：把音频放进 assets/music/')),
    ].join('');

    const col2 = [
      cat('文章', joinRun(articles.map((a) => runLink(`#articles/${encodeURIComponent(a.id)}`, a.title)), '还没有文章：把 .md 丢进 content/articles/'),
        { note: articles.length ? `${articles.length} 篇` : '', more: articles.length ? '<a href="#articles">全部文章 →</a>' : '' }),
      cat('断言', joinRun(assertions.slice(0, 18).map((a) => runLink(`#assertions/${encodeURIComponent(a.id)}`, assertionLabel(a, 26))), '还没有断言：把短句丢进 content/assertions/'),
        { note: assertions.length ? `${assertions.length} 则` : '', more: assertions.length ? '<a href="#assertions">全部断言 →</a>' : '' }),
      cat('友链', joinRun(friends.map((f) => `<a href="${safe(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`), '还没有友链：写进 content/friends/'),
        { more: '<a href="#friends">友链 →</a>' }),
    ].join('');

    const col3 = [
      cat('作品', `<a href="${WORKS_URL}" target="_blank" rel="noopener noreferrer">导航页</a>`,
        { note: '作品与磁贴入口都在站外的导航页' }),
      cat('索引与元信息', joinRun([runLink('#about', '关于本站'), `<a href="#search/%E7%89%A9%E7%90%86">检索「物理」</a>`], '—'),
        { short: true, note: '按 / 或 &gt; 聚焦底部命令行检索' }),
      cat('关于', `<span class="meta">${esc(S.intro || '')}</span>`, { short: true }),
    ].join('');

    return `<div class="idx-head">
        <h1 class="idx-title">Index</h1>
        <p class="idx-note">除非另有说明，本站的文字、照片与代码均由作者维护。内容按<b>热度</b>在前、<b>时间</b>在后排列。</p>
        <p class="idx-recent"><b>最近更新：</b> ${esc(fmtCn(newestDate()))}<span class="sep">|</span><a href="feed.xml">RSS</a><span class="sep">|</span><a href="atom.xml">Atom</a></p>
      </div>
      <div class="idx-columns"><div class="idx-col">${col1}</div><div class="idx-col">${col2}</div><div class="idx-col">${col3}</div></div>
      <p class="idx-foot">共 ${C.articles.length} 篇文章 · ${C.assertions.length} 则断言 · ${C.papers.length} 篇论文 · ${C.photos.length} 张照片 · ${C.tracks.length} 首音乐 · ${C.friends.length} 个友链${C.generated ? ` · 内容包生成于 ${esc(fmt(C.generated))}` : ''}</p>`;
  }

  /* 板块列表：密集索引行 */
  function idxList(items, rowFn, opts = {}) {
    if (!items.length) return empty(opts.emptyTitle || '这里还空着', opts.emptyText);
    return `<ol class="idx-list">${items.map((it, i) => `<li class="idx-item${it.test ? ' is-test' : ''}">
      <span class="rank">${String(i + 1).padStart(2, '0')}</span><span class="tt">${rowFn(it, i)}</span>
      ${opts.sub ? `<span class="sub">${opts.sub(it)}</span>` : ''}
      <span class="date">${esc(fmt(it.date))}</span>
    </li>`).join('')}</ol>`;
  }

  function academicList() {
    const papers = [...C.papers].sort(byHeatThenTime);
    return head('academic', '学术') + idxList(papers, (p) => `<a href="#academic/${encodeURIComponent(p.id)}">${esc(p.title)}</a>${testBadge(p)}`,
      { sub: (p) => [p.authors, p.venue].filter(Boolean).map(esc).join(' · '), emptyTitle: '研究记录，待续', emptyText: '把 .md / .tex 丢进 content/papers/ 就会出现在这里。' });
  }

  function academicDetail(id) {
    const p = C.papers.find((x) => String(x.id) === id);
    if (!p) return empty('论文未找到', '<a href="#academic">返回学术列表</a>');
    return `<a class="backlink" href="#academic">← 学术</a>
      <div class="reading-head"><h1>${esc(p.title)}</h1>${testBadge(p)}
      <div class="reading-meta"><span>${esc(fmt(p.date))}</span>${p.authors ? `<span>${esc(p.authors)}</span>` : ''}${p.venue ? `<span>${esc(p.venue)}</span>` : ''}${p.url ? `<span><a href="${safe(p.url)}" target="_blank" rel="noopener noreferrer">原文 ↗</a></span>` : ''}${p.file ? `<span>${esc(p.file)}</span>` : ''}</div></div>
      ${p.abstract ? `<p class="lead">${esc(p.abstract)}</p>` : ''}
      <article class="prose" data-format="${esc(p.format || 'md')}">${p.body ? R.renderFile({ format: p.format, body: p.body }) : '<p class="meta">这条记录没有正文，只有上面的信息。</p>'}</article>`;
  }

  function articlesList() {
    const list = [...C.articles].sort(byHeatThenTime);
    return head('articles', '文章') + idxList(list, (a) => `<a href="#articles/${encodeURIComponent(a.id)}">${esc(a.title)}</a>${testBadge(a)}`,
      { sub: (a) => [...(a.tags || []).map((t) => '#' + t), a.summary].filter(Boolean).join(' '), emptyTitle: '还没有文章', emptyText: '把 .md / .html / .tex / .txt 丢进 content/articles/，刷新即可。' });
  }

  function articlesDetail(id) {
    const a = C.articles.find((x) => String(x.id) === id);
    if (!a) return empty('文章未找到', '<a href="#articles">返回文章列表</a>');
    return `<a class="backlink" href="#articles">← 所有文章</a>
      <div class="reading-head"><h1>${esc(a.title)}</h1>${testBadge(a)}
      <div class="reading-meta"><span>${esc(fmt(a.date))}</span>${(a.tags || []).map((t) => `<span>#${esc(t)}</span>`).join('')}<span>${esc(a.format || 'md')}</span>${a.file ? `<span>${esc(a.file)}</span>` : ''}</div></div>
      <article class="prose" data-format="${esc(a.format || 'md')}">${R.renderFile({ format: a.format, body: a.body })}</article>`;
  }

  function assertionsList() {
    const list = [...C.assertions].sort(byHeatThenTime);
    if (!list.length) return head('assertions', '断言') + empty('等待下一个念头', '把短句丢进 content/assertions/，一个文件一则。');
    return head('assertions', '断言') + list.map((a) => `<article class="idx-item${a.test ? ' is-test' : ''}" style="display:block">
        <div class="reading-meta"><span>${esc(fmt(a.date))}</span>${(a.tags || []).map((t) => `<span>#${esc(t)}</span>`).join('')}${a.test ? testBadge(a) : ''}</div>
        <div class="prose" style="margin:10px 0 0">${R.renderFile({ format: a.format, body: a.body })}</div>
      </article>`).join('');
  }

  function assertionDetail(id) {
    const a = C.assertions.find((x) => String(x.id) === id);
    if (!a) return empty('断言未找到', '<a href="#assertions">返回断言列表</a>');
    return `<a class="backlink" href="#assertions">← 断言</a>
      <div class="reading-head"><h1>${esc(assertionLabel(a, 46) || '断言')}</h1>${testBadge(a)}
      <div class="reading-meta"><span>${esc(fmt(a.date))}</span>${(a.tags || []).map((t) => `<span>#${esc(t)}</span>`).join('')}</div></div>
      <article class="prose" data-format="${esc(a.format || 'md')}">${R.renderFile({ format: a.format, body: a.body })}</article>`;
  }

  function worksPage() {
    return head('works', '作品')
      + `<p class="note">作品都在站外的导航页：<a href="${WORKS_URL}" target="_blank" rel="noopener noreferrer">导航页</a>（磁贴入口 + 作品区都在那边）。</p>`;
  }

  function photographyPage(detail) {
    if (!C.photos.length) return head('photography', '摄影') + empty('留一个位置，给下一束光', '把照片拖进 <code>inbox/photos/</code>，流水线会自动压缩成 WebP（该目录已 gitignore）。');
    const list = [...C.photos].sort(byHeatThenTime);
    return head('photography', '摄影') + `<div class="photo-grid">${list.map((p) => `<figure class="photo" id="photo-${esc(p.id)}" style="margin:0">
        <button class="shot" data-photo="${esc(p.id)}" aria-label="放大：${esc(p.title || '照片')}"><img loading="lazy" src="${safe(p.thumb || p.src)}" alt="${esc(p.title || '')}"></button>
        <figcaption class="cap"><span>${esc(p.title || '')}${testBadge(p)}</span><span class="meta">${esc(p.location || '')}</span><span class="date">${esc(fmt(p.date))}</span></figcaption>
      </figure>`).join('')}</div>
      <p class="note">照片来自 <code>inbox/photos/</code>（原始文件不入库），构建时自动旋转、压缩并转成 WebP。</p>`;
  }

  function musicPage(detail) {
    const list = [...C.tracks].sort(byHeatThenTime);
    const rows = list.length ? list.map((t, i) => {
      const src = trackSrc(t);
      const sub = [t.artist, t.album].filter(Boolean).join(' · ');
      const note = [sub, t.netease ? (t.playable === false ? '网易云 · 无直链（VIP / 独家 / 无版权）' : '网易云外链') : '', t.test ? '测试样例' : ''].filter(Boolean).join(' · ');
      return `<div class="idx-item${t.test ? ' is-test' : ''}" id="track-${esc(t.id)}">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <button class="track" data-track="${esc(t.id)}" style="flex:1;border:0;padding:0"><span><strong>${esc(t.title)}</strong><small>${esc(note)}</small></span><span class="track-play">${src ? '播放 ↗' : '暂无音频'}</span></button>
        <span class="date">${esc(fmt(t.date))}</span></div>`;
    }).join('')
      : empty('歌单，正在酝酿', '把音频放进 <code>assets/music/</code>，或放一个只写 <code>netease: &lt;歌曲ID&gt;</code> 的 .md。');
    return head('music', '音乐') + rows + '<div id="lyrics" class="lyrics" aria-label="同步歌词"></div>';
  }

  function friendsPage() {
    const list = [...C.friends].sort(byHeatThenTime);
    const rows = list.length ? idxList(list, (f) => `<a href="${safe(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)} ↗</a>${testBadge(f)}`,
      { sub: (f) => esc(f.description || host(f.url)) })
      : empty('期待在这里，遇见同路人');
    return head('friends', '友链') + rows
      + '<p class="note">友链是站内写定的静态清单（<code>content/friends/</code>）；本站不收在线申请。</p>';
  }

  function aboutPage() {
    const days = Math.max(1, Math.floor((Date.now() - new Date(`${S.since}T00:00:00+08:00`)) / 86400000) + 1);
    const stats = [[days, '建站天数'], [C.articles.length + C.assertions.length + C.papers.length, '文字记录'], [C.photos.length, '摄影作品'], [C.tracks.length, '音乐'], [C.friends.length, '友链']];
    return head('about', '关于')
      + `<div class="stats">${stats.map(([n, label]) => `<div class="stat glass"><strong>${n}</strong><span>${label}</span></div>`).join('')}</div>`
      + (C.about ? `<article class="prose" style="margin-top:32px">${R.renderFile({ format: 'md', body: C.about })}</article>` : '')
      + `<article class="row" style="margin-top:28px"><h3>这座小站怎么运转</h3>
          <p>整站是纯静态的 HTML / CSS / JavaScript：文字丢进 <code>content/</code>（文章 / 断言 / 学术 / 友链）、照片丢进 <code>inbox/photos/</code>、音乐丢进 <code>assets/music/</code>，跑一次构建就编入索引。照片目录已被 gitignore，只有压缩后的 WebP 会进仓库。</p>
          <p>页面底部常驻一条命令行检索：按 <kbd>/</kbd> 或 <kbd>&gt;</kbd> 聚焦，↑↓ 选择，Enter 打开。文章、断言与论文正文用简约阅读版式，公式由 KaTeX 渲染。</p>
        </article>
        <article class="row"><h3>订阅与统计</h3><p><a href="feed.xml">RSS</a> · <a href="atom.xml">Atom</a> · 内容数量来自站内数据，建站天数按设定日期计算。</p></article>
        <article class="row"><h3>访客</h3>
          <div class="visits" id="visits" data-state="loading"><p class="note">正在读取访客数据…</p></div>
          <p class="note">图表只读站内的静态快照 <code>stats.json</code>（由 <code>tools/fetch-stats.mjs</code> 刷新）；访客的浏览器不会为这张图请求任何统计服务。</p>
        </article>`;
  }

  /** 关于页最下方：访客量图（只读同目录的 stats.json；拿不到就安静降级，不留破图） */
  async function hydrateVisits() {
    const box = document.getElementById('visits');
    if (!box) return;
    let data = null;
    try {
      const res = await fetch('stats.json', { cache: 'no-store' });
      if (res.ok) data = await res.json();
    } catch { /* file:// 或断网：保持安静 */ }
    const raw = data && Array.isArray(data.series) ? data.series : [];
    const series = raw.filter((x) => x && typeof x.n === 'number' && x.d).slice(-30);
    if (!series.length) {
      box.dataset.state = 'empty';
      box.innerHTML = raw.length || data
        ? '<p class="note">统计刚上线，数据还在积累。</p>'
        : '<p class="note">还没有统计数据（本地 <code>file://</code> 预览下不显示）。</p>';
      return;
    }
    const W = 640, H = 170, T = 12, B = 26, L = 6, R = 6;
    const max = Math.max(1, ...series.map((x) => x.n));
    const bw = (W - L - R) / series.length;
    const bars = series.map((x, i) => {
      const h = Math.round((H - T - B) * (x.n / max));
      const bx = L + i * bw + bw * 0.18, by = H - B - h;
      return `<rect class="vb" x="${bx.toFixed(1)}" y="${by}" width="${Math.max(1.2, bw * 0.64).toFixed(1)}" height="${Math.max(1, h)}" rx="1.6"><title>${esc(x.d)}：${x.n} 位访客</title></rect>`;
    }).join('');
    const total = Number(data.total || series.reduce((s, x) => s + x.n, 0));
    const updated = data.updated ? String(data.updated).slice(0, 10) : '';
    const first = series[0].d, last = series[series.length - 1].d;
    box.dataset.state = 'ready';
    box.innerHTML = `
      <p class="visits-total"><strong>${total}</strong><span>近 ${series.length} 天访客</span>${data.allTime ? `<span class="visits-all">累计 ${data.allTime}</span>` : ''}</p>
      <svg class="visits-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${series.length} 天每日访客数">
        <line class="vaxis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"></line>
        <text class="vmax" x="${L}" y="${T - 1}">${max}</text>
        ${bars}
        <text class="vlabel" x="${L}" y="${H - 8}">${esc(first)}</text>
        <text class="vlabel" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(last)}</text>
      </svg>
      ${updated ? `<p class="note">更新于 ${esc(updated)}${data.site ? ` · 数据源 <a href="${safe(data.site)}" target="_blank" rel="noopener noreferrer">GoatCounter</a>` : ''}</p>` : ''}`;
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
    try { return `${m[1]}/${decodeURIComponent(m[2])}`; } catch { return `${m[1]}/${m[2]}`; }
  }

  /**
   * 访客统计补报：GoatCounter 按 location.pathname 记账，哈希路由（#articles/x）原本全算在 / 上。
   * 因此站内跳转到文章 / 断言 / 论文时手工补一条真实路径的 pageview；直接从真实路径进来的
   * 那一次由 count.js 自己记，不重复补报。
   */
  function trackVisit(route, detail) {
    const gc = window.goatcounter;
    if (!gc || typeof gc.count !== 'function' || !detail || !DETAIL_KIND[route]) return;
    try { gc.count({ path: `/${route}/${encodeURIComponent(detail)}/` }); } catch { /* 统计失败不影响阅读 */ }
  }

  function render() {
    const fromPath = routeFromPath();
    const raw = location.hash.slice(1) || fromPath;
    const [route, ...rest] = raw.split('/');
    let detail = ''; try { detail = decodeURIComponent(rest.join('/')); } catch { detail = rest.join('/'); }
    if (detail && !(fromPath && fromPath === raw)) trackVisit(route, detail);
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
    document.title = `${title} · x1shang`;

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
        const idx = C.tracks.findIndex((t) => String(t.id) === detail);
        if (idx >= 0 && audio.dataset.track !== detail) startTrack(idx);
      }
    }
    if (currentPage === 'photography' && detail) openPhoto(detail);
    if (currentPage === 'home') {
      alignMountain();
      if (location.hash === '#content') requestAnimationFrame(() => $('#content').scrollIntoView());
      else window.scrollTo(0, 0);
    } else window.scrollTo(0, 0);
    if (!reading) $('#main').focus({ preventScroll: true });
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
      const t = C.tracks.find((x) => String(x.id) === track.dataset.track);
      if (t && t.src) { location.hash = `#music/${encodeURIComponent(t.id)}`; startTrack(C.tracks.indexOf(t)); }
      return;
    }
    if (e.target.closest('#next-track') && C.tracks.length) { startTrack((activeTrack + 1) % C.tracks.length); }
  });

  /* ------------------------------------------------------------------ 照片弹窗 */
  function openPhoto(id) {
    const p = C.photos.find((x) => String(x.id) === id);
    if (!p) return;
    $('#large-photo').src = p.src;
    $('#large-photo').alt = p.title || '';
    $('#photo-caption').textContent = [p.title, p.location, fmt(p.date), p.caption].filter(Boolean).join(' · ');
    const dialog = $('#photo-dialog');
    if (!dialog.open) dialog.showModal();
  }
  $('#close-photo').onclick = () => $('#photo-dialog').close();
  $('#photo-dialog').addEventListener('click', (e) => { if (e.target === $('#photo-dialog')) e.target.close(); });

  /* ------------------------------------------------------------------ 音乐播放器 */
  let activeTrack = -1, timedLyrics = [], lyricIndex = -1, failStreak = 0;
  const audio = $('#audio');
  function parseLrc(source) {
    const rows = [];
    String(source || '').split('\n').forEach((line) => {
      const text = line.replace(/\[.*?\]/g, '').trim();
      for (const m of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) rows.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
    });
    return rows.sort((a, b) => a.time - b.time);
  }
  function renderLyrics() {
    const box = $('#lyrics'); if (!box) return;
    box.innerHTML = timedLyrics.length ? timedLyrics.map((l, i) => `<div class="lyric" data-lyric="${i}">${esc(l.text)}</div>`).join('')
      : `<p class="meta">${activeTrack < 0 ? '选择一首曲目，旋律从这里开始。' : '这首还没有歌词（同名 .lrc 会自动读取）。'}</p>`;
    lyricIndex = -1;
  }
  async function play() { try { await audio.play(); } catch { $('#now-lyric').textContent = '无法播放，请检查音频地址后重试'; } }
  function startTrack(index) {
    activeTrack = index;
    const t = C.tracks[index];
    const src = trackSrc(t);
    if (!t || !src) return;
    audio.src = src;
    audio.dataset.track = String(t.id);
    timedLyrics = parseLrc(t.lyrics);
    $('#player').hidden = false;
    $('#now-title').textContent = `${t.title}${t.artist ? ' · ' + t.artist : ''}`;
    const cover = $('#now-cover');
    if (cover) {
      if (t.cover) { cover.src = t.cover; cover.hidden = false; }
      else { cover.hidden = true; cover.removeAttribute('src'); }
    }
    $('#now-lyric').textContent = '正在加载…';
    renderLyrics(); play();
  }
  const timeText = (n) => `${Math.floor((Number.isFinite(n) ? n : 0) / 60)}:${String(Math.floor((Number.isFinite(n) ? n : 0) % 60)).padStart(2, '0')}`;
  function updateTime() {
    const duration = audio.duration;
    $('#time').textContent = `${timeText(audio.currentTime)} / ${timeText(duration)}`;
    $('#seek').value = duration ? (audio.currentTime / duration) * 100 : 0;
    let i = -1;
    timedLyrics.forEach((l, k) => { if (l.time <= audio.currentTime) i = k; });
    if (i !== lyricIndex) {
      lyricIndex = i;
      $('#now-lyric').textContent = (timedLyrics[i] && timedLyrics[i].text) || '♪';
      $$('.lyric').forEach((el, k) => el.classList.toggle('current', k === i));
      const el = $(`[data-lyric="${i}"]`), box = $('#lyrics');
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
  audio.addEventListener('play', () => { $('#play-toggle').textContent = 'Ⅱ'; $('#play-toggle').setAttribute('aria-label', '暂停'); });
  audio.addEventListener('playing', () => { failStreak = 0; });
  audio.addEventListener('pause', () => { $('#play-toggle').textContent = '▶'; $('#play-toggle').setAttribute('aria-label', '播放'); });
  audio.addEventListener('error', () => {
    const t = C.tracks[activeTrack];
    if (t && t.netease) {
      // 网易云对 VIP / 独家 / 无版权曲目不签发直链（302 到 music.163.com/404）→ 提示并顺延，最多绕一圈
      $('#now-lyric').textContent = '网易云没给这首歌直链（VIP / 独家 / 无版权），换下一首';
      if (failStreak < C.tracks.length - 1) { failStreak++; setTimeout(() => startTrack((activeTrack + 1) % C.tracks.length), 1600); }
    } else {
      $('#now-lyric').textContent = '音频无法加载，请检查文件或链接';
    }
  });
  audio.addEventListener('ended', () => { if (C.tracks.length) startTrack((activeTrack + 1) % C.tracks.length); });
  $('#play-toggle').onclick = () => (audio.paused ? play() : audio.pause());
  $('#close-player').onclick = () => { audio.pause(); $('#player').hidden = true; };
  $('#seek').oninput = (e) => { if (Number.isFinite(audio.duration)) audio.currentTime = (Number(e.target.value) / 100) * audio.duration; };

  /* ------------------------------------------------------------------ 首页细节 */
  function alignMountain() {
    const box = $('.landscape'); if (!box) return;
    const rect = box.getBoundingClientRect(), scale = Math.max(rect.width / 1607, rect.height / 1080), dx = (rect.width - 1607 * scale) / 2, dy = (rect.height - 1080 * scale) / 2;
    const ridge = [[0, 606], [28, 590], [53, 555], [77, 520], [110, 502], [138, 509], [160, 541], [181, 561], [224, 590], [268, 582], [300, 571], [323, 554], [348, 523], [367, 552], [389, 591], [403, 583], [421, 610], [448, 590], [469, 616], [490, 627], [513, 644], [530, 640], [541, 660], [567, 629], [598, 584], [635, 542], [670, 501], [689, 479], [703, 453], [719, 440], [745, 406], [768, 379], [795, 342], [821, 308], [847, 273], [877, 239], [897, 252], [915, 264], [932, 292], [949, 318], [962, 345], [980, 367], [995, 391], [1012, 414], [1040, 438], [1083, 453], [1118, 471], [1138, 467], [1145, 453], [1155, 476], [1187, 493], [1201, 509], [1225, 511], [1238, 529], [1255, 525], [1277, 508], [1293, 516], [1307, 535], [1336, 550], [1368, 568], [1385, 612], [1400, 633], [1413, 637], [1428, 657], [1441, 637], [1473, 633], [1498, 629], [1514, 639], [1540, 646], [1563, 674], [1607, 702], [1607, 1080], [0, 1080]];
    const fg = $('.foreground');
    if (fg) fg.style.clipPath = `polygon(${ridge.map(([x, y]) => `${(x * scale + dx).toFixed(2)}px ${(y * scale + dy).toFixed(2)}px`).join(',')})`;
  }
  addEventListener('resize', alignMountain);
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    document.documentElement.style.setProperty('--x', `${e.clientX}px`);
    document.documentElement.style.setProperty('--y', `${e.clientY}px`);
  });
  function clock() { $('#local-clock').textContent = `${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })} / UTC+8`; }

  /* ------------------------------------------------------------------ 启动 */
  $('#year').textContent = new Date().getFullYear();
  $('#profile-github').href = `https://github.com/${encodeURIComponent(S.github)}`;
  $('#navigation').innerHTML = NAV.map(([id, label], i) => (id === '__works'
    ? `<a class="is-out" href="${WORKS_URL}" target="_blank" rel="noopener noreferrer"><span>${String(i + 1).padStart(2, '0')}</span>${label}</a>`
    : `<a href="#${id}" data-page="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${label}</a>`)).join('');
  clock(); setInterval(clock, 60000);
  buildSearchIndex();
  alignMountain();
  addEventListener('hashchange', render);
  render();
})();
