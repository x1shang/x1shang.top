// 重新创建 Pages 站点，强制 GitHub 重新走一遍「绑定域名 → 申请证书」流程
// 背景：域名健康检查已全绿（dns_resolves / is_https_eligible 都对），但 https_certificate 一直为空
//       —— 这是社区里常见的卡死态，等价触发方式是「移除自定义域名再重新添加」；
//       这里干脆用 API 把整个 Pages 站点删掉重建，逼它重新申请一次证书。
//
// ⚠️ 代价：**站点会短暂下线**（DELETE 到 POST 重建之间，实测通常 1~5 分钟），所以只在上面的软办法都无效时用：
//   先挂 tools/enable-https.cjs 等 → 去仓库 Settings → Pages 页面点开一次（这个账号 2026-10-11 就是点开后才开始签发的）→ 还不行再跑本脚本。
//
// 用法： $env:GH_TOKEN = <token>; node tools/recreate-pages.cjs
//        默认盯 x1shang/x1shang.top（域名 x1shang.top）；换目标：
//        $env:REPO='navigation-page'; $env:DOMAIN='navi.x1shang.top'; node tools/recreate-pages.cjs
// 可选： OWNER=x1shang  IP=185.199.108.153  CNAME=<写进 Pages 的自定义域名，默认同 DOMAIN>
//        （punycode 域名可以 CNAME=xn--vnqp08bwj8a.xn--0iv.gay 而 DOMAIN 用明文 —— TLS 探测仍按明文域名的 SNI 走）
// 若报 `unable to verify the first certificate`（本机对 api.github.com 有 TLS 拦截/自签根），用 node --use-system-ca 重跑
const https = require('https');
const http = require('http');
const tls = require('tls');

const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.OWNER || 'x1shang';
const NAME = process.env.REPO || 'x1shang.top';
const DOMAIN = process.env.DOMAIN || 'x1shang.top';
const CNAME = process.env.CNAME || DOMAIN;
const IP = process.env.IP || '185.199.108.153';

function api(method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = Object.assign({
      'User-Agent': 'dsh-deploy',
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + TOKEN,
    }, extraHeaders || {});
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request({ host: 'api.github.com', path, method, headers, timeout: 30000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function siteStatus() {
  return new Promise((resolve) => {
    const r = http.request({ host: IP, path: '/', method: 'GET', timeout: 20000, headers: { Host: DOMAIN, 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
      let d = ''; resp.on('data', (c) => (d += c));
      resp.on('end', () => resolve(`HTTP ${resp.statusCode} · ${(d.match(/<title>([^<]*)<\/title>/i) || [])[1] || ''}`));
    });
    r.on('error', (e) => resolve('ERR ' + e.message));
    r.on('timeout', () => { r.destroy(); resolve('timeout'); });
    r.end();
  });
}

function cert() {
  return new Promise((resolve) => {
    const s = tls.connect({ host: IP, port: 443, servername: DOMAIN, rejectUnauthorized: false, timeout: 15000 }, () => {
      const c = s.getPeerCertificate() || {};
      resolve({ subject: (c.subject || {}).CN, alt: (c.subjectaltname || '').slice(0, 60) });
      s.end();
    });
    s.on('error', (e) => resolve({ err: e.message }));
    s.on('timeout', () => { s.destroy(); resolve({ err: 'timeout' }); });
  });
}

(async () => {
  if (!TOKEN) { console.log('GH_TOKEN 未设置'); process.exit(1); }
  console.log(`目标：${OWNER}/${NAME}  域名 ${DOMAIN}（Pages cname 写 ${CNAME}）`);
  console.log('删除前站点状态:', await siteStatus());

  let r = await api('GET', `/repos/${OWNER}/${NAME}/pages`);
  console.log('GET /pages  ->', r.status, r.body.slice(0, 120));

  r = await api('DELETE', `/repos/${OWNER}/${NAME}/pages`);
  console.log('DELETE /pages ->', r.status, r.body.slice(0, 120));

  for (let i = 1; i <= 5; i++) {
    await sleep(5000);
    r = await api('POST', `/repos/${OWNER}/${NAME}/pages`, { build_type: 'legacy', source: { branch: 'main', path: '/' } });
    console.log(`POST /pages (第 ${i} 次) ->`, r.status, r.body.slice(0, 200));
    if (r.status === 201 || r.status === 200) break;
  }

  await sleep(3000);
  r = await api('PUT', `/repos/${OWNER}/${NAME}/pages`, { cname: CNAME });
  console.log('PUT /pages {cname} ->', r.status, r.body.slice(0, 200));

  r = await api('POST', `/repos/${OWNER}/${NAME}/pages/builds`);
  console.log('POST /pages/builds ->', r.status, r.body.slice(0, 120));

  for (let i = 1; i <= 6; i++) {
    await sleep(20000);
    r = await api('GET', `/repos/${OWNER}/${NAME}/pages`);
    let j = {}; try { j = JSON.parse(r.body); } catch {}
    const h = await api('GET', `/repos/${OWNER}/${NAME}/pages/health`);
    let hd = {}; try { hd = (JSON.parse(h.body).domain) || {}; } catch {}
    console.log(`[${i}] pages.status=${j.status} cname=${j.cname} cert=${JSON.stringify(j.https_certificate || null)} | health=${h.status} eligible=${hd.is_https_eligible} resolves=${hd.dns_resolves} | 站点=${await siteStatus()} | TLS=${JSON.stringify(await cert())}`);
  }
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
