'use strict';

const $ = (id) => document.getElementById(id);
const api = (p, opt) => fetch(p, opt).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status + ' ' + (r.statusText || '')))));
let ENABLED = false;
let editingId = null;
let staticItems = [];

function setMsg(text, kind) {
  const el = $('opMsg');
  el.textContent = text || '';
  el.className = 'op-msg' + (kind ? ' ' + kind : '');
}

// 主题
(function () {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch {}
  $('themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('theme', cur); } catch {}
  });
})();

async function load() {
  try {
    await api('/api/status');
    ENABLED = true;
    ['search', 'authorFilter', 'newBtn', 'rebuildBtn', 'deployBtn'].forEach((id) => { $(id).disabled = false; });
    $('roBanner').style.display = 'none';
    await refresh();
  } catch {
    ENABLED = false;
    $('roBanner').style.display = 'block';
    setMsg('只读模式：请在本地运行管理服务器以编辑内容。', 'err');
    await loadStatic();
  }
}

async function loadStatic() {
  // Pages 等静态托管无 /api，回退到构建好的 data.json 做只读浏览
  try {
    const res = await fetch('../assets/data.json');
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const data = await res.json();
    staticItems = (data.articles || []).map((a) => ({
      id: a.id, title: a.title, author: a.author, date: a.date, tags: a.tags || []
    }));
    $('count').textContent = staticItems.length;
    renderList(staticItems);
    renderAuthorFilter(staticItems);
    renderAuthors(staticItems);
    // 只读模式下仍允许搜索/筛选
    $('search').disabled = false;
    $('authorFilter').disabled = false;
  } catch (e) {
    setMsg('只读模式：未能加载文章数据（' + e.message + '）', 'err');
  }
}

function refreshStatic() {
  const q = $('search').value.trim().toLowerCase();
  const author = $('authorFilter').value;
  let list = staticItems;
  if (author) list = list.filter((a) => a.author === author);
  if (q) {
    list = list.filter((a) =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.author || '').toLowerCase().includes(q) ||
      (a.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }
  $('count').textContent = list.length;
  renderList(list);
}

async function refresh() {
  const q = $('search').value.trim();
  const author = $('authorFilter').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (author) params.set('author', author);
  const data = await api('/api/articles?' + params.toString());
  $('count').textContent = data.count;
  renderList(data.items);
  renderAuthorFilter(data.items);
  renderAuthors(data.items);
}

function renderList(items) {
  const box = $('list');
  box.innerHTML = '';
  if (!items.length) { box.innerHTML = '<p style="color:var(--muted)">无匹配文章。</p>'; return; }
  const frag = document.createDocumentFragment();
  for (const a of items) {
    const row = document.createElement('div');
    row.className = 'item';
    const tags = (a.tags || []).slice(0, 4).map((t) => `<span class="tagpill">${esc(t)}</span>`).join('');
    const acts = ENABLED ? `
      <div class="acts">
        <button class="mini" data-act="edit" data-id="${enc(a.id)}">编辑</button>
        <button class="mini" data-act="move" data-id="${enc(a.id)}" data-author="${enc(a.author)}">移动</button>
        <button class="mini danger" data-act="del" data-id="${enc(a.id)}">删除</button>
      </div>` : '';
    row.innerHTML = `
      <div class="t">
        <div class="ti">${esc(a.title)}</div>
        <div class="sub">${esc(a.author)} · ${esc(a.date || '—')} · ${tags}</div>
      </div>${acts}`;
    frag.appendChild(row);
  }
  box.appendChild(frag);
  if (ENABLED) {
    box.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => onAct(b.dataset.act, b.dataset.id, b.dataset.author)));
  }
}

function renderAuthorFilter(items) {
  const sel = $('authorFilter');
  const cur = sel.value;
  const set = {};
  for (const a of items) set[a.author] = (set[a.author] || 0) + 1;
  sel.innerHTML = '<option value="">全部作者</option>' + Object.keys(set).sort().map((n) => `<option value="${enc(n)}">${esc(n)} (${set[n]})</option>`).join('');
  sel.value = cur;
  sel.disabled = !ENABLED && items.length === 0;
}

function renderAuthors(items) {
  const box = $('authors');
  const set = {};
  for (const a of items) set[a.author] = (set[a.author] || 0) + 1;
  box.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const n of Object.keys(set).sort()) {
    const c = document.createElement('div');
    c.className = 'acard';
    const arow = ENABLED ? `
      <div class="arow">
        <button class="mini" data-a="rename" data-n="${enc(n)}">重命名</button>
        <button class="mini" data-a="merge" data-n="${enc(n)}">合并</button>
      </div>` : '';
    c.innerHTML = `
      <div class="an">${esc(n)}</div>
      <div class="ac">${set[n]} 篇</div>${arow}`;
    frag.appendChild(c);
  }
  box.appendChild(frag);
  if (ENABLED) {
    box.querySelectorAll('button[data-a]').forEach((b) => b.addEventListener('click', () => onAuthor(b.dataset.a, b.dataset.n)));
  }
}

