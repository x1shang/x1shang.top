/* Translate interface literals only. Article data never passes through this layer. */
(() => {
  const dictionary = window.SITE_TRANSLATIONS || {};
  const reverse = new Map(Object.entries(dictionary).map(([zh, en]) => [en, zh]));
  const pattern = new RegExp(Object.keys(dictionary).sort((a, b) => b.length - a.length)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  let language = 'zh';
  try { if (localStorage.getItem('x1-language') === 'en') language = 'en'; } catch {}
  const source = value => reverse.get(String(value)) || String(value);
  const t = value => {
    const text = String(value ?? '');
    return language === 'en' ? text.replace(pattern, match => dictionary[match]) : text;
  };
  // Tagged templates translate only their static pieces, never interpolated content.
  const ui = (parts, ...values) => parts.reduce((out, part, i) => out + t(part) + (i < values.length ? values[i] : ''), '');
  const shell = [];
  function applyShell() {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    for (const item of shell) {
      if (item.attr) item.node.setAttribute(item.attr, t(item.text));
      else item.node.nodeValue = t(item.text);
    }
    const button = document.querySelector('#language-toggle');
    if (button) {
      button.textContent = language === 'en' ? '中' : 'EN';
      button.lang = language === 'en' ? 'zh-CN' : 'en';
      button.setAttribute('aria-label', language === 'en' ? '切换到中文' : 'Switch to English');
      button.title = button.getAttribute('aria-label');
    }
  }
  window.SiteLanguage = {
    get: () => language, t, ui, source,
    set(next) {
      if (!['zh', 'en'].includes(next) || next === language) return;
      language = next;
      try { localStorage.setItem('x1-language', next); } catch {}
      applyShell();
      dispatchEvent(new Event('languagechange'));
    },
  };
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.addEventListener('DOMContentLoaded', () => {
    // Only the fixed shell is captured. Content, lyrics and generated controls have
    // their own rendering paths and are deliberately excluded.
    const roots = document.querySelectorAll('.skip, #hero, .site-name, .sidebar-bottom, footer, #dock');
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest('#dock-results, #dock-hint, #language-toggle, .sky-credit, #local-clock')) continue;
        if (/[\u4e00-\u9fff]/.test(node.nodeValue)) shell.push({ node, text: node.nodeValue });
      }
    }
    const dynamic = '#main *, #navigation *, #dock-input, #command-toggle, #theme-toggle, #dock-hint, .mountain';
    for (const node of document.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
      if (node.matches(dynamic)) continue;
      for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
        const text = node.getAttribute(attr);
        if (text && /[\u4e00-\u9fff]/.test(text)) shell.push({ node, attr, text });
      }
    }
    document.querySelector('#language-toggle').addEventListener('click', () => {
      window.SiteLanguage.set(language === 'en' ? 'zh' : 'en');
    });
    applyShell();
  });
})();
