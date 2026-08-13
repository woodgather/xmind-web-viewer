/**
 * SVG mind map renderer
 * ---------------------------------------------------------------
 *   - Horizontal layout (root on the left, branches to the right).
 *   - Reingold–Tilford-style subtree sizing so siblings never collide.
 *   - Pan via drag, zoom via wheel — applied as a CSS transform on
 *     the inner group so the SVG viewBox stays full-canvas.
 *   - "Fit" recomputes a transform that frames the whole map.
 *   - Click a node (except the root) to collapse / expand its subtree.
 *   - Hover a node to highlight the path from the root.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const X_STEP = 64;   // horizontal spacing between depth levels
const Y_STEP = 12;   // base vertical gap between siblings
const PAD_X  = 32;   // outer horizontal padding around the map
const PAD_Y  = 24;   // outer vertical padding
const MIN_NODE_W = 56;
const MAX_TEXT_W = 240;

const BRANCH_COLORS = [
  'var(--branch-0)',
  'var(--branch-1)',
  'var(--branch-2)',
  'var(--branch-3)',
  'var(--branch-4)',
  'var(--branch-5)',
];

/* ----------------------------- layout ----------------------------- */

let _measureCtx = null;
function measureText(text, weight = 500) {
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = '500 13px "Inter", "Inter Tight", system-ui, sans-serif';
  } else {
    _measureCtx.font = `${weight} 13px "Inter", "Inter Tight", system-ui, sans-serif`;
  }
  const m = _measureCtx.measureText(text || ' ');
  const tw = Math.min(MAX_TEXT_W, Math.max(MIN_NODE_W, m.width + 4));
  return { w: Math.round(tw), h: 28 };
}

/**
 * Compute vertical extent of a subtree. Collapsed nodes count as 1.
 * Also sets each node's `_parent` reference.
 */
function layoutSubtree(node, depth, parent) {
  node._depth = depth;
  node._parent = parent;
  const size = measureText(node.title, depth === 0 ? 600 : 500);
  node._w = size.w;
  node._h = size.h;
  const kids = (node.children || []).filter((k) => !k._hidden);
  node._visibleChildren = kids;
  if (node._collapsed || !kids.length) {
    node._subtreeUnits = 1;
    return;
  }
  let units = 0;
  for (const k of kids) {
    layoutSubtree(k, depth + 1, node);
    units += k._subtreeUnits;
  }
  node._subtreeUnits = units;
}

