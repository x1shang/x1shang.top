// 等 GitHub 给某个 Pages 仓库的自定义域名签发 Let's Encrypt 证书，就绪后自动开启 Enforce HTTPS
// 用法： $env:GH_TOKEN = <token>; node tools/enable-https.cjs
//        默认盯 x1shang/x1shang.top 的 x1shang.top；换目标就带上这几个环境变量：
//        $env:REPO='navigation-page'; $env:DOMAIN='navi.x1shang.top'; node tools/enable-https.cjs
// 可选： OWNER=x1shang  IP=185.199.108.153  INTERVAL_MS=90000  DEADLINE_MS=7200000
// 若报 `unable to verify the first certificate`（本机对 api.github.com 有 TLS 拦截/自签根，2026-10-12 遇到过），
// 用系统根证书重跑：node --use-system-ca tools/enable-https.cjs
const https = require('https');
const tls = require('tls');

const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.OWNER || 'x1shang';
const NAME = process.env.REPO || 'x1shang.top';
const DOMAIN = process.env.DOMAIN || 'x1shang.top';
const IP = process.env.IP || '185.199.108.153';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 90 * 1000);
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 2 * 60 * 60 * 1000);

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'User-Agent': 'dsh-deploy',
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + TOKEN,
    };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
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

function certInfo(ip, servername) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: ip, port: 443, servername, rejectUnauthorized: false, timeout: 20000 }, () => {
      const c = s.getPeerCertificate() || {};
      resolve({ subject: (c.subject || {}).CN, alt: c.subjectaltname || '', issuer: (c.issuer || {}).O, valid_to: c.valid_to });
      s.end();
    });
    s.on('error', (e) => resolve({ err: e.message }));
    s.on('timeout', () => { s.destroy(); resolve({ err: 'timeout' }); });
  });
}

const covers = (c) => !!c && typeof c.alt === 'string' && c.alt.split(',').map((x) => x.trim()).includes('DNS:' + DOMAIN);

(async () => {
  if (!TOKEN) { console.log('GH_TOKEN 未设置'); process.exit(1); }
  const deadline = Date.now() + DEADLINE_MS;
  const started = Date.now();
  let n = 0;
  while (Date.now() < deadline) {
    n++;
    const stamp = new Date().toISOString();
    const mins = Math.round((Date.now() - started) / 60000);

    let certState = 'unknown', httpsEnforced = null, health = '';
    try {
      const p = await api('GET', `/repos/${OWNER}/${NAME}/pages`);
      const j = JSON.parse(p.body);
      certState = j.https_certificate ? `${j.https_certificate.state} (${(j.https_certificate.description || '').slice(0, 40)})` : 'null（尚未开始签发）';
      httpsEnforced = j.https_enforced;
    } catch (e) { certState = 'api错误 ' + e.message; }
    try {
      const h = await api('GET', `/repos/${OWNER}/${NAME}/pages/health`);
      if (h.status === 200) {
        const j = JSON.parse(h.body);
        const d = j.domain || {};
        health = `apex: resolves=${d.dns_resolves} pointed=${d.is_pointed_to_github_pages_ip} eligible=${d.is_https_eligible}`;
      } else health = `health ${h.status}（检查中）`;
    } catch (e) { health = 'health错误 ' + e.message; }

    const c = await certInfo(IP, DOMAIN);
    console.log(`#${n} +${mins}min ${stamp}  cert=${certState}  enforced=${httpsEnforced}  ${health}  TLS.subject=${c.subject} covers=${covers(c)}`);

    if (covers(c)) {
      console.log('证书已覆盖 ' + DOMAIN + '，开启 Enforce HTTPS ...');
      const r = await api('PUT', `/repos/${OWNER}/${NAME}/pages`, { https_enforced: true });
      console.log('PUT /pages {https_enforced:true} ->', r.status, r.body.slice(0, 200));
      if (r.status === 204 || r.status === 200) {
        const g = await api('GET', `/repos/${OWNER}/${NAME}/pages`);
        console.log('FINAL /pages ->', g.status, g.body.slice(0, 400));
        const verify = await certInfo(IP, DOMAIN);
        console.log('FINAL TLS ->', JSON.stringify(verify));
        process.exit(0);
      }
      console.log('GitHub 还没准备好，稍后重试');
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('超时：本窗口内 GitHub 仍未签发证书，可重跑本脚本继续等');
  process.exit(2);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
