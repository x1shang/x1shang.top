/* Run with Playwright available in NODE_PATH and a local preview on port 8087. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Keep QA local: analytics, fonts and streaming are unrelated to language switching.
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:8087/') ? route.continue() : route.abort());
  const go = async hash => { await page.goto('http://127.0.0.1:8087/' + hash); await page.waitForSelector('#navigation a'); };
  await go('#about');
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  const originalAbout = await page.locator('#main .prose').textContent();
  assert.match(originalAbout, /七次进藏/);
  const originalTip = await page.locator('#dock-hint').textContent();
  assert.ok(await page.evaluate(tip => window.AUTO.tips.includes(tip), originalTip));
  await page.locator('#language-toggle').click();
  assert.equal(await page.locator('#dock-hint').textContent(), originalTip);
  assert.equal(await page.locator('#dock-hint').getAttribute('title'), originalTip);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.match(await page.locator('#main .prose').textContent(), /seven trips to Tibet/);
  assert.match(await page.locator('.sidebar-bottom').textContent(), /Because it's there\./);
  assert.equal(await page.locator('[data-page="articles"]').textContent(), '03Articles');
  assert.match(await page.locator('#dock-input').getAttribute('placeholder'), /Search/);
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.locator('#language-toggle').click();
  assert.equal(await page.locator('#main .prose').textContent(), originalAbout);
  const id = await page.evaluate(() => window.AUTO.articles.find(a => a.format === 'md' && !a.test).id);
  await go('#articles/' + encodeURIComponent(id));
  const originalBody = await page.locator('#main .prose').innerHTML();
  const originalTitle = await page.locator('.reading-head h1').textContent();
  await page.locator('#language-toggle').click();
  assert.equal(await page.locator('#main .prose').innerHTML(), originalBody);
  assert.equal(await page.locator('.reading-head h1').textContent(), originalTitle);
  assert.equal(await page.locator('.share-btn').textContent(), 'Copy title and link');
  assert.equal(await page.locator('.backlink').textContent(), '← All articles');
  await page.locator('#command-toggle').click();
  await page.locator('#dock-input').fill('help');
  await page.locator('#dock-input').press('Enter');
  assert.match(await page.locator('.command-output').textContent(), /These are in-page navigation commands/);
  assert.doesNotMatch(await page.locator('.command-output').textContent(), /[\u4e00-\u9fff]/);
  await page.locator('#language-toggle').click();
  assert.match(await page.locator('.command-output').textContent(), /不执行系统命令/);
  await page.locator('#language-toggle').click();
  await page.locator('#dock-input').fill('ls /');
  await page.locator('#dock-input').press('Enter');
  assert.match(await page.locator('#dock-results').textContent(), /Articles/);
  await page.locator('#command-toggle').click();
  await page.locator('#dock-input').fill('Articles');
  await page.waitForSelector('.dock-hit');
  assert.match(await page.locator('#dock-results').textContent(), /Articles/);
  await page.locator('#dock-input').fill('不存在的搜索项xyz987');
  await page.waitForSelector('.dock-empty');
  assert.equal(await page.locator('.dock-empty').textContent(), 'No matches found.');
  await go('#home');
  for (const hash of ['#home', '#academic', '#articles', '#assertions', '#photography', '#music', '#friends', '#about']) {
    await go(hash);
    await page.waitForTimeout(100);
    // Print remaining Chinese outside author content for review.
    const remaining = await page.evaluate(() => {
      const excluded = '.prose,.reading-head,.reading-meta,.idx-run a,.idx-run .meta,.idx-list .tt,.idx-list .sub,.photo-grid,.track strong,.track small,.lyric,.sky-credit,#dock-hint';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), rows = [];
      while (walker.nextNode()) {
        const n=walker.currentNode, p=n.parentElement;
        if (p.closest('script,style') || p.closest(excluded) || !p.getClientRects().length) continue;
        if (/[\u4e00-\u9fff]/.test(n.nodeValue)) rows.push(n.nodeValue.trim());
      }
      return rows;
    });
    console.log(hash, JSON.stringify(remaining));
  }
  for (const width of [1440, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      theme: document.querySelector('#theme-toggle').getBoundingClientRect().toJSON(),
      language: document.querySelector('#language-toggle').getBoundingClientRect().toJSON(),
      input: document.querySelector('#dock-input').getBoundingClientRect().toJSON() }));
    assert.ok(sizes.scroll <= sizes.width + 1, JSON.stringify(sizes));
    assert.ok(sizes.input.right <= sizes.theme.left && sizes.theme.right <= sizes.language.left, JSON.stringify(sizes));
  }
  await page.locator('#theme-toggle').click();
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#language-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  await page.locator('#language-toggle').click();
  await page.locator('#dock-input').fill('');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'language-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'language-desktop.png', fullPage: true });
  await page.goto('http://127.0.0.1:8087/articles/' + encodeURIComponent(id) + '/');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#main .prose').innerHTML(), originalBody);
  assert.deepEqual(errors, []);
  // Storage-disabled browsers must still be able to switch in memory.
  const isolated = await browser.newContext();
  await isolated.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } }));
  const blocked = await isolated.newPage();
  await blocked.goto('http://127.0.0.1:8087/#about');
  await blocked.locator('#language-toggle').click();
  assert.equal(await blocked.locator('html').getAttribute('lang'), 'en');
  await browser.close();
  console.log('PASS: language, persistence, original content, commands, search, themes, deep links, storage fallback, and responsive layout.');
})().catch(e => { console.error(e); process.exit(1); });

