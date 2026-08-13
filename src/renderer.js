/**
 * SVG mind map renderer
 * ---------------------------------------------------------------
 *   - Horizontal layout (root on the left, branches to the right).
 *   - Reingold–Tilford-style subtree sizing so siblings never collide.
 *   - Pan via drag, zoom via wheel — applied as a CSS transform on
 *     the inner group so the SVG viewBox stays full-canvas.
 *   - "Fit" recomputes a transform that frames the whole map.
 *   - Branch colors cycle through the design-system palette.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const X_STEP = 60;   // horizontal spacing between depth levels
const Y_STEP = 14;   // base vertical gap between siblings
const PAD_X  = 28;   // outer horizontal padding around the map
const PAD_Y  = 24;   // outer vertical padding
const MIN_NODE_W = 56;
const MAX_TEXT_W = 220;

const BRANCH_COLORS = [
  'var(--branch-0)',
  'var(--branch-1)',
  'var(--branch-2)',
  'var(--branch-3)',
  'var(--branch-4)',
  'var(--branch-5)',
];

/* ----------------------------- layout ----------------------------- */

/**
 * Measure a node's intrinsic size from its title.
 * We do a quick text measurement using a hidden canvas — works without
 * needing the SVG to be mounted yet.
 */
let _measureCtx = null;
function measureText(text, weight = 500) {
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = '500 13px "Inter", "Inter Tight", system-ui, sans-serif';
  } else {
    _measureCtx.font = `${weight} 13px "Inter", "Inter Tight", system-ui, sans-serif`;
  }
  const m = _measureCtx.measureText(text || ' ');
  // text width capped, with some horizontal padding for the rect
  const tw = Math.min(MAX_TEXT_W, Math.max(MIN_NODE_W, m.width + 4));
  return { w: Math.round(tw), h: 28 };
}

/**
 * Compute the vertical "extent" of a subtree (used to space siblings).
 * Leaves take 1 unit; internal nodes take the sum of children's extents.
 * Returns the units and stores node sizes/positions in-place.
 */
function layoutSubtree(node, depth) {
  const size = measureText(node.title, depth === 0 ? 600 : 500);
  node._w = size.w;
  node._h = size.h;
  node._depth = depth;
  const kids = node.children || [];
  if (!kids.length) {
    node._subtreeUnits = 1;
    return;
  }
  let units = 0;
  for (const k of kids) {
    layoutSubtree(k, depth + 1);
    units += k._subtreeUnits;
  }
  node._subtreeUnits = units;
}

/**
 * Assign x/y to each node. The root is vertically centered.
 * Children are stacked top-to-bottom, with their parent's anchor at
 * the centroid of its children.
 */
function assignPositions(node, topY) {
  const kids = node.children || [];
  if (!kids.length) {
    node._y = topY + node._h / 2;
    node._x = 0;
    return;
  }
  // Compute total height of the children block
  let totalH = 0;
  for (const k of kids) totalH += (k._h + Y_STEP);
  totalH -= Y_STEP;

  let cursor = topY;
  for (const k of kids) {
    const kTop = cursor;
    assignPositions(k, kTop);
    cursor += k._h + Y_STEP;
  }
  // Center of children block
  const first = kids[0];
  const last = kids[kids.length - 1];
  const cy = (first._y - first._h / 2 + last._y + last._h / 2) / 2;
  node._y = cy;
  node._x = 0;

  // X is depth-based, applied after this pass
}

/* ----------------------------- render ----------------------------- */

