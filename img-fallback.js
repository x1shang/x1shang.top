/* 裂图兜底：图片真的加载失败的那一刻，才把「图片已被小猫吃掉」占位图顶上去。
   —— 正常打开页面时这张图一个字节都不下载，占位图只在 error 发生时发那一次请求（2.8 KB，之后走缓存）。
   error 事件不冒泡，所以监听写在捕获阶段：一个监听器管住全站所有 <img>，
   包括渲染器后来注入的正文配图、照片墙、网抑云封面。
   暗色主题下不换图，由 style.css 里的 filter 反色（省一次请求、也省一张图）。 */
(() => {
  const ALT = '图片已被小猫吃掉';
  /* 用脚本自身地址推站点根：首页与 articles/x/ 这类二级页的相对路径都对得上 */
  const base = new URL('.', document.currentScript ? document.currentScript.src : location.href);
  const stub = new URL('assets/img/broken-image.webp', base).href;

  addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const original = img.currentSrc || img.getAttribute('src') || '';
    /* 记「这张图的哪个地址已经兜过了」而不是「兜过了」：
       占位图自己都没取到时 src 已是占位图，天然命中这条、不会套娃；
       而换了地址的重试图（比如网抑云换封面）还能再兜一次 */
    if (img.dataset.fallbackFor === original) return;
    img.dataset.fallbackFor = original;
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.classList.add('is-broken-image');
    img.src = stub;
    /* 给个固有尺寸，免得裂图原本是 0×0、换上占位图后正文突然往下跳一截 */
    img.width = 420;
    img.height = 400;
    if (!img.alt.trim()) img.alt = ALT;
    img.title = (img.title ? img.title + ' · ' : '') + ALT + (original ? '：' + original : '');
  }, true);
})();
