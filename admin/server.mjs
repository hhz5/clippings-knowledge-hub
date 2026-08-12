import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { loadSrc } from '../scripts/config.mjs';

// 与构建脚本共用 gray-matter 解析 frontmatter（依赖由仓库 node_modules / NODE_PATH 解析，不写死本机路径）
let matter = null;
try {
  const gm = await import('gray-matter');
  matter = gm.default || gm;
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..'); // 站点根目录（仓库内）
const SRC = loadSrc();                       // 剪藏源目录（本机，gitignore）
const PORT = Number(process.env.ADMIN_PORT) || 7777;

// ---------- 工具 ----------
function slugify(rel) {
  return rel.replace(/\.md$/i, '')
    .replace(/[/\\]/g, '_')
    .replace(/["<>:|?*]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function walkMd(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // 跳过 .trash / .workbuddy 等隐藏目录
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

function parseMd(raw) {
  if (matter) {
    try {
      const { data, content } = matter(raw);
      return { data: data || {}, body: content || '' };
    } catch {}
  }
  // 兜底：简单解析（支持缩进列表）
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const data = {};
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    let curList = null;
    for (const line of m[1].split('\n')) {
      if (/^\s*-\s/.test(line)) {
        const tm = line.match(/^\s*-\s*"?([^"\n]*?)"?\s*$/);
        if (tm && curList) (data[curList] ||= []).push(tm[1]);
        continue;
      }
      const km = line.match(/^([^:：]+)[:：]\s*"?([^"\n]*?)"?\s*$/);
      if (km) {
        const key = km[1].trim();
        if (km[2] === '') { curList = key; data[key] = data[key] || []; }
        else { data[key] = km[2]; curList = null; }
      }
    }
  }
  return { data, body };
}

function serialize(data, body) {
  if (matter) {
    try { return matter.stringify(body || '', data || {}); } catch {}
  }
  const lines = ['---'];
  for (const [k, v] of Object.entries(data || {})) {
    if (Array.isArray(v)) { lines.push(`${k}:`); for (const it of v) lines.push(`  - "${it}"`); }
    else if (v !== '' && v != null) lines.push(`${k}: "${v}"`);
  }
  lines.push('---', '', (body || '').replace(/\s+$/, ''), '');
  return lines.join('\n');
}

function cleanText(s) { return String(s == null ? '' : s).trim(); }

function listArticles() {
  const files = walkMd(SRC);
  const list = [];
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const author = path.dirname(rel) === '.' ? '其他' : path.dirname(rel);
    let entry = { id: slugify(rel), author, path: f, rel };
    try {
      const raw = fs.readFileSync(f, 'utf8');
      const { data } = parseMd(raw);
      entry.title = cleanText(data.标题) || path.basename(f, '.md');
      entry.tags = Array.isArray(data.tags) ? data.tags : (Array.isArray(data.标签) ? data.标签 : []);
      entry.date = cleanText(data.创建时间) || cleanText(data.日期) || '';
      entry.size = fs.statSync(f).size;
    } catch {
      entry.title = path.basename(f, '.md');
      entry.tags = [];
      entry.date = '';
      entry.size = 0;
    }
    list.push(entry);
  }
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  return list;
}

function idToPath(id) {
  const files = walkMd(SRC);
  for (const f of files) {
    const rel = path.relative(SRC, f);
    if (slugify(rel) === id) return { f, rel, author: path.dirname(rel) === '.' ? '其他' : path.dirname(rel) };
  }
  return null;
}

function ensureUnique(dest) {
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(dest);
  const base = dest.slice(0, -ext.length);
  let i = 1;
  while (fs.existsSync(`${base}_${i}${ext}`)) i++;
  return `${base}_${i}${ext}`;
}

function trashPath(rel) {
  const tdir = path.join(SRC, '.trash');
  fs.mkdirSync(tdir, { recursive: true });
  return ensureUnique(path.join(tdir, rel));
}