function el(name, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function branchColor(depth) {
  return BRANCH_COLORS[depth % BRANCH_COLORS.length];
}

function renderTree(root) {
  const g = el('g', { class: 'mm-root' });

  // Pass 1: subtree sizes
  layoutSubtree(root, 0);
  // Pass 2: y positions starting from top
  let totalH = 0;
  for (const k of root.children) totalH += (k._h + Y_STEP);
  totalH = Math.max(1, totalH - Y_STEP);
  assignPositions(root, 0);

  // Pass 3: x positions (left to right)
  function placeX(n) {
    n._x = n._depth * X_STEP;
    for (const c of (n.children || [])) placeX(c);
  }
  placeX(root);

  // Compute extents to center the whole map
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (function walk(n) {
    minX = Math.min(minX, n._x);
    minY = Math.min(minY, n._y - n._h / 2);
    maxX = Math.max(maxX, n._x + n._w);
    maxY = Math.max(maxY, n._y + n._h / 2);
    for (const c of (n.children || [])) walk(c);
  })(root);
  const offsetX = -minX + PAD_X;
  const offsetY = -minY + PAD_Y;
  (function shift(n) {
    n._x += offsetX;
    n._y += offsetY;
    for (const c of (n.children || [])) shift(c);
  })(root);

  const totalW = (maxX - minX) + PAD_X * 2;
  const totalH2 = (maxY - minY) + PAD_Y * 2;

  // Render edges first (so nodes draw on top)
  function drawEdges(n) {
    for (const c of (n.children || [])) {
      const x1 = n._x + n._w;
      const y1 = n._y;
      const x2 = c._x;
      const y2 = c._y;
      const mx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      g.appendChild(el('path', {
        class: 'mm-edge',
        d,
        stroke: branchColor(c._depth),
        'stroke-opacity': '0.55',
      }));
      drawEdges(c);
    }
  }
  drawEdges(root);

  // Render nodes
  function drawNodes(n) {
    const ng = el('g', {
      class: 'mm-node',
      'data-depth': n._depth,
      transform: `translate(${n._x}, ${n._y - n._h / 2})`,
    });
    if (n._depth > 0) {
      ng.appendChild(el('rect', {
        class: 'mm-node-bg',
        width: n._w,
        height: n._h,
        fill: 'var(--surface-2)',
        stroke: branchColor(n._depth),
        'stroke-opacity': '0.5',
        'stroke-width': '1',
      }));
    } else {
      // root — golden pill, no border
      ng.appendChild(el('rect', {
        class: 'mm-node-bg',
        width: n._w,
        height: n._h,
      }));
    }
    const text = el('text', {
      class: 'mm-node-text',
      x: n._w / 2,
      y: n._h / 2 + 4,
      'text-anchor': 'middle',
    });
    text.textContent = n.title || '(untitled)';
    ng.appendChild(text);
    g.appendChild(ng);
    for (const c of (n.children || [])) drawNodes(c);
  }
  drawNodes(root);

  return { group: g, width: totalW, height: totalH2 };
}

/* ----------------------------- controller ----------------------------- */

export class MindMap {
  /**
   * @param {SVGSVGElement} svg  the canvas
   * @param {HTMLElement}   wrap  container used to read client size
   */
  constructor(svg, wrap) {
    this.svg = svg;
    this.wrap = wrap;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.tree = null;
    this.world = null;
    this._bind();
  }

  _bind() {
    this.svg.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this.svg.addEventListener('mousedown', this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup', this._onMouseUp.bind(this));
    window.addEventListener('resize', () => this._fit());
    // touch
    this.svg.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this.svg.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this.svg.addEventListener('touchend', this._onTouchEnd.bind(this));
  }

  setTree(root) {
    this.tree = root;
    if (!root) {
      this.svg.innerHTML = '';
      this.world = null;
      return;
    }
    const { group, width, height } = renderTree(root);
    this.svg.innerHTML = '';
    this.svg.appendChild(group);
    this.world = { width, height };
    this._fit();
  }

  /** Compute the transform that frames the whole map in the viewport. */
  _fit() {
    if (!this.world) return;
    const rect = this.wrap.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (!W || !H) return;
    const margin = 32;
    const sx = (W - margin * 2) / this.world.width;
    const sy = (H - margin * 2) / this.world.height;
    const s = Math.min(1, Math.max(0.2, Math.min(sx, sy)));
    this.scale = s;
    this.tx = (W - this.world.width * s) / 2;
    this.ty = (H - this.world.height * s) / 2;
    this._apply();
  }

  _apply() {
    const g = this.svg.querySelector('.mm-root');
    if (!g) return;
    g.setAttribute('transform', `translate(${this.tx}, ${this.ty}) scale(${this.scale})`);
    this._emitZoom();
  }

  _emitZoom() {
    this.svg.dispatchEvent(new CustomEvent('zoom', { detail: { scale: this.scale } }));
  }

  /* ----- public actions ----- */

  zoomIn()  { this._zoomAt(this.wrap.clientWidth / 2, this.wrap.clientHeight / 2,  1.2); }
  zoomOut() { this._zoomAt(this.wrap.clientWidth / 2, this.wrap.clientHeight / 2,  1 / 1.2); }
  fit()     { this._fit(); }

  _zoomAt(cx, cy, factor) {
    const newScale = Math.min(3, Math.max(0.15, this.scale * factor));
    if (newScale === this.scale) return;
    // Keep the world point under (cx,cy) stationary
    const k = newScale / this.scale;
    this.tx = cx - k * (cx - this.tx);
    this.ty = cy - k * (cy - this.ty);
    this.scale = newScale;
    this._apply();
  }

  /* ----- input handlers ----- */

  _onWheel(e) {
    if (!this.world) return;
    e.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this._zoomAt(cx, cy, factor);
  }

  _onMouseDown(e) {
    if (!this.world) return;
    this._dragging = true;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    this.svg.classList.add('is-panning');
  }
  _onMouseMove(e) {
    if (!this._dragging) return;
    this.tx += e.clientX - this._lastX;
    this.ty += e.clientY - this._lastY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    this._apply();
  }
  _onMouseUp() {
    this._dragging = false;
    this.svg.classList.remove('is-panning');
  }

  /* touch — single-finger pan, two-finger pinch zoom */
  _onTouchStart(e) {
    if (!this.world || !e.touches.length) return;
    if (e.touches.length === 1) {
      this._dragging = true;
      this._lastX = e.touches[0].clientX;
      this._lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const [a, b] = e.touches;
      this._pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this._pinchScale = this.scale;
    }
  }
  _onTouchMove(e) {
    if (!this.world) return;
    e.preventDefault();
    if (e.touches.length === 1 && this._dragging) {
      const t = e.touches[0];
      this.tx += t.clientX - this._lastX;
      this.ty += t.clientY - this._lastY;
      this._lastX = t.clientX;
      this._lastY = t.clientY;
      this._apply();
    } else if (e.touches.length === 2 && this._pinchDist) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const f = d / this._pinchDist;
      const newScale = Math.min(3, Math.max(0.15, this._pinchScale * f));
      const k = newScale / this.scale;
      const rect = this.svg.getBoundingClientRect();
      const cx = (a.clientX + b.clientX) / 2 - rect.left;
      const cy = (a.clientY + b.clientY) / 2 - rect.top;
      this.tx = cx - k * (cx - this.tx);
      this.ty = cy - k * (cy - this.ty);
      this.scale = newScale;
      this._apply();
    }
  }
  _onTouchEnd() {
    this._dragging = false;
    this._pinchDist = 0;
  }
}
