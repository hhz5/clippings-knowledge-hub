'use strict';

const state = { author: null, tag: null, q: '' };
let DATA = null;
let renderList = [];
let renderPos = 0;
const PAGE = 48;
const $ = (id) => document.getElementById(id);

// ---------- 主题 ----------
function initTheme() {
  const btn = $('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('theme', cur); } catch (e) {}
  });
}
initTheme();

// ---------- 数据加载 ----------
function boot() {
  try {
    if (typeof window.__DATA__ !== 'undefined' && window.__DATA__) {
      initWithData(window.__DATA__);
      return;
    }
  } catch (e) {}
  fetch('assets/data.json')
    .then((r) => r.json())
    .then(initWithData)
    .catch((e) => showError('数据加载失败：' + e.message));
}

function initWithData(d) {
  if (!d || !Array.isArray(d.articles)) {
    showError('数据格式异常');
    return;
  }
  DATA = d;
  applyUrl();
  buildSidebar();
  renderHero();
  renderReset();
}

function showError(msg) {
  const el = $('empty');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `<div class="empty-icon">⚠️</div><p>${esc(msg)}</p>`;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ---------- URL 参数 ----------
function applyUrl() {
  const p = new URLSearchParams(location.search);
  state.author = decodeURIComponentSafe(p.get('author')) || null;
  state.tag = decodeURIComponentSafe(p.get('tag')) || null;
  state.q = p.get('q') || '';
  const input = $('searchInput');
  if (input) input.value = state.q;
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.author) p.set('author', encodeURIComponent(state.author));
  if (state.tag) p.set('tag', encodeURIComponent(state.tag));
  if (state.q) p.set('q', state.q);
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

function decodeURIComponentSafe(s) {
  if (!s) return s;
  try { return decodeURIComponent(s); } catch { return s; }
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
  const ac = $('authorCount');
  const tc = $('tagCount');
  if (ac) ac.textContent = authors.length;
  if (tc) tc.textContent = tags.length;

  const al = $('authorList');
  if (al) {
    al.innerHTML = '';
    for (const [name, n] of authors) {
      const row = document.createElement('a');
      row.className = 'author-row' + (state.author === name ? ' active' : '');
      row.href = '?author=' + encodeURIComponent(name);
      row.innerHTML = `<span>${esc(name)}</span><span class="n">${n}</span>`;
      row.addEventListener('click', (e) => { e.preventDefault(); toggleAuthor(name); });
      al.appendChild(row);
    }
  }

  renderTags(tags, false);
}

const TAG_MIN = 3;
function renderTags(tags, showAll) {
  const tl = $('tagList');
  if (!tl) return;
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
  syncUrl(); buildSidebar(); renderReset();
}
function toggleTag(name) {
  state.tag = state.tag === name ? null : name;
  syncUrl(); buildSidebar(); renderReset();
}

// ---------- 搜索 ----------
let searchT;
const input = $('searchInput');
if (input) {
  input.addEventListener('input', (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      state.q = e.target.value.trim();
      syncUrl();
      renderReset();
    }, 160);
  });
}

function tokenize(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }

function scoreArticle(a, terms) {
  if (!terms.length) return 0;
  let total = 0;
  const fields = [
    [a.title, 6], [a.author, 4], [(a.tags || []).join(' '), 5],
    [a.summary, 3], [a.bodyText, 1],
  ];
  for (const term of terms) {
    let termHit = false;
    for (const [text, w] of fields) {
      if (!text) continue;
      const idx = text.toLowerCase().indexOf(term);
      if (idx >= 0) { total += w; termHit = true; }
    }
    if (!termHit) return -1;
  }
  return total;
}