function onAct(act, id, author) {
  if (!ENABLED) return;
  if (act === 'edit') return openEdit(id);
  if (act === 'del') return doDelete(id);
  if (act === 'move') {
    const neu = prompt('移动到作者（文件夹）：', author);
    if (!neu) return;
    api('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, newAuthor: neu }) })
      .then(() => { setMsg('已移动', 'ok'); refresh(); })
      .catch((e) => setMsg('移动失败：' + e.message, 'err'));
  }
}

function onAuthor(act, name) {
  if (!ENABLED) return;
  if (act === 'rename') {
    const neu = prompt('重命名为：', name);
    if (!neu || neu === name) return;
    api('/api/authors/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ old: name, new: neu }) })
      .then(() => { setMsg('已重命名', 'ok'); refresh(); })
      .catch((e) => setMsg('失败：' + e.message, 'err'));
  } else if (act === 'merge') {
    const dst = prompt('合并到作者（文件夹）：', '');
    if (!dst) return;
    if (!confirm(`将「${name}」的全部文章合并到「${dst}」？`)) return;
    api('/api/authors/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: name, dst }) })
      .then((r) => { setMsg(`已合并 ${r.moved} 篇`, 'ok'); refresh(); })
      .catch((e) => setMsg('失败：' + e.message, 'err'));
  }
}

async function openEdit(id) {
  editingId = id;
  $('modalTitle').textContent = '编辑文章';
  $('deleteBtn').style.display = '';
  try {
    const a = await api('/api/articles/' + enc(id));
    $('fAuthor').value = a.author;
    $('fTitle').value = a.title;
    $('fTags').value = (a.tags || []).join(', ');
    $('fDate').value = a.date;
    $('fBody').value = a.body;
  } catch (e) { setMsg('读取失败：' + e.message, 'err'); }
  $('modal').style.display = 'flex';
}

function openNew() {
  editingId = null;
  $('modalTitle').textContent = '新建文章';
  $('deleteBtn').style.display = 'none';
  $('fAuthor').value = '';
  $('fTitle').value = '';
  $('fTags').value = '';
  $('fDate').value = new Date().toISOString().slice(0, 10);
  $('fBody').value = '';
  $('modal').style.display = 'flex';
}

function save() {
  if (!ENABLED) return;
  const payload = {
    author: $('fAuthor').value.trim() || '其他',
    title: $('fTitle').value.trim(),
    tags: $('fTags').value.split(',').map((s) => s.trim()).filter(Boolean),
    date: $('fDate').value.trim(),
    body: $('fBody').value,
  };
  const opt = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  const p = editingId ? api('/api/articles/' + enc(editingId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) : api('/api/articles', opt);
  p.then(() => { $('modal').style.display = 'none'; setMsg(editingId ? '已保存' : '已新建', 'ok'); refresh(); })
    .catch((e) => setMsg('保存失败：' + e.message, 'err'));
}

function doDelete(id) {
  if (!confirm('确定删除该文章？（将移入 .trash 回收站，可恢复）')) return;
  api('/api/articles/' + enc(id), { method: 'DELETE' })
    .then(() => { $('modal').style.display = 'none'; setMsg('已删除（可在 .trash 恢复）', 'ok'); refresh(); })
    .catch((e) => setMsg('删除失败：' + e.message, 'err'));
}

function rebuild() {
  if (!ENABLED) return;
  setMsg('重建中…');
  api('/api/rebuild', { method: 'POST' })
    .then((r) => setMsg(r.ok ? '重建完成' : '重建失败', r.ok ? 'ok' : 'err'))
    .catch((e) => setMsg('重建失败：' + e.message, 'err'));
}

function deploy() {
  if (!ENABLED) return;
  if (!confirm('提交并推送到 GitHub？需要已配置 token。')) return;
  setMsg('部署中…');
  api('/api/deploy', { method: 'POST' })
    .then((r) => setMsg(r.ok ? '已部署' : ('部署失败：' + (r.error || '')), r.ok ? 'ok' : 'err'))
    .catch((e) => setMsg('部署失败：' + e.message, 'err'));
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function enc(s) { return encodeURIComponent(s); }

// 事件
$('search').addEventListener('input', debounce(() => ENABLED ? refresh() : refreshStatic(), 200));
$('authorFilter').addEventListener('change', () => ENABLED ? refresh() : refreshStatic());
$('newBtn').addEventListener('click', openNew);
$('saveBtn').addEventListener('click', save);
$('deleteBtn').addEventListener('click', () => editingId && doDelete(editingId));
$('modalClose').addEventListener('click', () => { $('modal').style.display = 'none'; });
$('rebuildBtn').addEventListener('click', rebuild);
$('deployBtn').addEventListener('click', deploy);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').style.display = 'none'; });

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

load();
