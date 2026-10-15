/* 页面内的导航命令解释器；所有命令只操作本站 UI。 */
window.createSiteDock = ({ search, esc, markTerms, entries, path, navigate }) => {
  const { t: tr, ui } = window.SiteLanguage;
  const form = document.querySelector('#dock');
  const toggle = document.querySelector('#command-toggle');
  const hint = document.querySelector('#dock-hint');
  const tips = (window.AUTO?.tips || []).filter(t => typeof t === 'string' && t.trim());
  let tipIndex = -1;
  function rotateTip() {
    if (!hint) return;
    if (!tips.length) { hint.textContent = ''; return; }
    const choices = tips.map((_, i) => i).filter(i => tips.length === 1 || i !== tipIndex);
    tipIndex = choices[Math.floor(Math.random() * choices.length)];
    hint.textContent = tips[tipIndex]; hint.title = tips[tipIndex];
  }
  rotateTip();
  if (tips.length > 1) setInterval(rotateTip, 30000);
  const searchPlaceholder = () => tr('全站检索：标题 / 正文 / 标签 / 照片 / 音乐 / 友链…');
  const aliases = { h: 'home', home: 'home', index: 'home', 主页: 'home', a: 'articles', articles: 'articles', 文章: 'articles', academic: 'academic', papers: 'academic', 学术: 'academic', t: 'assertions', thoughts: 'assertions', assertions: 'assertions', 断言: 'assertions', p: 'photography', photos: 'photography', photography: 'photography', 摄影: 'photography', m: 'music', music: 'music', 音乐: 'music', f: 'friends', friends: 'friends', 友链: 'friends', about: 'about', 关于: 'about', w: 'works', works: 'works', 作品: 'works' };
  const commands = ['help', 'ls', 'dir', 'Get-ChildItem', 'cd', 'Set-Location', 'pwd', 'Get-Location', 'open', 'start', 'Invoke-Item', 'goto', 'find', 'grep', 'Select-String', 'random', 'theme', 'j', 'k', 'gg', 'G', 'g h', 'g a', 'back', 'forward', 'clear', 'cls', 'exit'];
  let timer = 0, historyIndex = 0, draft = '', chord = '', chordAt = 0;
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem('x1-commands') || '[]'); } catch {}
  if (!Array.isArray(history)) history = [];
  historyIndex = history.length;
  const dock = {
    input: document.querySelector('#dock-input'), results: document.querySelector('#dock-results'),
    command: false, hits: [], cursor: -1, baseHash: '',
    expand(value) {
      dock.results.hidden = !value;
      dock.input.setAttribute('aria-expanded', String(value));
      if (!value) dock.input.removeAttribute('aria-activedescendant');
    },
    show(hits, query = '') {
      dock.hits = hits; dock.cursor = hits.length ? 0 : -1;
      dock.results.setAttribute('role', 'listbox');
      dock.results.innerHTML = hits.length ? ui`<div class="dock-hits">${hits.map((h, i) => ui`<button type="button" id="dock-hit-${i}" class="dock-hit" role="option" data-hit="${i}" aria-selected="${i === 0}"><span class="n">${i + 1}</span><span class="kind">${esc(h.label || tr('内容'))}</span><span class="tt">${markTerms(h.title, query)}</span><span class="snip">${markTerms(h.snip || h.text || h.route || '', query)}</span></button>`).join('')}</div>` : tr('<p class="dock-empty">没有匹配的内容。</p>');
      dock.expand(true);
      dock.select(0);
    },
    render(query) {
      if (!query.trim()) { dock.close(true); return; }
      dock.show(search(query), query.replace(/^[^:：]+[:：]\s*/, ''));
    },
    message(text) {
      dock.hits = []; dock.cursor = -1;
      dock.input.removeAttribute('aria-activedescendant');
      dock.results.setAttribute('role', 'region');
      dock.results.innerHTML = ui`<pre class="command-output" tabindex="0">${esc(text)}</pre>`;
      dock.expand(true);
    },
    select(i) {
      if (!dock.hits.length) return;
      dock.cursor = (i + dock.hits.length) % dock.hits.length;
      dock.results.querySelectorAll('[data-hit]').forEach(el => el.setAttribute('aria-selected', String(Number(el.dataset.hit) === dock.cursor)));
      const el = document.querySelector(ui`#dock-hit-${dock.cursor}`);
      dock.input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    },
    open(i = dock.cursor) {
      const hit = dock.hits[i];
      if (!hit) { dock.message(tr('没有这个编号。先输入 ls 或 find 关键词，再 open 3。')); return; }
      clearTimeout(timer);
      dock.input.value = ''; dock.close(true);
      if (hit.action) hit.action();
      else navigate(hit.route);
      if (dock.command) dock.input.focus({ preventScroll: true });
      else dock.input.blur();
    },
    close(keepHash) {
      clearTimeout(timer); dock.expand(false); dock.hits = []; dock.cursor = -1;
      if (!keepHash && location.hash.startsWith('#search/')) navigate(dock.baseHash || '#home');
    },
    mode(active) {
      clearTimeout(timer);
      if (location.hash.startsWith('#search/')) historyReplace(dock.baseHash || '#home');
      else dock.baseHash = ui`#${path()}`;
      dock.command = active;
      form.classList.toggle('command-mode', active);
      form.setAttribute('aria-label', active ? tr('页面导航命令') : tr('全站检索'));
      toggle.setAttribute('aria-pressed', String(active));
      toggle.setAttribute('aria-label', active ? tr('退出命令模式') : tr('进入命令模式'));
      dock.input.setAttribute('aria-label', active ? tr('命令，输入 help 查看帮助') : tr('全站检索'));
      dock.input.placeholder = active ? tr('help 查看命令 · ls 列出内容 · find 关键词') : searchPlaceholder();
      dock.input.value = ''; dock.close(true);
      if (active) dock.input.focus({ preventScroll: true });
    },
  };
  function historyReplace(hash) { window.history.replaceState(null, '', hash); }
  function go(target) {
    let raw = String(target || 'home').trim().replace(/\\/g, '/').replace(/^#/, '');
    const current = path().split('/');
    if (/^(\.\.|\.\.\/)$/.test(raw)) raw = current.length > 1 ? current[0] : 'home';
    else if (raw === '.' || raw === './') raw = path();
    else {
      const absolute = raw.startsWith('/') || raw.startsWith('~/');
      raw = raw.replace(/^(?:~\/|\/)/, '');
      const parts = raw.split('/').filter(Boolean);
      if (parts[0] === '..') {
        const stack = current.slice();
        for (const part of parts) { if (part === '..') stack.pop(); else if (part !== '.') stack.push(part); }
        raw = stack.join('/') || 'home';
      } else if (parts.length === 1 && !aliases[raw.toLowerCase()] && !absolute && current[0] !== 'home') raw = ui`${current[0]}/${raw}`;
    }
    let [section, ...rest] = (raw || 'home').split('/');
    section = aliases[section.toLowerCase()];
    if (!section) { dock.message(tr('未知页面。输入 ls / 查看所有入口，或 help 查看路径别名。')); return; }
    if (section === 'works') { navigate('https://navi.x1shang.top/'); return; }
    try { rest = rest.filter(Boolean).map(x => encodeURIComponent(decodeURIComponent(x))); } catch { dock.message(tr('路径编码无效。')); return; }
    const route = ui`#${[section, ...rest].join('/')}`;
    if (rest.length && !entries('all').some(x => x.route === route)) { dock.message(tr('这个内容路径不存在。输入 ls 或 find 查找。')); return; }
    dock.close(true); navigate(route);
  }
  const help = () => window.SiteLanguage.get() === 'en' ? `Command mode: click > or press / to enter; Esc or exit to leave. Type directly in normal mode to search.
Press Enter to run a command. Commands are case-insensitive, except G (bottom) and gg (top).

help / ? / man                  Show this help
ls / dir / Get-ChildItem         List content and actions on this page
ls /                            List sections; ls all lists all content
ls articles                     List articles (other section names work too)
open 3 / start 3 / Invoke-Item 3  Open result 3; empty Enter opens the selected result
cd / Set-Location / goto         Navigate, e.g. cd articles
cd.. / cd .. / cd ../            Go up: detail → section → home
cd / / cd ~ / g h                Go home; g a opens Articles
goto academic/ID                Open an entry; result numbers and titles also work
pwd / Get-Location              Show the current path
find / grep / Select-String      Search all content, including body text
find article: physics           Filter by type (Chinese queries work too)
find -i "quantum" / Select-String -Pattern "quantum"
j / k                           Scroll down / up, or move through results
gg / G                          Top / bottom; also works outside the input
g h / g a / g t / g p / g m / g f / g w
                                Home / Articles / Thoughts / Photography / Music / Friends / Projects
random [section]                Open a random entry
theme [light|dark|system]        Toggle theme, or choose light / dark / system
back / forward                  Browser back / forward
clear / cls                     Clear output; exit / quit returns to search

↑↓: command history when typing; select a result when the input is empty.
Tab: complete a command or page path.
Esc: close photo → close output → leave command mode.
Tab also reaches links, photos, music, theme, and language controls.
Page aliases: home, articles, academic, assertions/thoughts, photography/photos, music, friends, about, works. Chinese aliases also work.
These are in-page navigation commands with familiar Bash / PowerShell aliases. They do not run system commands.` : ui`命令模式：点击 > 或按 / 进入；Esc / exit 退出；普通模式直接输入即可搜索。
输入命令后按 Enter；命令不区分大小写（G 到底部，gg 到顶部）。

help / ? / man                 显示帮助
ls / dir / Get-ChildItem        列出当前页面所有内容和操作；ls / 列出栏目；ls all 列出全站内容
ls articles                    列出文章；其他栏目同理
open 3 / start 3 / Invoke-Item 3 打开当前结果第 3 项；空 Enter 打开选中项
cd articles / Set-Location articles / goto articles 进入栏目
cd.. / cd .. / cd ../ / cd \\..  返回上级：详情 → 栏目 → 主页
cd / / cd ~ / g h              回主页；g a 到文章
goto academic/ID               打开内容；也可用 ls 的编号 / 标题
pwd / Get-Location             查看当前位置
find 关键词 / grep 关键词 / Select-String 关键词  全站搜索（含正文）；find 文章: 物理 按类型筛选
find -i "量子" / grep -i "量子" / Select-String -Pattern "量子"  同一搜索功能
j / k                          下 / 上滚动；列表中选择下一 / 上一项
gg / G                         页首 / 页尾；焦点离开输入框时也可直接按键
g h / g a / g t / g p / g m / g f / g w  主页 / 文章 / 断言 / 摄影 / 音乐 / 友链 / 作品
random [栏目]                  随机打开内容
theme [light|dark|system]       切换主题 / 浅色 / 暗色 / 跟随系统
back / forward                 浏览器后退 / 前进
clear / cls                    清空输出；exit / quit 返回普通搜索

↑↓：输入非空命令时调出历史；空输入时选择结果。Tab：补全命令或页面路径。
Esc：关闭照片 → 收起输出 → 退出命令模式。Tab 也可访问链接、照片、音乐与主题按钮。
页面别名：home/主页，articles/文章，academic/学术，assertions/断言，photography/摄影，music/音乐，friends/友链，about/关于，works/作品。
此处兼容 Bash / PowerShell 常用导航别名，不执行系统命令。`;
  function execute(line) {
    const raw = line.trim();
    if (!raw) { if (!dock.results.hidden && dock.hits.length) dock.open(); return; }
    history.push(raw); history = history.slice(-100); historyIndex = history.length; draft = '';
    try { sessionStorage.setItem('x1-commands', JSON.stringify(history)); } catch {}
    dock.input.value = '';
    const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g)?.map(t => t.replace(/^(["'])(.*)\1$/, '$2')) || [];
    const cmd = tokens.shift().toLowerCase();
    const arg = tokens.join(' ');
    if (raw === 'G') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    else if (['help', '?', 'man'].includes(cmd)) dock.message(help());
    else if (['ls', 'dir', 'get-childitem', 'gci'].includes(cmd)) dock.show(entries(arg || path().split('/')[0]));
    else if (['cd', 'set-location', 'sl', 'chdir', 'goto'].includes(cmd)) {
      if (cmd === 'goto' && /^\d+$/.test(arg)) dock.open(Number(arg) - 1);
      else go(arg === '~' ? 'home' : arg);
    }
    else if (cmd === 'cd..') go('..');
    else if (['pwd', 'get-location', 'gl'].includes(cmd)) dock.message(ui`/${path().replace(/^home$/, '')}`);
    else if (['open', 'start', 'invoke-item', 'ii'].includes(cmd)) {
      if (!arg || /^\d+$/.test(arg)) dock.open(arg ? Number(arg) - 1 : dock.cursor);
      else {
        const hit = dock.hits.findIndex(h => h.title.toLowerCase() === arg.toLowerCase());
        if (hit >= 0) dock.open(hit); else go(arg);
      }
    }
    else if (['find', 'grep', 'select-string', 'sls', 'search'].includes(cmd)) {
      const query = tokens.filter(t => !['-i', '-n', '-r', '-pattern', '-simplematch'].includes(t.toLowerCase())).join(' ');
      if (query) dock.render(query); else dock.message(tr('用法：find 关键词 / grep 关键词 / Select-String -Pattern "关键词"'));
    }
    else if (['j', 'k'].includes(cmd)) {
      if (!dock.results.hidden && dock.hits.length) dock.select(dock.cursor + (cmd === 'j' ? 1 : -1));
      else window.scrollBy({ top: cmd === 'j' ? 180 : -180, behavior: 'instant' });
    }
    else if (cmd === 'gg') window.scrollTo({ top: 0, behavior: 'instant' });
    else if (cmd === 'g') go(arg || 'home');
    else if (cmd === 'random') {
      const pool = entries(arg || 'all').filter(h => !['page', 'action'].includes(h.kind));
      if (pool.length) { dock.show(pool); dock.open(Math.floor(Math.random() * pool.length)); }
      else dock.message(tr('这个范围没有内容。用 random articles 或 random。'));
    }
    else if (cmd === 'theme') {
      const value = arg.toLowerCase();
      if (value && !['light', 'dark', 'system'].includes(value)) dock.message(tr('用法：theme [light|dark|system]'));
      else dock.message(ui`主题：${window.SiteTheme.set(value)}${value === 'system' ? tr('（跟随系统）') : ''}`);
    }
    else if (cmd === 'back') { dock.close(true); window.history.back(); }
    else if (cmd === 'forward') { dock.close(true); window.history.forward(); }
    else if (['clear', 'cls'].includes(cmd)) dock.close(true);
    else if (['exit', 'quit'].includes(cmd)) { dock.mode(false); dock.input.focus(); }
    else dock.message(ui`未知命令：${raw}\n输入 help 查看帮助；搜索内容请用 find 或 grep。`);
  }
  function sync() {
    clearTimeout(timer);
    if (!dock.command && dock.input.value === '/') { dock.mode(true); return; }
    if (dock.command) return;
    const q = dock.input.value;
    if (!location.hash.startsWith('#search/')) dock.baseHash = ui`#${path()}`;
    dock.render(q);
    timer = setTimeout(() => historyReplace(q.trim() ? ui`#search/${encodeURIComponent(q)}` : dock.baseHash || '#home'), 500);
  }
  dock.input.addEventListener('input', sync);
  dock.input.addEventListener('focus', () => { if (!dock.command && dock.input.value.trim()) dock.render(dock.input.value); });
  toggle.addEventListener('click', () => dock.mode(!dock.command));
  form.addEventListener('submit', e => { e.preventDefault(); if (dock.command) execute(dock.input.value); else if (dock.hits.length) dock.open(); });
  dock.results.addEventListener('click', e => { const b = e.target.closest('[data-hit]'); if (b) dock.open(Number(b.dataset.hit)); });
  dock.input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); escape(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      if (!dock.command || (!dock.input.value && dock.hits.length && !dock.results.hidden)) dock.select(dock.cursor + delta);
      else {
        if (historyIndex === history.length) draft = dock.input.value;
        historyIndex = Math.max(0, Math.min(history.length, historyIndex + delta));
        dock.input.value = historyIndex === history.length ? draft : history[historyIndex] || '';
      }
    } else if (e.key === 'Tab' && !e.shiftKey && dock.command && dock.input.value) {
      const value = dock.input.value;
      const m = value.match(/^(cd|goto|ls|random|g|set-location)\s+(.*)$/i);
      const choices = m ? Object.keys(aliases) : commands;
      const prefix = m ? m[2] : value;
      const matches = choices.filter(c => c.toLowerCase().startsWith(prefix.toLowerCase()));
      if (matches.length) { e.preventDefault(); if (matches.length === 1) dock.input.value = (m ? ui`${m[1]} ` : '') + matches[0] + ' '; else dock.message(ui`可补全：${matches.join(' · ')}`); }
    }
  });
  function escape() {
    const photo = document.querySelector('#photo-dialog');
    if (photo.open) { photo.close(); return; }
    if (!dock.results.hidden) { dock.close(!location.hash.startsWith('#search/')); dock.input.value = ''; }
    else if (dock.command) dock.mode(false);
    else { dock.input.value = ''; dock.input.blur(); }
  }
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    if (el?.matches('input, textarea, select') || el?.isContentEditable) return;
    if (e.key === '/' || e.key === '>') { e.preventDefault(); dock.mode(true); }
    else if (e.key === 'Escape') escape();
    else if (dock.command && !document.querySelector('dialog[open]')) {
      if (e.key === 'g') {
        e.preventDefault();
        if (chord === 'g' && Date.now() - chordAt < 1000) { execute('gg'); chord = ''; }
        else { chord = 'g'; chordAt = Date.now(); }
      } else if (chord === 'g' && Date.now() - chordAt < 1000 && aliases[e.key]) { e.preventDefault(); go(e.key); chord = ''; }
      else if (['j', 'k', 'G'].includes(e.key)) { e.preventDefault(); chord = ''; execute(e.key); }
      else chord = '';
    }
  });
  dock.refreshLanguage = () => {
    form.setAttribute('aria-label', tr(dock.command ? '页面导航命令' : '全站检索'));
    toggle.setAttribute('aria-label', tr(dock.command ? '退出命令模式' : '进入命令模式'));
    dock.input.setAttribute('aria-label', tr(dock.command ? '命令，输入 help 查看帮助' : '全站检索'));
    dock.input.placeholder = dock.command ? tr('help 查看命令 · ls 列出内容 · find 关键词') : searchPlaceholder();
    if (tipIndex >= 0) { hint.textContent = tips[tipIndex]; hint.title = tips[tipIndex]; }
    if (!dock.results.hidden) {
      if (!dock.command) dock.render(dock.input.value);
      else if (dock.hits.length) dock.show(dock.hits.map(hit => hit.kind === 'page' ? entries('all').find(x => x.route === hit.route) || hit : { ...hit, label: tr(window.SiteLanguage.source(hit.label)) }));
      else dock.message(help());
    }
  };
  dock.refreshLanguage();
  return dock;
};
