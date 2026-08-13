#!/usr/bin/env node
/**
 * Build a .xmind file (a ZIP with the XMind internal layout) from a
 * plain JS object tree, so you can author maps as code and ship them
 * alongside the viewer.
 *
 *   { title: "Root", children: [
 *       { title: "Branch", children: [...] },
 *   ]}
 *
 * Usage:
 *   node scripts/generate-xmind.mjs                       # builds public/xmind/welcome.xmind
 *   node scripts/generate-xmind.mjs out/my.xmind "Title"  # one-off
 */

import JSZip from 'jszip';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const TREE = {
  title: 'Welcome to XMind Viewer',
  children: [
    {
      title: 'What is this',
      children: [
        { title: 'A static site that displays .xmind files in the browser' },
        { title: 'Built with Vite, deployed to GitHub Pages' },
        { title: 'No backend, no database — just files' },
      ],
    },
    {
      title: 'How to use',
      children: [
        { title: 'Pick a file from the sidebar' },
        { title: 'Drag to pan, scroll to zoom' },
        { title: 'Press F for fullscreen, C to re-center' },
        { title: 'Use + / − to zoom in and out' },
      ],
    },
    {
      title: 'Add your own maps',
      children: [
        { title: 'Drop a .xmind file in public/xmind/' },
        { title: 'Register it in public/xmind/manifest.json' },
        { title: 'Push to main, the action rebuilds and deploys' },
      ],
    },
    {
      title: 'Keyboard shortcuts',
      children: [
        { title: '+  Zoom in' },
        { title: '−  Zoom out' },
        { title: 'C  Fit to view' },
        { title: 'F  Fullscreen' },
      ],
    },
  ],
};

let _id = 0;
const newId = () => `gen-${(++_id).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function toJsonNode(node) {
  return {
    id: newId(),
    'class': 'topic',
    title: node.title ?? '',
    children: {
      attached: (node.children || []).map(toJsonNode),
    },
  };
}

export async function buildXMind(tree, outPath) {
  const zip = new JSZip();

  const sheetId = newId();
  const sheet = {
    id: sheetId,
    'class': 'sheet',
    title: 'Central Topic',
    rootTopic: toJsonNode(tree),
  };
  const contentJson = JSON.stringify([sheet], null, 2);
  zip.file('content.json', contentJson);

  const metadata = {
    creator: { name: 'xmind-web-viewer', version: '1.0.0' },
    'createdBy': 'xmind-web-viewer generate script',
    'createTime': new Date().toISOString(),
  };
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  return { outPath, size: buf.length };
}

/* --------------------- CLI --------------------- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || 'public/xmind/welcome.xmind';
  const source = process.argv[3] ? JSON.parse(process.argv[3]) : TREE;
  buildXMind(source, out).then((r) => {
    console.log(`Wrote ${r.outPath} (${r.size} bytes)`);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
