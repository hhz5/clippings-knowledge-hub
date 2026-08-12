'use strict';

const state = { author: null, tag: null, q: '' };
let DATA = null;
const $ = (id) => document.getElementById(id);

// ---------- 主题 ----------
$('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', cur);
  try { localStorage.setItem('theme', cur); } catch (e) {}
});

// ---------- 数据加载 ----------
function initWithData(d) {
  DATA = d;
  applyUrl();
  buildSidebar();
  render();
}
if (typeof __DATA__ !== 'undefined') {
  initWithData(__DATA__);
} else {
  fetch('assets/data.json')
    .then((r) => r.json())
    .then(initWithData)
    .catch((e) => {
      $('empty').style.display = 'block';
      $('empty').textContent = '数据加载失败：' + e.message;
    });
}

// ---------- URL 参数 ----------
function applyUrl() {
  const p = new URLSearchParams(location.search);
  state.author = p.get('author') || null;
  state.tag = p.get('tag') || null;
  state.q = p.get('q') || '';
  $('searchInput').value = state.q;
}
function syncUrl() {
  const p = new URLSearchParams();
  if (state.author) p.set('author', state.author);
  if (state.tag) p.set('tag', state.tag);
  if (state.q) p.set('q', state.q);
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

// ---------- 侧栏 ----------
function counts(key) {
  const m = new Map();
  for (const a of DATA.articles) {
    const vals = Array.isArray(a[key]) ? a[key] : [a[key]];
    for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function buildSidebar() {
  const authors = counts('author');
  const tags = counts('tags');
  $('authorCount').textContent = authors.length;
  $('tagCount').textContent = tags.length;

  const al = $('authorList');
  al.innerHTML = '';
  for (const [name, n] of authors) {
    const row = document.createElement('a');
    row.className = 'author-row' + (state.author === name ? ' active' : '');
    row.href = '?author=' + encodeURIComponent(name);
    row.innerHTML = `<span>${esc(name)}</span><span class="n">${n}</span>`;
    row.addEventListener('click', (e) => { e.preventDefault(); toggleAuthor(name); });
    al.appendChild(row);
  }

  renderTags(tags, false);
}

// 标签侧栏：默认仅展示出现≥3次的常用标签，可展开全部
const TAG_MIN = 3;
function renderTags(tags, showAll) {
  const tl = $('tagList');
  tl.innerHTML = '';
  const visible = showAll ? tags : tags.filter(([, n]) => n >= TAG_MIN);
  for (const [name, n] of visible) {
    const c = document.createElement('a');
    c.className = 'chip' + (state.tag === name ? ' active' : '');
    c.href = '?tag=' + encodeURIComponent(name);
    c.innerHTML = `${esc(name)} <span class="n">${n}</span>`;
    c.addEventListener('click', (e) => { e.preventDefault(); toggleTag(name); });
    tl.appendChild(c);
  }
  if (tags.length > visible.length) {
    const more = document.createElement('a');
    more.className = 'chip';
    more.style.cursor = 'pointer';
    more.textContent = showAll ? '收起 ▴' : `展开全部 ${tags.length} 个 ▾`;
    more.addEventListener('click', (e) => { e.preventDefault(); renderTags(tags, !showAll); });
    tl.appendChild(more);
  }
}

// ---------- 筛选交互 ----------
function toggleAuthor(name) {
  state.author = state.author === name ? null : name;
  syncUrl(); buildSidebar(); render();
}
function toggleTag(name) {
  state.tag = state.tag === name ? null : name;
  syncUrl(); buildSidebar(); render();
}

// ---------- 搜索评分（中文友好的子串加权） ----------
function tokenize(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }

function scoreArticle(a, terms) {
  if (!terms.length) return 0;
  let total = 0;
  const fields = [
    [a.title, 6], [a.author, 4], [a.tags.join(' '), 5],
    [a.summary, 3], [a.bodyText, 1],
  ];
  for (const term of terms) {
    let termHit = false;
    for (const [text, w] of fields) {
      if (!text) continue;
      const idx = text.toLowerCase().indexOf(term);
      if (idx >= 0) { total += w; termHit = true; }
    }
    if (!termHit) return -1; // 任一词未命中则整体不匹配（AND 语义）
  }
  return total;
}

// ---------- 渲染网格 ----------
function filtered() {
  const terms = tokenize(state.q);
  let list = DATA.articles.filter((a) => {
    if (state.author && a.author !== state.author) return false;
    if (state.tag && !a.tags.includes(state.tag)) return false;
    return true;
  });
  if (terms.length) {
    list = list
      .map((a) => ({ a, s: scoreArticle(a, terms) }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
  } else {
    list.sort((a, b) => b.ts - a.ts);
  }
  return list;
}

function render() {
  const list = filtered();
  // 标题与副标题
  let title = '全部剪藏';
  if (state.author) title = '作者 · ' + state.author;
  else if (state.tag) title = '标签 · ' + state.tag;
  $('resultTitle').textContent = title;
  $('resultSub').textContent = `${list.length} 篇` + (state.q ? ` · 匹配「${state.q}」` : '');

  // 筛选条
  const fb = $('filterBar');
  if (state.author || state.tag || state.q) {
    fb.style.display = 'flex';
    const parts = [];
    if (state.author) parts.push(`<span class="chip active">作者: ${esc(state.author)}</span>`);
    if (state.tag) parts.push(`<span class="chip active">标签: ${esc(state.tag)}</span>`);
    if (state.q) parts.push(`<span class="chip active">搜索: ${esc(state.q)}</span>`);
    parts.push('<a class="clear" id="clearAll">清除全部 ✕</a>');
    fb.innerHTML = parts.join('');
    $('clearAll').addEventListener('click', () => {
      state.author = state.tag = null; state.q = '';
      $('searchInput').value = '';
      syncUrl(); buildSidebar(); render();
    });
  } else {
    fb.style.display = 'none';
  }

  // 卡片
  const grid = $('grid');
  grid.innerHTML = '';
  $('empty').style.display = list.length ? 'none' : 'block';
  const frag = document.createDocumentFragment();
  for (const a of list) frag.appendChild(card(a));
  grid.appendChild(frag);
}

function card(a) {
  const el = document.createElement('a');
  el.className = 'card';
  el.href = a.url;
  const cover = a.cover
    ? `<img class="card-cover" src="${esc(a.cover)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="card-cover placeholder">无封面</div>`;
  const tags = a.tags.slice(0, 3).map((t) => `<span class="t">${esc(t)}</span>`).join('');
  el.innerHTML = `
    ${cover}
    <div class="card-body">
      <h3 class="card-title">${esc(a.title)}</h3>
      ${a.summary ? `<p class="card-summary">${esc(a.summary)}</p>` : ''}
      <div class="card-tags">${tags}</div>
      <div class="card-meta">
        <span class="card-author">${esc(a.author)}</span>
        <span class="card-date">${a.date || ''}</span>
      </div>
    </div>`;
  return el;
}

// ---------- 搜索输入 ----------
let t;
$('searchInput').addEventListener('input', (e) => {
  clearTimeout(t);
  t = setTimeout(() => {
    state.q = e.target.value.trim();
    syncUrl(); render();
  }, 160);
});

// ---------- 工具 ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
