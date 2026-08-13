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
        { title: 'Click any node to collapse its branch' },
        { title: 'Hover to highlight the path from the root' },
        { title: 'Press F for fullscreen, C to re-center' },
        { title: 'Use [ and ] to switch files' },
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
        { title: '[ / ]  Prev / next file' },
        { title: '/  Search files' },
      ],
    },
  ],
};

const PRODUCT_ROADMAP = {
  title: 'Product Roadmap — Q3 → Q4 2026',
  children: [
    {
      title: 'Q3 — Foundation',
      children: [
        {
          title: 'Auth & Identity',
          children: [
            { title: 'SSO via SAML + OIDC' },
            { title: 'SCIM provisioning' },
            { title: 'Audit log export' },
          ],
        },
        {
          title: 'Data Platform',
          children: [
            { title: 'Warehouse migration to Iceberg' },
            { title: 'New event schema (v3)' },
            { title: 'Backfill tooling' },
          ],
        },
        {
          title: 'Mobile',
          children: [
            { title: 'iOS 17 widget support' },
            { title: 'Android tablet layouts' },
          ],
        },
      ],
    },
    {
      title: 'Q4 — Growth',
      children: [
        {
          title: 'Self-serve onboarding',
          children: [
            { title: 'Template gallery' },
            { title: 'Interactive product tour' },
            { title: 'Sample workspaces' },
          ],
        },
        {
          title: 'Collaboration',
          children: [
            { title: 'Inline comments on maps' },
            { title: '@mentions in titles' },
            { title: 'Slack & Teams bridges' },
          ],
        },
        {
          title: 'AI assist',
          children: [
            { title: 'Auto-cluster brainstorm nodes' },
            { title: 'Summarize long branches' },
            { title: 'Suggest missing categories' },
          ],
        },
      ],
    },
    {
      title: 'Cross-cutting',
      children: [
        {
          title: 'Reliability',
          children: [
            { title: 'p95 < 200ms for map load' },
            { title: '99.95% SLO across regions' },
          ],
        },
        {
          title: 'Design system',
          children: [
            { title: 'Token pipeline to Figma' },
            { title: 'Storybook coverage 90%' },
          ],
        },
      ],
    },
  ],
};

const DESIGN_SYSTEM = {
  title: 'Design System Atlas',
  children: [
    {
      title: 'Foundations',
      children: [
        {
          title: 'Color',
          children: [
            { title: 'Neutral scale (12 steps)' },
            { title: 'Brand — Honey #E8B257' },
            { title: 'Semantic — success, warn, danger' },
            { title: 'Dark mode parity check' },
          ],
        },
        {
          title: 'Typography',
          children: [
            { title: 'Inter Tight — display' },
            { title: 'Inter — UI' },
            { title: 'JetBrains Mono — code' },
            { title: 'Type scale 1.2 ratio' },
          ],
        },
        {
          title: 'Spacing & radius',
          children: [
            { title: '4-pt grid' },
            { title: 'Radius scale — 6, 10, 14' },
            { title: 'Container widths' },
          ],
        },
      ],
    },
    {
      title: 'Components',
      children: [
        {
          title: 'Inputs',
          children: [
            { title: 'Button — primary, ghost, icon' },
            { title: 'Text field — single, multi, search' },
            { title: 'Select — native, combobox' },
            { title: 'Switch, checkbox, radio' },
          ],
        },
        {
          title: 'Surfaces',
          children: [
            { title: 'Card' },
            { title: 'Sheet / drawer' },
            { title: 'Dialog / modal' },
            { title: 'Toast' },
          ],
        },
        {
          title: 'Navigation',
          children: [
            { title: 'Sidebar' },
            { title: 'Tabs' },
            { title: 'Breadcrumb' },
            { title: 'Command palette' },
          ],
        },
      ],
    },
    {
      title: 'Patterns',
      children: [
        { title: 'Empty states' },
        { title: 'Error & loading states' },
        { title: 'Destructive confirmations' },
        { title: 'Keyboard a11y' },
        { title: 'Reduced motion handling' },
      ],
    },
  ],
};

const SAMPLES = {
  welcome: TREE,
  'product-roadmap': PRODUCT_ROADMAP,
  'design-system': DESIGN_SYSTEM,
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
  const arg = process.argv[2];
  // Single-shot mode:   node generate-xmind.mjs out/my.xmind '{"title":"X"}'
  if (arg && arg.endsWith('.xmind') && process.argv[3]) {
    const out = arg;
    const source = JSON.parse(process.argv[3]);
    buildXMind(source, out).then((r) => {
      console.log(`Wrote ${r.outPath} (${r.size} bytes)`);
    }).catch((e) => { console.error(e); process.exit(1); });
  } else {
    // Batch mode: regenerate every sample in the SAMPLES map.
    (async () => {
      for (const [id, tree] of Object.entries(SAMPLES)) {
        const out = `public/xmind/${id}.xmind`;
        const r = await buildXMind(tree, out);
        console.log(`Wrote ${r.outPath} (${r.size} bytes)`);
      }
    })().catch((e) => { console.error(e); process.exit(1); });
  }
}