// ---------- 路由 ----------
function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 5e6) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const ALLOW_STATIC = ['/', '/index.html', '/assets/', '/articles/', '/admin/'];
function safeStatic(urlPath, res) {
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  // 目录请求回退到 index.html
  let target = filePath;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  // 仅允许公开目录，禁止访问 scripts / .git / 配置等
  const ok = ALLOW_STATIC.some((p) => urlPath === p || urlPath.startsWith(p));
  if (!ok) {
    res.writeHead(404); res.end('not found'); return;
  }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(target).toLowerCase();
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // e.g. ['api','articles',':id']
  const method = req.method;

  if (seg[1] === 'status') return sendJson(res, 200, { enabled: true });

  if (seg[1] === 'articles' && !seg[2]) {
    if (method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const author = url.searchParams.get('author') || '';
      const tag = url.searchParams.get('tag') || '';
      let list = listArticles();
      if (author) list = list.filter((a) => a.author === author);
      if (tag) list = list.filter((a) => (a.tags || []).includes(tag));
      if (q) {
        const t = q.toLowerCase();
        list = list.filter((a) => (a.title || '').toLowerCase().includes(t) || (a.author || '').toLowerCase().includes(t) || (a.tags || []).some((x) => x.toLowerCase().includes(t)));
      }
      return sendJson(res, 200, { count: list.length, items: list.map(({ path, rel, ...rest }) => rest) });
    }
    if (method === 'POST') {
      const b = await readBody(req);
      const author = cleanText(b.author) || '其他';
      const title = cleanText(b.title) || '未命名';
      const tags = Array.isArray(b.tags) ? b.tags.map(cleanText).filter(Boolean) : [];
      const date = cleanText(b.date) || new Date().toISOString().slice(0, 10);
      const body = typeof b.body === 'string' ? b.body : '';
      const dir = path.join(SRC, author);
      fs.mkdirSync(dir, { recursive: true });
      const file = ensureUnique(path.join(dir, `${title}.md`));
      const data = { 标题: title, tags, 创建时间: date };
      fs.writeFileSync(file, serialize(data, body));
      const rel = path.relative(SRC, file);
      return sendJson(res, 200, { ok: true, id: slugify(rel) });
    }
  }

  if (seg[1] === 'articles' && seg[2]) {
    const id = decodeURIComponent(seg[2]);
    const meta = idToPath(id);
    if (!meta) return sendJson(res, 404, { error: '文章不存在' });
    if (method === 'GET') {
      const raw = fs.readFileSync(meta.f, 'utf8');
      const { data, body } = parseMd(raw);
      return sendJson(res, 200, {
        id, author: meta.author, title: cleanText(data.标题) || path.basename(meta.f, '.md'),
        tags: Array.isArray(data.tags) ? data.tags : (Array.isArray(data.标签) ? data.标签 : []), date: cleanText(data.创建时间) || cleanText(data.日期) || '',
        body,
      });
    }
    if (method === 'PUT') {
      const b = await readBody(req);
      const raw = fs.readFileSync(meta.f, 'utf8');
      const { data, body: oldBody } = parseMd(raw);
      if (b.title !== undefined) data.标题 = cleanText(b.title);
      if (b.tags !== undefined) data.tags = Array.isArray(b.tags) ? b.tags.map(cleanText).filter(Boolean) : [];
      if (b.date !== undefined) { data.创建时间 = cleanText(b.date); delete data.日期; }
      const newBody = typeof b.body === 'string' ? b.body : oldBody;
      fs.writeFileSync(meta.f, serialize(data, newBody));
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      const dest = trashPath(meta.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(meta.f, dest);
      return sendJson(res, 200, { ok: true, trashed: path.relative(SRC, dest) });
    }
  }

  if (seg[1] === 'move' && method === 'POST') {
    const b = await readBody(req);
    const id = decodeURIComponent(b.id || '');
    const newAuthor = cleanText(b.newAuthor) || '其他';
    const meta = idToPath(id);
    if (!meta) return sendJson(res, 404, { error: '文章不存在' });
    const destDir = path.join(SRC, newAuthor);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = ensureUnique(path.join(destDir, path.basename(meta.f)));
    fs.renameSync(meta.f, dest);
    return sendJson(res, 200, { ok: true, id: slugify(path.relative(SRC, dest)) });
  }

  if (seg[1] === 'authors' && seg[2] === 'rename' && method === 'POST') {
    const b = await readBody(req);
    const old = cleanText(b.old), neu = cleanText(b.new);
    if (!old || !neu || old === neu) return sendJson(res, 400, { error: '参数无效' });
    const oldP = path.join(SRC, old), neuP = path.join(SRC, neu);
    if (!fs.existsSync(oldP)) return sendJson(res, 404, { error: '原作者不存在' });
    if (fs.existsSync(neuP)) return sendJson(res, 400, { error: '目标作者已存在' });
    fs.renameSync(oldP, neuP);
    return sendJson(res, 200, { ok: true });
  }

  if (seg[1] === 'authors' && seg[2] === 'merge' && method === 'POST') {
    const b = await readBody(req);
    const src = cleanText(b.src), dst = cleanText(b.dst);
    if (!src || !dst || src === dst) return sendJson(res, 400, { error: '参数无效' });
    const srcP = path.join(SRC, src), dstP = path.join(SRC, dst);
    if (!fs.existsSync(srcP)) return sendJson(res, 404, { error: '源作者不存在' });
    fs.mkdirSync(dstP, { recursive: true });
    let moved = 0;
    for (const e of fs.readdirSync(srcP)) {
      if (e.startsWith('.')) continue;
      const dest = ensureUnique(path.join(dstP, e));
      fs.renameSync(path.join(srcP, e), dest);
      moved++;
    }
    fs.rmdirSync(srcP, { recursive: true });
    return sendJson(res, 200, { ok: true, moved });
  }

  if (seg[1] === 'rebuild' && method === 'POST') {
    return new Promise((resolve) => {
      const child = execFile(
        process.execPath,
        ['scripts/build.mjs'],
        { cwd: ROOT, env: { ...process.env, NODE_PATH: [process.env.NODE_PATH, path.join(ROOT, 'node_modules')].filter(Boolean).join(path.delimiter) }, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) return resolve(sendJson(res, 500, { ok: false, error: stderr || err.message }));
          resolve(sendJson(res, 200, { ok: true, output: (stdout + stderr).slice(-2000) }));
        }
      );
    });
  }

  if (seg[1] === 'deploy' && method === 'POST') {
    const token = process.env.GITHUB_PAT || (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'config.local.json'), 'utf8')).githubToken; } catch { return ''; } })();
    if (!token) return sendJson(res, 400, { ok: false, error: '未配置 GitHub token（config.local.json.githubToken 或环境变量 GITHUB_PAT），请手动推送。' });
    const remote = `https://${token}@github.com/hhz5/clippings-knowledge-hub.git`;
    return new Promise((resolve) => {
      const steps = [
        ['git', ['add', '-A']],
        ['git', ['commit', '-m', `admin: 内容更新 ${new Date().toISOString().slice(0, 10)}`]],
        ['git', ['remote', 'set-url', 'origin', remote]],
        ['git', ['push', 'origin', 'main']],
        ['git', ['remote', 'set-url', 'origin', 'https://github.com/hhz5/clippings-knowledge-hub.git']],
      ];
      let i = 0, out = '';
      const next = () => {
        if (i >= steps.length) return resolve(sendJson(res, 200, { ok: true, output: out.slice(-2000) }));
        const [cmd, args] = steps[i++];
        execFile(cmd, args, { cwd: ROOT, env: process.env, maxBuffer: 64 * 1024 * 1024 }, (err, so, se) => {
          out += `$ ${cmd} ${args.join(' ')}\n${so}${se}\n`;
          if (err) return resolve(sendJson(res, 500, { ok: false, error: out.slice(-2000) }));
          next();
        });
      };
      next();
    });
  }

  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host}`); } catch { res.writeHead(400); res.end('bad url'); return; }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return safeStatic(url.pathname, res);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`剪藏管理后台已启动：http://localhost:${PORT}/`);
  console.log(`源目录：${SRC}`);
  console.log('管理后台地址：http://localhost:' + PORT + '/admin/');
});
