import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { loadSrc } from './config.mjs';

const SRC = loadSrc();

// 健壮 frontmatter 解析：gray-matter 失败时回退正则解析，处理内部未转义引号等脏数据
function parseFront(raw) {
  if (!raw.startsWith('---')) return null;
  try {
    const { data } = matter(raw);
    return data;
  } catch {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m) return null;
    const block = m[1];
    const data = {};
    for (const line of block.split('\n')) {
      const km = line.match(/^([^:：]+)[:：]\s*"(.*)"\s*$/);
      if (km) { data[km[1].trim()] = km[2]; continue; }
      const tm = line.match(/^-\s*"(.*)"\s*$/);
      if (tm) { (data.tags ||= []).push(tm[1]); }
    }
    return data;
  }
}

function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\\?x26quot;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const tagCount = new Map();
const authorCount = new Map();
let noFront = 0, fallback = 0;

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const data = parseFront(raw);
  if (!data || (!data.作者 && !data.tags)) { noFront++; continue; }
  if (!data.作者 || !data.tags) fallback++; // 走了兜底解析
  const author = clean(data.作者).replace(/[\[\]]/g, '') || '未知';
  authorCount.set(author, (authorCount.get(author) || 0) + 1);
  const tags = Array.isArray(data.tags) ? data.tags : [];
  for (const t of tags) tagCount.set(clean(t), (tagCount.get(clean(t)) || 0) + 1);
}

console.log('总文件:', files.length, '| 无frontmatter:', noFront, '| 走兜底解析:', fallback);
console.log('\n=== 标签 (', tagCount.size, '个去重 ) ===');
for (const [t, c] of [...tagCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(c).padStart(4)}  ${t}`);
}
console.log('\n=== 作者 (', authorCount.size, '个去重 ) ===');
for (const [a, c] of [...authorCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(c).padStart(4)}  ${a}`);
}
