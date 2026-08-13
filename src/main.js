/**
 * App entry point.
 *   1. Loads the manifest of available .xmind files.
 *   2. Renders the file list in the sidebar.
 *   3. Wires toolbar / keyboard to the MindMap controller.
 */

import './styles.css';
import { parseXMind, countNodes } from './parser.js';
import { MindMap } from './renderer.js';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fileListEl   = $('#file-list');
const docTitleEl   = $('#doc-title');
const docSubEl     = $('#doc-sub');
const canvasEl     = $('#canvas');
const canvasWrapEl = $('.canvas-wrap');
const emptyEl      = $('#empty-state');
const statusFileEl = $('#status-file');
const statusNodesEl= $('#status-nodes');
const zoomLabelEl  = $('#zoom-label');

const state = {
  manifest: null,
  current: null,
  cache: new Map(),  // url -> parsed tree
};

const map = new MindMap(canvasEl, canvasWrapEl);
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

function renderFileList(manifest) {
  fileListEl.innerHTML = '';
  const files = manifest.files || [];
  if (!files.length) {
    const empty = document.createElement('p');
    empty.style.cssText = 'padding:14px 12px;color:var(--text-dim);font-size:12.5px;line-height:1.55;';
    empty.innerHTML = `No files yet.<br>Add <code>.xmind</code> to <code>public/xmind/</code> and list them in <code>manifest.json</code>.`;
    fileListEl.appendChild(empty);
    return;
  }
  for (const f of files) {
    const btn = document.createElement('button');
    btn.className = 'file-item';
    btn.type = 'button';
    btn.dataset.id = f.id;
    btn.innerHTML = `
      <span class="file-item__title">${escapeHtml(f.title || f.id)}</span>
      <span class="file-item__meta">${escapeHtml(f.description || f.file || '')}</span>
    `;
    btn.addEventListener('click', () => openFile(f));
    fileListEl.appendChild(btn);
  }
}

function setActive(id) {
  for (const el of $$('.file-item', fileListEl)) {
    if (el.dataset.id === id) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  }
}

/* ------------------------ file loading ------------------------ */

async function openFile(entry) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = `${base}/xmind/${entry.file}`;
  state.current = entry;
  setActive(entry.id);
  docTitleEl.textContent = entry.title || entry.id;
  docSubEl.textContent = 'Loading…';
  statusFileEl.textContent = entry.file;

  // Mark sidebar item as loading
  const item = $(`.file-item[data-id="${entry.id}"]`);
  const meta = item?.querySelector('.file-item__meta');
  const origMeta = meta?.textContent;
  if (meta) { meta.classList.add('file-item__meta--loading'); meta.textContent = 'Loading…'; }

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
    if (meta) { meta.classList.remove('file-item__meta--loading'); meta.textContent = origMeta; }
  }
}

function onTreeLoaded(entry, parsed) {
  emptyEl.hidden = true;
  canvasEl.hidden = false;
  map.setTree(parsed.root);
  docSubEl.textContent = parsed.title && parsed.title !== parsed.root.title
    ? parsed.title
    : 'Tap a node to focus, drag to pan.';
  statusNodesEl.textContent = `${countNodes(parsed.root)} nodes`;
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
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); toggleFullscreen(); }
    if (k === 'c' || k === '0') { e.preventDefault(); map.fit(); }
    if (k === '+' || k === '=') { e.preventDefault(); map.zoomIn(); }
    if (k === '-' || k === '_') { e.preventDefault(); map.zoomOut(); }
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

/* ------------------------ boot ------------------------ */

async function boot() {
  bindToolbar();
  state.manifest = await loadManifest();
  renderFileList(state.manifest);

  // Auto-open ?file=<id> or first entry
  const params = new URLSearchParams(location.search);
  const wanted = params.get('file');
  const initial = (state.manifest.files || []).find((f) => f.id === wanted)
    || (state.manifest.files || [])[0];
  if (initial) openFile(initial);
}

boot();
