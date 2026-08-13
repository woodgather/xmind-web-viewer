/**
 * App entry point.
 *   1. Loads the manifest of available .xmind files.
 *   2. Renders the file list in the sidebar (with search + counts).
 *   3. Wires toolbar / keyboard to the MindMap controller.
 *   4. Remembers the last-opened file in localStorage.
 */

import './styles.css';
import { parseXMind, countNodes } from './parser.js';
import { MindMap } from './renderer.js';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fileListEl    = $('#file-list');
const docTitleEl    = $('#doc-title');
const docSubEl      = $('#doc-sub');
const canvasEl      = $('#canvas');
const canvasWrapEl  = $('.canvas-wrap');
const emptyEl       = $('#empty-state');
const statusFileEl  = $('#status-file');
const statusNodesEl = $('#status-nodes');
const zoomLabelEl   = $('#zoom-label');
const searchEl      = $('#search');
const searchInputEl = $('#search-input');
const searchClearEl = $('#search-clear');

const STORAGE_KEY = 'xmind-viewer:last-opened';
const FILTER_KEY  = 'xmind-viewer:filter';

const state = {
  manifest: null,
  filtered: null,        // filtered view of manifest.files
  current: null,
  currentIndex: -1,
  cache: new Map(),      // url -> parsed tree
  nodeCounts: new Map(), // id  -> node count
};

const map = new MindMap(canvasEl, canvasWrapEl, {
  onToggle: ({ collapsed }) => {
    if (state.current) {
      state.nodeCounts.set(state.current.id, countNodes(visibleRoot()));
      updateCountBadge(state.current.id);
    }
    // re-emit visible node count
    statusNodesEl.textContent = `${countNodes(visibleRoot())} nodes`;
  },
});
canvasEl.addEventListener('zoom', (e) => {
  zoomLabelEl.textContent = `${Math.round(e.detail.scale * 100)}%`;
});

/* ------------------------ manifest & list ------------------------ */

async function loadManifest() {
  const url = `${import.meta.env.BASE_URL}xmind/manifest.json`;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('No manifest found, falling back to discovery.', err);
    return { files: [] };
  }
}

function visibleRoot() {
  if (!map.tree) return null;
  // The controller always renders the full tree but collapsed subtrees
  // occupy a single unit. So `countNodes` over the rendered root still
  // counts collapsed descendants — we want to count only visible nodes.
  return countVisibleNodes(map.tree);
}

function countVisibleNodes(n) {
  if (!n) return 0;
  let total = 1;
  if (n._collapsed) return total;
  for (const c of (n.children || [])) total += countVisibleNodes(c);
  return total;
}

function renderFileList(manifest) {
  const files = manifest.files || [];
  state.manifest = manifest;
  state.filtered = files.slice();

  if (files.length >= 3) searchEl.hidden = false;

  if (!files.length) {
    fileListEl.innerHTML = `
      <div class="file-list__empty">
        No files listed.<br>
        Add an entry to <code>public/xmind/manifest.json</code>.
      </div>`;
    return;
  }

  fileListEl.innerHTML = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const btn = document.createElement('button');
    btn.className = 'file-item';
    btn.type = 'button';
    btn.dataset.id = f.id;
    btn.dataset.index = String(i);

    btn.innerHTML = `
      <span class="file-item__title">${escapeHtml(f.title || f.id)}</span>
      <span class="file-item__count" data-count hidden></span>
    `;
    btn.addEventListener('click', () => openFile(f));
    fileListEl.appendChild(btn);
  }
  applyFilter(currentFilter());
}

function setActive(id) {
  for (const el of $$('.file-item', fileListEl)) {
    if (el.dataset.id === id) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  }
}

function updateCountBadge(id) {
  const item = $(`.file-item[data-id="${cssEscape(id)}"]`);
  if (!item) return;
  const badge = item.querySelector('.file-item__count');
  if (!badge) return;
  const n = state.nodeCounts.get(id);
  if (typeof n === 'number') {
    badge.textContent = `${n}`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/* ------------------------ search/filter ------------------------ */

function currentFilter() {
  return (searchInputEl.value || '').trim().toLowerCase();
}

function applyFilter(q) {
  q = (q || '').trim().toLowerCase();
  const files = state.manifest?.files || [];
  let visibleCount = 0;
  for (const item of $$('.file-item', fileListEl)) {
    const f = files.find((x) => x.id === item.dataset.id);
    if (!f) continue;
    const hay = `${f.title} ${f.id} ${f.file || ''}`.toLowerCase();
    const match = !q || hay.includes(q);
    item.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  }
  searchEl.classList.toggle('has-value', !!q);

  const old = fileListEl.querySelector('.file-list__empty--filter');
  if (old) old.remove();
  if (q && visibleCount === 0) {
    const div = document.createElement('div');
    div.className = 'file-list__empty file-list__empty--filter';
    div.textContent = `No matches for “${q}”.`;
    fileListEl.appendChild(div);
  }
  try { localStorage.setItem(FILTER_KEY, q); } catch {}
}

function bindSearch() {
  let timer = 0;
  searchInputEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => applyFilter(searchInputEl.value), 60);
  });
  searchClearEl.addEventListener('click', () => {
    searchInputEl.value = '';
    applyFilter('');
    searchInputEl.focus();
  });
  // restore
  try {
    const last = localStorage.getItem(FILTER_KEY) || '';
    if (last) { searchInputEl.value = last; applyFilter(last); }
  } catch {}
}

