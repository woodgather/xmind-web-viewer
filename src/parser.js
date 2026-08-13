/**
 * XMind parser
 * ---------------------------------------------------------------
 *  - .xmind is a ZIP archive.
 *  - Modern XMind (>= 8) uses `content.json` (or `contents.json`).
 *  - Older XMind uses `content.xml`.
 *  - This module returns a normalized tree:
 *
 *      {
 *        title: string,           // sheet title
 *        root: { id, title, children: [...] }
 *      }
 *
 *  Multiple sheets are merged under a virtual root so the user
 *  sees one continuous map.
 */

import JSZip from 'jszip';

const NS = 'http://www.xmind.net/contents/2007/xmap-content';

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/* ---------------------- JSON format ---------------------- */

function normalizeJsonNode(node) {
  if (!isObject(node)) return null;
  // XMind JSON uses "title" strings or { text: "..." } shapes
  let title = node.title;
  if (isObject(title)) title = title.text ?? '';
  if (typeof title !== 'string') title = String(title ?? '');

  const out = { id: node.id ?? cryptoId(), title: title.trim() };
  const children = [];

  // Two known shapes:
  //   { children: { attached: [...] } }
  //   { topics: [{ title, children, ... }, ...] }  (older JSON)
  if (isObject(node.children)) {
    for (const list of [node.children.attached, node.children.detached]) {
      if (Array.isArray(list)) for (const c of list) {
        const n = normalizeJsonNode(c);
        if (n) children.push(n);
      }
    }
  }
  if (Array.isArray(node.topics)) {
    for (const c of node.topics) {
      const n = normalizeJsonNode(c);
      if (n) children.push(n);
    }
  }
  out.children = children;
  return out;
}

function parseJsonSheet(sheet) {
  const title = (sheet.title && (sheet.title.text ?? sheet.title)) || 'Sheet';
  const root = normalizeJsonNode(sheet.rootTopic || sheet.topic);
  return { title: String(title).trim(), root };
}

function parseJson(content) {
  const data = JSON.parse(content);
  const sheets = Array.isArray(data) ? data
    : Array.isArray(data.sheets) ? data.sheets
    : Array.isArray(data[0]?.sheets) ? data[0].sheets
    : null;
  if (!sheets || !sheets.length) {
    throw new Error('No sheets found in content.json');
  }
  return sheets.map(parseJsonSheet);
}

/* ---------------------- XML format (legacy) ---------------------- */

function xmlText(el) {
  return (el.textContent || '').trim();
}

function parseXmlChildren(container) {
  if (!container) return [];
  const groups = container.getElementsByTagNameNS(NS, 'topics');
  const result = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const type = g.getAttribute('type') || 'attached';
    if (type !== 'attached' && type !== 'detached') continue;
    const topics = g.getElementsByTagNameNS(NS, 'topic');
    for (let j = 0; j < topics.length; j++) {
      const t = topics[j];
      const titleEl = t.getElementsByTagNameNS(NS, 'title')[0];
      result.push({
        id: t.getAttribute('id') || cryptoId(),
        title: titleEl ? xmlText(titleEl) : '',
        childrenContainer: t.getElementsByTagNameNS(NS, 'children')[0] || null,
      });
    }
  }
  return result;
}

function buildXmlTree(topicEl) {
  const titleEl = topicEl.getElementsByTagNameNS(NS, 'title')[0];
  const node = {
    id: topicEl.getAttribute('id') || cryptoId(),
    title: titleEl ? xmlText(titleEl) : '',
    children: [],
  };
  const childrenContainer = topicEl.getElementsByTagNameNS(NS, 'children')[0] || null;
  for (const child of parseXmlChildren(childrenContainer)) {
    // For XML we only have a reference to the <topic> element wrapped in
    // a meta-object. Find it back by id is fragile; instead, look it up
    // directly via querySelector on the parent.
    const topicEls = childrenContainer.getElementsByTagNameNS(NS, 'topic');
    let found = null;
    for (let i = 0; i < topicEls.length; i++) {
      if (topicEls[i].getAttribute('id') === child.id) { found = topicEls[i]; break; }
    }
    if (found) node.children.push(buildXmlTree(found));
  }
  return node;
}

function parseXml(content) {
  const doc = new DOMParser().parseFromString(content, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Invalid content.xml');
  const sheets = doc.getElementsByTagNameNS(NS, 'sheet');
  const out = [];
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const titleEl = sheet.getElementsByTagNameNS(NS, 'title')[0];
    const topic = sheet.getElementsByTagNameNS(NS, 'topic')[0];
    if (!topic) continue;
    out.push({
      title: titleEl ? xmlText(titleEl) : 'Sheet',
      root: buildXmlTree(topic),
    });
  }
  if (!out.length) throw new Error('No sheets found in content.xml');
  return out;
}

/* ---------------------- merge multiple sheets ---------------------- */

function mergeSheets(sheets) {
  if (sheets.length === 1) return sheets[0];
  return {
    title: sheets.map(s => s.title).join(' / '),
    root: {
      id: cryptoId(),
      title: sheets[0].root.title || 'Multi-sheet Map',
      children: sheets.map(s => s.root),
    },
  };
}

/* ---------------------- public API ---------------------- */

let _idCounter = 0;
function cryptoId() { return `n-${++_idCounter}-${Math.random().toString(36).slice(2, 7)}`; }

export async function parseXMind(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Prefer the modern JSON layout
  const jsonEntry = zip.file('content.json') || zip.file('contents.json') || zip.file('Content.json');
  if (jsonEntry) {
    const text = await jsonEntry.async('string');
    return mergeSheets(parseJson(text));
  }
  const xmlEntry = zip.file('content.xml') || zip.file('Content.xml');
  if (xmlEntry) {
    const text = await xmlEntry.async('string');
    return mergeSheets(parseXml(text));
  }
  throw new Error('No content.json or content.xml found in this .xmind file.');
}

/** Walk a normalized tree and count nodes (incl. root). */
export function countNodes(root) {
  if (!root) return 0;
  let n = 1;
  for (const c of (root.children || [])) n += countNodes(c);
  return n;
}