function assignPositions(node, topY) {
  const kids = node._visibleChildren;
  if (!kids.length) {
    node._y = topY + node._h / 2;
    node._x = 0;
    return;
  }
  let cursor = topY;
  for (const k of kids) {
    assignPositions(k, cursor);
    cursor += k._h + Y_STEP;
  }
  const first = kids[0];
  const last = kids[kids.length - 1];
  const cy = (first._y - first._h / 2 + last._y + last._h / 2) / 2;
  node._y = cy;
  node._x = 0;
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

/* ----------------------------- controller ----------------------------- */

export class MindMap {
  /**
   * @param {SVGSVGElement} svg  the canvas
   * @param {HTMLElement}   wrap  container used to read client size
   * @param {{ onToggle?: (info: {depth:number, collapsed:boolean}) => void }} [opts]
   */
  constructor(svg, wrap, opts = {}) {
    this.svg = svg;
    this.wrap = wrap;
    this.opts = opts;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.tree = null;
    this.world = null;
    this._allNodes = [];
    this._allEdges = [];
    this._bind();
  }

  _bind() {
    this.svg.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this.svg.addEventListener('mousedown', this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup', this._onMouseUp.bind(this));
    window.addEventListener('resize', () => this._fit());
    this.svg.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    this.svg.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    this.svg.addEventListener('touchend', this._onTouchEnd.bind(this));
  }

  setTree(root) {
    this.tree = root;
    if (!root) {
      this.svg.innerHTML = '';
      this.world = null;
      this._allNodes = [];
      this._allEdges = [];
      return;
    }
    this._render();
    this._fit();
  }

  /** Re-render the current tree (used after collapse/expand). */
  refresh() {
    if (!this.tree) return;
    const focus = this.world ? { ...this.world } : null;
    this._render();
    if (focus) {
      // keep the same world size; the transform stays valid since _apply reads it
      this._fit();
    }
  }

  _render() {
    const { group, width, height, allNodes, allEdges } = renderTree(this.tree, this);
    this.svg.innerHTML = '';
    this.svg.appendChild(group);
    this.world = { width, height };
    this._allNodes = allNodes;
    this._allEdges = allEdges;
    this._apply();
  }

  _fit() {
    if (!this.world) return;
    const rect = this.wrap.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    if (!W || !H) return;
    const margin = 40;
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
    const k = newScale / this.scale;
    this.tx = cx - k * (cx - this.tx);
    this.ty = cy - k * (cy - this.ty);
    this.scale = newScale;
    this._apply();
  }

  /* ----- collapse / expand ----- */

  toggle(node) {
    if (!node || node._depth === 0) return;
    if (!node.children || !node.children.length) return;
    node._collapsed = !node._collapsed;
    this.refresh();
    this.opts.onToggle?.({ depth: node._depth, collapsed: node._collapsed });
  }

  expandAll() {
    if (!this.tree) return;
    (function clear(n) { n._collapsed = false; for (const c of (n.children||[])) clear(c); })(this.tree);
    this.refresh();
  }

  collapseToDepth(maxDepth) {
    if (!this.tree) return;
    (function walk(n, d) {
      n._collapsed = d >= maxDepth;
      for (const c of (n.children||[])) walk(c, d + 1);
    })(this.tree, 0);
    this.refresh();
  }

  /* ----- hover path ----- */

  _setHover(node) {
    if (!node) return;
    const ancestors = new Set();
    let cur = node;
    while (cur) { ancestors.add(cur); cur = cur._parent; }
    for (const n of this._allNodes) {
      n._el.classList.toggle('mm-node--ancestor', ancestors.has(n));
      n._el.classList.toggle('mm-node--dim', !ancestors.has(n));
    }
    for (const e of this._allEdges) {
      const isPath = ancestors.has(e.from) && ancestors.has(e.to);
      e.el.classList.toggle('mm-edge--ancestor', isPath);
      e.el.classList.toggle('mm-edge--dim', !isPath);
    }
  }

  _clearHover() {
    for (const n of this._allNodes) {
      n._el.classList.remove('mm-node--ancestor', 'mm-node--dim');
    }
    for (const e of this._allEdges) {
      e.el.classList.remove('mm-edge--ancestor', 'mm-edge--dim');
    }
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

/* ----------------------------- tree render ----------------------------- */

function renderTree(root, controller) {
  const g = el('g', { class: 'mm-root' });
  const allNodes = [];
  const allEdges = [];

  // First pass: subtree sizes (respects collapsed)
  layoutSubtree(root, 0, null);
  // Second pass: y positions
  let totalH = 0;
  for (const k of root._visibleChildren) totalH += (k._h + Y_STEP);
  totalH = Math.max(1, totalH - Y_STEP);
  assignPositions(root, 0);

  // Third pass: x positions
  (function placeX(n) {
    n._x = n._depth * X_STEP;
    for (const c of (n._visibleChildren || [])) placeX(c);
  })(root);

  // Shift into positive space
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (function walk(n) {
    minX = Math.min(minX, n._x);
    minY = Math.min(minY, n._y - n._h / 2);
    maxX = Math.max(maxX, n._x + n._w);
    maxY = Math.max(maxY, n._y + n._h / 2);
    for (const c of (n._visibleChildren || [])) walk(c);
  })(root);
  const offsetX = -minX + PAD_X;
  const offsetY = -minY + PAD_Y;
  (function shift(n) {
    n._x += offsetX;
    n._y += offsetY;
    for (const c of (n._visibleChildren || [])) shift(c);
  })(root);

  const totalW = (maxX - minX) + PAD_X * 2;
  const totalH2 = (maxY - minY) + PAD_Y * 2;

  // Edges first
  (function drawEdges(n) {
    for (const c of (n._visibleChildren || [])) {
      const x1 = n._x + n._w;
      const y1 = n._y;
      const x2 = c._x;
      const y2 = c._y;
      const mx = (x1 + x2) / 2;
      const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      const edge = el('path', {
        class: 'mm-edge',
        d,
        stroke: branchColor(c._depth),
        'stroke-opacity': '0.5',
      });
      allEdges.push({ el: edge, from: n, to: c });
      g.appendChild(edge);
      drawEdges(c);
    }
  })(root);

  // Nodes
  (function drawNodes(n) {
    const isRoot = n._depth === 0;
    const hasKids = (n.children || []).length > 0;
    const collapsed = !!n._collapsed;

    const ng = el('g', {
      class: 'mm-node',
      'data-depth': n._depth,
      transform: `translate(${n._x}, ${n._y - n._h / 2})`,
    });
    if (!isRoot) {
      ng.appendChild(el('rect', {
        class: 'mm-node-bg',
        width: n._w,
        height: n._h,
        rx: 10, ry: 10,
        fill: 'var(--surface-2)',
        stroke: branchColor(n._depth),
        'stroke-opacity': '0.45',
        'stroke-width': '1',
      }));
    } else {
      ng.appendChild(el('rect', {
        class: 'mm-node-bg',
        width: n._w,
        height: n._h,
        rx: 14, ry: 14,
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

    // Collapse chevron (skip root)
    if (!isRoot && hasKids) {
      const chevX = n._w - 14;
      const chevY = n._h / 2;
      const chev = el('g', {
        class: 'mm-chevron',
        transform: `translate(${chevX}, ${chevY})`,
        'data-collapsed': collapsed ? '1' : '0',
      });
      chev.appendChild(el('path', {
        d: collapsed ? 'M -3 -3 L 3 0 L -3 3' : 'M -3 -3 L 3 3 M 3 -3 L -3 3',
        stroke: 'var(--text-muted)',
        'stroke-width': '1.4',
        'stroke-linecap': 'round',
        fill: 'none',
      }));
      // small invisible hit area for the chevron
      chev.appendChild(el('circle', { r: 8, fill: 'transparent' }));
      ng.appendChild(chev);
    }

    // Add a hidden count badge when collapsed and has many kids
    if (collapsed) {
      const total = countDescendants(n);
      if (total > 0) {
        const badge = el('g', {
          class: 'mm-count',
          transform: `translate(${n._w + 10}, ${n._h / 2})`,
        });
        badge.appendChild(el('rect', {
          x: 0, y: -9, width: 28, height: 18, rx: 9, ry: 9,
          fill: 'var(--surface-3)',
          stroke: 'var(--border)',
          'stroke-width': '1',
        }));
        const t = el('text', {
          x: 14, y: 4,
          'text-anchor': 'middle',
          fill: 'var(--text-muted)',
          'font-family': 'var(--font-mono)',
          'font-size': '10.5px',
        });
        t.textContent = `+${total}`;
        badge.appendChild(t);
        ng.appendChild(badge);
      }
    }

    n._el = ng;
    allNodes.push(n);
    g.appendChild(ng);

    // interactions
    ng.addEventListener('mouseenter', () => controller._setHover(n));
    ng.addEventListener('mouseleave', () => controller._clearHover());
    ng.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasKids) controller.toggle(n);
    });
    // keyboard a11y
    ng.setAttribute('tabindex', '0');
    ng.setAttribute('role', 'treeitem');
    ng.setAttribute('aria-expanded', hasKids ? String(!collapsed) : null);
    ng.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (hasKids) { e.preventDefault(); controller.toggle(n); }
      }
    });

    for (const c of (n._visibleChildren || [])) drawNodes(c);
  })(root);

  return { group: g, width: totalW, height: totalH2, allNodes, allEdges };
}

function countDescendants(n) {
  let c = 0;
  for (const k of (n.children || [])) c += 1 + countDescendants(k);
  return c;
}
