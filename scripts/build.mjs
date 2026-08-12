import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const SRC = '/Users/han/Desktop/Haaan/剪藏文件';
const OUT = '/Users/han/Sites/WorkBuddy/剪藏网站';
const ART = path.join(OUT, 'articles');
const ASSETS = path.join(OUT, 'assets');

// ---------- 清洗规则 ----------
const SYSTEM_TAGS = new Set(['clippings', '剪藏']);

// 近义标签合并：变体 -> 规范名
const TAG_MERGE = {
  '提示词工程': '提示词', 'Prompt工程': '提示词', 'Prompt': '提示词', 'Prompt心法': '提示词',
  'AI视频生成': 'AI视频', 'AI视频创作': 'AI视频',
  '图片生成': '图像生成',
  'AI生图': 'AI绘画',
  'NanoBanana': 'Nano Banana', 'Banana Pro': 'Nano Banana',
  'AI Agent': 'Agent',
  '办公效率': '效率',
  '开源项目': '开源',
  'AI编程': '编程',
  'Gemini 3.0 Pro': 'Gemini 3',
  'Claude Skill': 'Skill', 'Skill管理': 'Skill',
  '视频创作': '视频制作',
  '大语言模型': '大模型',
  'AI短剧': '短剧',
  '编剧': '剧本创作',
  '即梦图片': '即梦', '即梦图片4.0': '即梦',
};