// ---------- 渲染 ----------
function filtered() {
  const terms = tokenize(state.q);
  let list = DATA.articles.filter((a) => {
    if (state.author && a.author !== state.author) return false;
    if (state.tag && !(a.tags || []).includes(state.tag)) return false;
    return true;
  });
  if (terms.length) {
    list = list
      .map((a) => ({ a, s: scoreArticle(a, terms) }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
  } else {
    list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }
  return list;
}

function renderHead() {
  let title = '全部剪藏';
  if (state.author) title = '作者 · ' + state.author;
  else if (state.tag) title = '标签 · ' + state.tag;
  const rt = $('resultTitle');
  if (rt) rt.textContent = title;
  const rs = $('resultSub');
  if (rs) rs.textContent = `${renderList.length} 篇` + (state.q ? ` · 匹配「${state.q}」` : '');

  const fb = $('filterBar');
  if (!fb) return;
  if (state.author || state.tag || state.q) {
    fb.style.display = 'flex';
    const parts = [];
    if (state.author) parts.push(`<span class="chip active">作者: ${esc(state.author)}</span>`);
    if (state.tag) parts.push(`<span class="chip active">标签: ${esc(state.tag)}</span>`);
    if (state.q) parts.push(`<span class="chip active">搜索: ${esc(state.q)}</span>`);
    parts.push('<a class="clear" id="clearAll">清除全部 ✕</a>');
    fb.innerHTML = parts.join('');
    const clear = $('clearAll');
    if (clear) clear.addEventListener('click', () => {
      state.author = null; state.tag = null; state.q = '';
      const inp = $('searchInput');
      if (inp) inp.value = '';
      syncUrl(); buildSidebar(); renderReset();
    });
  } else {
    fb.style.display = 'none';
    fb.innerHTML = '';
  }
}

function renderReset() {
  renderList = filtered();
  renderPos = 0;
  const grid = $('grid');
  if (grid) grid.innerHTML = '';
  const empty = $('empty');
  if (empty) empty.style.display = renderList.length ? 'none' : 'block';
  renderHead();
  renderHero();
  renderChunk();
}

function renderChunk() {
  const grid = $('grid');
  if (!grid) return;
  const frag = document.createDocumentFragment();
  const end = Math.min(renderPos + PAGE, renderList.length);
  for (; renderPos < end; renderPos++) {
    try {
      const c = card(renderList[renderPos]);
      if (c) frag.appendChild(c);
    } catch (e) {
      // 单卡异常隔离
    }
  }
  grid.appendChild(frag);
}

// 哨兵滚动加载
function initSentinel() {
  const sentinel = $('sentinel');
  if (!sentinel) return;
  const io = new IntersectionObserver((es) => {
    if (es[0].isIntersecting && renderPos < renderList.length) {
      renderChunk();
    }
  }, { rootMargin: '200px' });
  io.observe(sentinel);
}
initSentinel();

// ---------- Hero ----------
function renderHero() {
  const hero = $('hero');
  const heroGrid = $('heroGrid');
  if (!hero || !heroGrid) return;
  if (state.author || state.tag || state.q) {
    hero.style.display = 'none';
    return;
  }
  const latest = DATA.articles.slice(0, 3);
  if (!latest.length) return;
  hero.style.display = 'block';
  heroGrid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const a of latest) {
    try { frag.appendChild(card(a, true)); } catch {}
  }
  heroGrid.appendChild(frag);
}

// ---------- 卡片 ----------
function card(a, featured) {
  const el = document.createElement('a');
  el.className = 'card' + (featured ? ' hero-card' : '');
  el.href = a.url || '#';

  const cover = a.cover
    ? `<img class="card-cover" src="${esc(a.cover)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`
    : '';
  const ph = placeholderHtml(a.author);
  const tags = (a.tags || []).slice(0, 3).map((t) => `<span class="t">${esc(t)}</span>`).join('');
  const dateStr = a.date || '';

  el.innerHTML = `
    <div class="cover-wrap" style="overflow:hidden">
      ${cover}
      <div class="card-cover ph" style="display:${a.cover ? 'none' : 'grid'};${ph.style}">${ph.text}</div>
    </div>
    <div class="card-body">
      <h3 class="card-title">${esc(a.title)}</h3>
      ${a.summary ? `<p class="card-summary">${esc(a.summary)}</p>` : ''}
      <div class="card-tags">${tags}</div>
      <div class="card-meta">
        <span class="avatar" style="${ph.style}">${avatarText(a.author)}</span>
        <span class="card-author">${esc(a.author)}</span>
        ${dateStr ? `<span class="card-date">${dateStr}</span>` : ''}
      </div>
    </div>`;
  return el;
}

function avatarText(name) {
  if (!name) return '?';
  const clean = name.replace(/^其他$/, '其').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  if (!clean) return name.charAt(0);
  // 中文取前1字，英文取前2字母
  if (/^[\u4e00-\u9fa5]/.test(clean)) return clean.charAt(0);
  return clean.slice(0, 2).toUpperCase();
}

function placeholderHtml(author) {
  const palette = authorPalette(author);
  return {
    text: avatarText(author),
    style: `--ph1:${palette[0]};--ph2:${palette[1]};background:linear-gradient(135deg,var(--ph1),var(--ph2))`,
  };
}

function authorPalette(author) {
  const warm = [
    ['#c2410c', '#ea580c'], ['#b45309', '#d97706'], ['#be123c', '#e11d48'],
    ['#7c2d12', '#9a3412'], ['#92400e', '#b45309'], ['#a21caf', '#c026d3'],
    ['#4338ca', '#6366f1'], ['#0f766e', '#14b8a6'], ['#1d4ed8', '#3b82f6'],
  ];
  let h = 0;
  for (let i = 0; i < (author || '').length; i++) h = (h * 31 + author.charCodeAt(i)) >>> 0;
  return warm[h % warm.length];
}

// ---------- 移动端抽屉 ----------
function initDrawer() {
  const sidebar = $('sidebar');
  const scrim = $('scrim');
  const filterBtn = $('filterBtn');
  const sideClose = $('sideClose');
  if (!sidebar || !scrim) return;

  function open() { sidebar.classList.add('open'); scrim.classList.add('show'); }
  function close() { sidebar.classList.remove('open'); scrim.classList.remove('show'); }

  if (filterBtn) filterBtn.addEventListener('click', open);
  if (sideClose) sideClose.addEventListener('click', close);
  scrim.addEventListener('click', close);

  // 点击侧栏筛选项后自动关闭抽屉
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.author-row') || e.target.closest('.chip')) {
      setTimeout(close, 120);
    }
  });
}
initDrawer();

// ---------- 工具 ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
