// GitHub Pages 开通 / 自定义域名绑定（CommonJS，用 node tools/gh-pages-setup.cjs 运行）
// 需要环境变量 GH_TOKEN；仓库：x1shang/x1shang.top
const https = require('https');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'x1shang';
const NAME = 'x1shang.top';
const CNAME = 'x1shang.top';

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

const show = (label, r, n = 300) => console.log(label, '->', r.status, r.body.slice(0, n));

(async () => {
  if (!TOKEN) throw new Error('GH_TOKEN 未设置');

  let r = await api('GET', `/repos/${OWNER}/${NAME}`);
  show('GET  /repos', r, 200);
  const repo = JSON.parse(r.body);
  console.log('     default_branch =', repo.default_branch, '| private =', repo.private, '| html_url =', repo.html_url);

  if (process.env.MAKE_PUBLIC === '1' && repo.private) {
    r = await api('PATCH', `/repos/${OWNER}/${NAME}`, { private: false });
    show('PATCH /repos(private=false)', r, 200);
  }

  r = await api('GET', `/repos/${OWNER}/${NAME}/contents/index.html`);
  show('GET  index.html', r, 120);

  r = await api('GET', `/repos/${OWNER}/${NAME}/pages`);
  show('GET  /pages', r, 200);
  if (r.status === 404) {
    r = await api('POST', `/repos/${OWNER}/${NAME}/pages`, { build_type: 'legacy', source: { branch: 'main', path: '/' } });
    show('POST /pages', r, 300);
  } else {
    r = await api('PUT', `/repos/${OWNER}/${NAME}/pages`, { build_type: 'legacy', source: { branch: 'main', path: '/' } });
    show('PUT  /pages(source)', r, 300);
  }

  r = await api('PUT', `/repos/${OWNER}/${NAME}/pages`, { cname: CNAME });
  show('PUT  /pages(cname)', r, 400);

  r = await api('GET', `/repos/${OWNER}/${NAME}/pages`);
  show('GET  /pages(final)', r, 500);

  r = await api('GET', `/repos/${OWNER}/${NAME}/pages/builds/latest`);
  show('GET  builds/latest', r, 300);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
