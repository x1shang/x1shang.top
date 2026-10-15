/* 在首次绘制前恢复主题；存储被禁用时仍可切换。 */
(() => {
  const { t: tr, ui } = window.SiteLanguage;
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = localStorage.getItem('x1-theme') || 'system'; } catch {}
  if (!['light', 'dark', 'system'].includes(preference)) preference = 'system';
  function apply() {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#111820' : '#f2f4f6';
    const mountain = document.querySelector('.mountain');
    if (mountain) mountain.alt = theme === 'dark' ? tr('银河星空下的雪山与云海') : tr('蓝天下的雪山与云海');
    const button = document.querySelector('#theme-toggle');
    if (button) {
      button.title = tr('切换主题；命令 theme system 跟随系统');
      button.textContent = theme === 'dark' ? '☀' : '☾';
      button.setAttribute('aria-label', theme === 'dark' ? tr('切换浅色模式') : tr('切换暗色模式'));
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }
  window.SiteTheme = {
    get: () => document.documentElement.dataset.theme,
    set(value) {
      preference = value || (this.get() === 'dark' ? 'light' : 'dark');
      try { localStorage.setItem('x1-theme', preference); } catch {}
      apply();
      return this.get();
    },
  };
  media.addEventListener('change', apply);
  addEventListener('languagechange', apply);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('#theme-toggle')?.addEventListener('click', () => window.SiteTheme.set());
    apply();
  });
  apply();
})();
