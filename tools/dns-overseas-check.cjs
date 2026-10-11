// 从「代理出口（境外视角）」查 DNS：HTTP CONNECT 隧道 + DNS over TCP
// 用途：判断阿里云解析是否存在「只在境内生效」的解析线路，导致 GitHub（境外）看到 NXDOMAIN
const http = require('http');

const PROXY = { host: '127.0.0.1', port: 10809 };
const NAME = 'x1shang.top';
const WWW = 'www.x1shang.top';

function buildQuery(name, type) {
  const parts = name.replace(/\.$/, '').split('.');
  const q = [];
  for (const p of parts) { q.push(Buffer.from([p.length]), Buffer.from(p, 'ascii')); }
  q.push(Buffer.from([0]));
  const qname = Buffer.concat(q);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x1234, 0);   // id
  head.writeUInt16BE(0x0100, 2);   // RD
  head.writeUInt16BE(1, 4);        // qdcount
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([head, qname, tail]);
}

function readName(buf, off) {
  const labels = [];
  let jumped = false, end = off, guard = 0;
  while (true) {
    if (guard++ > 128) break;
    const len = buf[off];
    if (len === 0) { if (!jumped) end = off + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[off + 1];
      if (!jumped) end = off + 2;
      jumped = true; off = ptr; continue;
    }
    labels.push(buf.slice(off + 1, off + 1 + len).toString('ascii'));
    off += 1 + len;
  }
  return { name: labels.join('.'), end };
}

function parse(buf) {
  const rcode = buf[3] & 0x0f;
  const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6);
  let off = 12;
  for (let i = 0; i < qd; i++) { off = readName(buf, off).end + 4; }
  const answers = [];
  for (let i = 0; i < an; i++) {
    const n = readName(buf, off); off = n.end;
    const type = buf.readUInt16BE(off), ttl = buf.readUInt32BE(off + 4), rdlen = buf.readUInt16BE(off + 8);
    const rd = off + 10;
    let data = null;
    if (type === 1 && rdlen === 4) data = `${buf[rd]}.${buf[rd + 1]}.${buf[rd + 2]}.${buf[rd + 3]}`;
    else if (type === 5) data = readName(buf, rd).name;
    else if (type === 28 && rdlen === 16) {
      data = [];
      for (let k = 0; k < 16; k += 2) data.push(buf.readUInt16BE(rd + k).toString(16));
      data = data.join(':');
    }
    answers.push({ name: n.name, type, ttl, data });
    off = rd + rdlen;
  }
  const names = { 1: 'A', 5: 'CNAME', 28: 'AAAA', 6: 'SOA', 16: 'TXT' };
  return { rcode, answers: answers.map((a) => `${names[a.type] || a.type} ${a.data} (ttl ${a.ttl})`) };
}

function tcpDns(server, name, type) {
  return new Promise((resolve) => {
    const req = http.request({ host: PROXY.host, port: PROXY.port, method: 'CONNECT', path: `${server}:53`, timeout: 25000 });
    req.on('connect', (res, socket) => {
      const msg = buildQuery(name, type);
      const framed = Buffer.alloc(2 + msg.length);
      framed.writeUInt16BE(msg.length, 0);
      msg.copy(framed, 2);
      socket.write(framed);
      const chunks = [];
      socket.on('data', (d) => {
        chunks.push(d);
        const all = Buffer.concat(chunks);
        if (all.length >= 2 && all.length >= 2 + all.readUInt16BE(0)) {
          socket.end();
          const p = parse(all.slice(2, 2 + all.readUInt16BE(0)));
          const rc = { 0: 'NOERROR', 2: 'SERVFAIL', 3: 'NXDOMAIN' }[p.rcode] || `rcode${p.rcode}`;
          resolve(`${server.padEnd(16)} ${rc.padEnd(9)} ${p.answers.length ? p.answers.join(' | ') : '(无答案)'}`);
        }
      });
      socket.on('error', (e) => resolve(`${server.padEnd(16)} socket错误 ${e.message}`));
    });
    req.on('error', (e) => resolve(`${server.padEnd(16)} 代理错误 ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve(`${server.padEnd(16)} 超时`); });
    req.end();
  });
}

function exitIp() {
  return new Promise((resolve) => {
    const r = http.request({ host: PROXY.host, port: PROXY.port, method: 'CONNECT', path: 'api.ipify.org:443', timeout: 20000 });
    r.on('connect', (res, socket) => {
      const tls = require('tls').connect({ socket, servername: 'api.ipify.org', rejectUnauthorized: false }, () => {
        socket.write('GET / HTTP/1.1\r\nHost: api.ipify.org\r\nUser-Agent: dsh\r\nConnection: close\r\n\r\n');
      });
      let d = '';
      tls.on('data', (c) => (d += c));
      tls.on('end', () => resolve((d.split('\r\n\r\n')[1] || '').trim()));
      tls.on('error', (e) => resolve('TLS错误 ' + e.message));
    });
    r.on('error', (e) => resolve('代理错误 ' + e.message));
    r.end();
  });
}

(async () => {
  console.log('代理出口 IP        :', await exitIp());
  console.log('--- 经代理（境外出口）查询 ---');
  for (const s of ['39.96.153.59', '8.8.8.8', '1.1.1.1', '9.9.9.9']) {
    console.log(await tcpDns(s, NAME, 1));
  }
  console.log(await tcpDns('8.8.8.8', WWW, 5));
})();
