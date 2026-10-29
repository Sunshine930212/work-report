/* 工作台云端服务 —— 零依赖 Node http
   - 静态托管 public/
   - /api/load?u= 读取 data/<user>.json
   - /api/save?u= 写入 data/<user>.json
   三人（Maggie / Nancy / Yara）数据各自独立，免密登录。
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const USERS = ['Maggie', 'Nancy', 'Yara'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

function safeUser(u) {
  if (typeof u !== 'string') return null;
  u = u.trim();
  return USERS.indexOf(u) >= 0 ? u : null; // 白名单天然防目录穿越
}

function filePathFor(user) {
  return path.join(DATA_DIR, user + '.json');
}

function readBody(req, limit) {
  limit = limit || 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  try { urlPath = decodeURIComponent(urlPath); } catch (e) {}
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  const user = safeUser(new URL(req.url, 'http://localhost').searchParams.get('u'));

  if (pathname === '/api/load') {
    if (!user) { sendJSON(res, 400, { error: 'invalid user' }); return; }
    fs.readFile(filePathFor(user), 'utf8', (err, data) => {
      if (err) {
        // 该用户尚无数据 → 返回空结构，前端用默认种子数据
        sendJSON(res, 200, { modules: {}, daily: [], version: 1, theme: 'light', matrixColWidths: {} });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/api/save') {
    if (!user) { sendJSON(res, 400, { error: 'invalid user' }); return; }
    try {
      const body = await readBody(req);
      let obj;
      try { obj = JSON.parse(body); } catch (e) { sendJSON(res, 400, { error: 'bad json' }); return; }
      if (!obj || typeof obj !== 'object' || !obj.modules) { sendJSON(res, 400, { error: 'bad payload' }); return; }
      fs.writeFile(filePathFor(user), JSON.stringify(obj, null, 2), 'utf8', err => {
        if (err) { console.error('写入失败', err); sendJSON(res, 500, { error: 'write failed' }); return; }
        sendJSON(res, 200, { ok: true, savedAt: new Date().toISOString() });
      });
    } catch (e) {
      sendJSON(res, 413, { error: e.message });
    }
    return;
  }

  if (pathname.startsWith('/api/')) { sendJSON(res, 404, { error: 'unknown api' }); return; }

  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('工作台云端服务已启动： http://0.0.0.0:' + PORT);
});