// ---------- 工具 ----------
function cleanText(s) {
  return String(s == null ? '' : s)
    .replace(/\\?x26quot;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

function toPlain(md) {
  return cleanText(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')        // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // 链接保留文字
    .replace(/```[\s\S]*?```/g, ' ')              // 代码块
    .replace(/[#>*_`~\-]/g, ' ')                  // 标记符号
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFront(raw) {
  if (!raw.startsWith('---')) return { data: {}, content: raw };
  try {
    const { data, content } = matter(raw);
    return { data, content };
  } catch {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m) return { data: {}, content: raw };
    const data = {};
    for (const line of m[1].split('\n')) {
      const km = line.match(/^([^:：]+)[:：]\s*"(.*)"\s*$/);
      if (km) { data[km[1].trim()] = km[2]; continue; }
      const tm = line.match(/^-\s*"(.*)"\s*$/);
      if (tm) (data.tags ||= []).push(tm[1]);
    }
    return { data, content: raw.slice(m[0].length) };
  }
}

function normTag(t) {
  let s = cleanText(t);
  if (!s || SYSTEM_TAGS.has(s)) return null;
  if (TAG_MERGE[s]) s = TAG_MERGE[s];
  return s;
}

function slugify(rel) {
  return rel.replace(/\.md$/i, '')
    .replace(/[/\\]/g, '_')
    .replace(/["<>:|?*]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function firstImage(md) {
  // 跳过微信公众平台等带反盗链的图床，避免卡片封面显示“未经允许不可引用”占位图
  const blocked = /mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn/;
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  for (const m of md.matchAll(re)) {
    const url = m[1];
    if (blocked.test(url)) continue;
    return url;
  }
  return '';
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { display: '', ts: 0 };
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return { display: `${y}-${mo}-${da}`, ts: d.getTime() };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // 跳过隐藏/系统目录（如 .workbuddy）
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// ---------- 主流程 ----------
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

const files = walk(SRC);
const articles = [];
const authorSet = new Set();
const tagSet = new Set();
const usedSlugs = new Set();
const authorDroppedTags = new Set();

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const parsed = parseFront(raw);
  const data = parsed.data || {};
  const rel = path.relative(SRC, f);

  let slug = slugify(rel);
  while (usedSlugs.has(slug)) slug += '_';
  usedSlugs.add(slug);

  // 作者 = 直接父文件夹名；根目录文件归入「其他」
  const dir = path.dirname(rel);
  const author = dir === '.' ? '其他' : dir;
  authorSet.add(author);

  const rawTags = Array.isArray(data.tags) ? data.tags : [];
  const tags = [];
  for (const t of rawTags) {
    const nt = normTag(t);
    if (!nt) continue;
    if (nt === author) { authorDroppedTags.add(nt); continue; } // 作者即标签，丢弃
    if (!tags.includes(nt)) tags.push(nt);
    tagSet.add(nt);
  }

  const body = parsed.content;
  const plainBody = toPlain(body);
  const htmlBody = marked.parse(body);
  const cover = firstImage(body);

  let dateObj;
  if (data.创建时间) {
    dateObj = fmtDate(data.创建时间);
  } else {
    const m = fs.statSync(f).mtime;
    dateObj = { display: m.toISOString().slice(0, 10), ts: m.getTime() };
  }
  const { display: date, ts } = dateObj;

  const title = cleanText(data.标题) || path.basename(f, '.md');
  const summary = cleanText(data.摘要);
  const link = cleanText(data.链接);

  const url = `articles/${slug}.html`;
  articles.push({
    id: slug, url, title, author, date, ts, summary, cover,
    tags, bodyText: plainBody.slice(0, 60000),
    link,
  });

  // 生成文章页
  const tagChips = tags.map(t =>
    `<a class="chip" href="../index.html?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('');
  const articleHtml = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 剪藏知识库</title>
<link rel="stylesheet" href="../assets/style.css">
<script>
  (function(){ try { var t = localStorage.getItem('theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch(e){} })();
</script>
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="../index.html">剪藏<span>知识库</span></a>
    <button class="theme-toggle" id="themeToggle" aria-label="切换主题">🌓</button>
  </div>
</header>
<main class="wrap article">
  <a class="back" href="../index.html">← 返回总览</a>
  <h1 class="article-title">${esc(title)}</h1>
  <div class="meta">
    <a class="chip author" href="../index.html?author=${encodeURIComponent(author)}">${esc(author)}</a>
    ${tagChips}
    ${date ? `<span class="date">${date}</span>` : ''}
  </div>
  ${summary ? `<p class="lead">${esc(summary)}</p>` : ''}
  <article class="content">${htmlBody}</article>
  ${link ? `<p class="orig"><a href="${esc(link)}" target="_blank" rel="noopener">查看原文 ↗</a></p>` : ''}
</main>
<script>
  (function(){
    var btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', function(){
      var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', cur);
      try { localStorage.setItem('theme', cur); } catch(e){}
    });
  })();
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(ART, `${slug}.html`), articleHtml);
}

// 按时间倒序
articles.sort((a, b) => b.ts - a.ts);

// data.json
const dataPayload = { articles, authors: [...authorSet].sort(), tags: [...tagSet].sort() };
fs.writeFileSync(path.join(ASSETS, 'data.json'), JSON.stringify(dataPayload));

// data.js — 直接内联数据，支持 file:// 协议下无需 fetch 即可打开
const payload = JSON.stringify(dataPayload).replace(/</g, '\\u003c');
fs.writeFileSync(path.join(ASSETS, 'data.js'), 'window.__DATA__ = ' + payload + ';\n');

// tags-report.json
const report = {
  generatedAt: new Date().toISOString(),
  totalArticles: articles.length,
  uniqueAuthors: authorSet.size,
  uniqueTagsAfter: tagSet.size,
  systemTagsRemoved: [...SYSTEM_TAGS],
  tagMergeMap: TAG_MERGE,
  authorModel: '文件夹名为作者；根目录文件归入「其他」',
  authorNameTagsDropped: [...authorDroppedTags],
};
fs.writeFileSync(path.join(OUT, 'tags-report.json'), JSON.stringify(report, null, 2));

console.log(`生成完成：文章页 ${articles.length} 篇，作者 ${authorSet.size} 位，标签 ${tagSet.size} 个`);
console.log(`data.json 体积：${(fs.statSync(path.join(ASSETS, 'data.json')).size / 1024 / 1024).toFixed(2)} MB`);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
