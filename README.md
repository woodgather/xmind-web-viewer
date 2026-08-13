# XMind Web Viewer

A small static site that turns a folder of `.xmind` files into a browsable
mind-map gallery. Drop a file in, list it in the manifest, push — GitHub
Pages serves it.

- **Vite** for the build, **GitHub Actions** for deploys.
- No framework. ~400 lines of vanilla JS + a single dependency (`jszip`).
- Dark, tool-like surface so the maps themselves are the focus.
- Pan, zoom, fullscreen, fit-to-view, keyboard shortcuts.

## Run locally

```bash
npm install
npm run dev
```

Vite will serve the app on http://localhost:5173.

## Build

```bash
npm run build
```

Output goes to `dist/`. The build is fully static — drop the folder on any
static host.

## Add a mind map

1. Drop a `.xmind` file into `public/xmind/`.
2. Add an entry to `public/xmind/manifest.json`:

   ```jsonc
   {
     "files": [
       { "id": "roadmap", "title": "Q4 Roadmap", "file": "roadmap.xmind" }
     ]
   }
   ```

That's the whole schema. Three fields per entry — `id` (used in the
URL: `?file=roadmap`), `title` (shown in the sidebar), and `file` (the
xmind filename). Display order is the order they appear in the array.

## Generate a sample from JSON

If you'd rather author a map as JSON and have it converted to a real
`.xmind` file:

```bash
node scripts/generate-xmind.mjs
```

Edit `scripts/generate-xmind.mjs` to change the source tree, or import
`buildXMind(tree, outPath)` from another script.

## Keyboard shortcuts

| Key           | Action                                  |
| ------------- | --------------------------------------- |
| `+` / `=`     | Zoom in                                 |
| `-`           | Zoom out                                |
| `0` / `c`     | Fit to view                             |
| `f`           | Toggle fullscreen                       |
| `Click`       | Collapse / expand a node's subtree      |
| `Hover`       | Highlight the path from root to node    |
| `Drag`        | Pan                                     |
| `Wheel`       | Zoom at cursor                          |
| `Pinch`       | Zoom (touch)                            |
| `[` / `]`     | Previous / next file                    |
| `j` / `k`     | Next / previous file                    |
| `1`–`9`       | Jump to file by position                |
| `/`           | Focus the file filter                   |

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: **GitHub Actions**.
3. Push to `main`. The included workflow at
   `.github/workflows/deploy.yml` builds with Vite and publishes `dist/`.

That's it.

## How it works

`src/parser.js` unzips the `.xmind` archive and reads either
`content.json` (modern XMind) or `content.xml` (legacy). Both shapes are
normalized into a simple `{ id, title, children: [...] }` tree.

`src/renderer.js` lays that tree out horizontally (root on the left) and
draws it as SVG. Zoom and pan are a CSS transform on the inner `<g>`,
which means the SVG viewBox stays full-canvas and panning is buttery.

`src/main.js` ties the manifest, parser, and renderer together and wires
up the toolbar and keyboard.

## License

MIT. update