/* ------------------------ file loading ------------------------ */

async function openFile(entry) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = `${base}/xmind/${entry.file}`;
  state.current = entry;
  state.currentIndex = (state.manifest?.files || []).findIndex((f) => f.id === entry.id);
  setActive(entry.id);
  try { localStorage.setItem(STORAGE_KEY, entry.id); } catch {}
  docTitleEl.textContent = entry.title || entry.id;
  docSubEl.textContent = 'Loading…';
  statusFileEl.textContent = entry.file;

  const item = $(`.file-item[data-id="${cssEscape(entry.id)}"]`);
  const titleEl = item?.querySelector('.file-item__title');
  const origTitle = titleEl?.textContent;
  if (titleEl) { titleEl.classList.add('file-item__title--loading'); titleEl.textContent = 'Loading…'; }

  try {
    let tree = state.cache.get(url);
    if (!tree) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      tree = await parseXMind(buf);
      state.cache.set(url, tree);
    }
    onTreeLoaded(entry, tree);
  } catch (err) {
    console.error(err);
    docSubEl.textContent = `Couldn't load: ${err.message}`;
    emptyEl.hidden = false;
    canvasEl.hidden = true;
  } finally {
    if (titleEl) {
      titleEl.classList.remove('file-item__title--loading');
      titleEl.textContent = origTitle;
    }
  }
}

function onTreeLoaded(entry, parsed) {
  emptyEl.hidden = true;
  canvasEl.hidden = false;
  map.setTree(parsed.root);
  docSubEl.textContent = parsed.title && parsed.title !== parsed.root.title
    ? parsed.title
    : 'Click a node to collapse its branch. Hover to highlight the path.';
  const total = countNodes(parsed.root);
  state.nodeCounts.set(entry.id, total);
  updateCountBadge(entry.id);
  statusNodesEl.textContent = `${countNodes(parsed.root)} nodes`;
}

/* ------------------------ file navigation ------------------------ */

function openByOffset(delta) {
  const files = state.manifest?.files || [];
  if (!files.length) return;
  let idx = state.currentIndex + delta;
  // wrap around
  if (idx < 0) idx = files.length - 1;
  if (idx >= files.length) idx = 0;
  // skip hidden (filtered out) items
  const visibleIndices = files
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => {
      const item = $(`.file-item[data-id="${cssEscape(f.id)}"]`);
      return item && item.style.display !== 'none';
    })
    .map(({ i }) => i);
  if (!visibleIndices.length) return;
  // find the next visible index >= idx (or wrap)
  let target = visibleIndices.find((i) => i >= idx);
  if (target == null) target = visibleIndices[0];
  openFile(files[target]);
}

function openByIndex(i) {
  const files = state.manifest?.files || [];
  if (i < 0 || i >= files.length) return;
  openFile(files[i]);
}

/* ------------------------ toolbar & shortcuts ------------------------ */

function bindToolbar() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'zoom-in')  map.zoomIn();
    if (a === 'zoom-out') map.zoomOut();
    if (a === 'center')   map.fit();
    if (a === 'fullscreen') toggleFullscreen();
    if (a === 'expand-all')  map.expandAll();
    if (a === 'collapse-1')  map.collapseToDepth(1);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'f') { e.preventDefault(); toggleFullscreen(); }
    if (k === '0' || k === 'c' || k === 'C') { e.preventDefault(); map.fit(); }
    if (k === '+' || k === '=') { e.preventDefault(); map.zoomIn(); }
    if (k === '-' || k === '_') { e.preventDefault(); map.zoomOut(); }
    // file navigation
    if (k === '[') { e.preventDefault(); openByOffset(-1); }
    if (k === ']') { e.preventDefault(); openByOffset(+1); }
    if (k === 'j' || k === 'J') { e.preventDefault(); openByOffset(+1); }
    if (k === 'k' || k === 'K') { e.preventDefault(); openByOffset(-1); }
    // jump by number
    if (/^[1-9]$/.test(k)) { e.preventDefault(); openByIndex(Number(k) - 1); }
    // / focuses search
    if (k === '/') { e.preventDefault(); searchInputEl.focus(); searchInputEl.select(); }
  });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
}

/* ------------------------ helpers ------------------------ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function cssEscape(s) {
  return String(s).replace(/(["\\.#:>+~*\[\]()'])/g, '\\$1');
}

/* ------------------------ boot ------------------------ */

async function boot() {
  bindToolbar();
  bindSearch();
  state.manifest = await loadManifest();
  renderFileList(state.manifest);

  const params = new URLSearchParams(location.search);
  const wanted = params.get('file') || safeStorageGet(STORAGE_KEY);
  const initial = (state.manifest.files || []).find((f) => f.id === wanted)
    || (state.manifest.files || [])[0];
  if (initial) openFile(initial);
}

function safeStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}

boot();
