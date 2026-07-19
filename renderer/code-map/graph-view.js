/* Yan Code Map - DOM cards, SVG relationships, pan/zoom interactions. */
(function (namespace) {
  'use strict';

  const COLUMN_GAP = 56;
  const ROW_GAP = 24;
  const CANVAS_PAD = 56;
  const MAX_VISIBLE_NODES = 96;
  const MAX_EDGES = 120;
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 4;
  const STABLE_VIEW_REASONS = new Set(['expand', 'map-refresh', 'resize']);

  const KIND_LABELS = {
    workspace: '工作区', directory: '目录', file: '文件', function: '函数', class: '类',
    method: '方法', interface: '接口', type: '类型', enum: '枚举', struct: '结构体',
    module: '模块', const: '常量', symbol: '符号', 'code-block': '代码块'
  };

  class GraphView {
    constructor(store, elements) {
      this.store = store;
      this.viewport = elements.viewport;
      this.scene = elements.scene;
      this.world = elements.world;
      this.edges = elements.edges;
      this.zoomValue = elements.zoomValue;
      this.positions = new Map();
      this.dragOffsets = new Map();
      this.cardEls = new Map();
      this.sceneSize = { width: 1, height: 1 };
      this.metrics = this.readMetrics();
      this.liveView = { ...store.view };
      this.pan = null;
      this.cardDrag = null;
      this.skipCardClick = false;
      this.renderQueued = false;
      this.frameQueued = false;
      this.userMoved = false;
      this.didInitialFit = false;
      this.bindInteractions();
      this.observeViewport();
      this.dragOffsets = this.loadDragOffsets();
      this.unsubscribe = store.subscribe((_state, reason) => this.onStoreChange(reason));
    }

    readMetrics() {
      const panelW = this.viewport?.clientWidth || 420;
      const cardW = Math.round(Math.min(480, Math.max(240, panelW * 0.52)));
      const cardH = Math.round(Math.min(188, Math.max(112, cardW * 0.44)));
      if (this.viewport) {
        this.viewport.style.setProperty('--cm-card-width', `${cardW}px`);
        this.viewport.style.setProperty('--cm-card-height', `${cardH}px`);
      }
      return { cardW, cardH, columnGap: COLUMN_GAP, rowGap: ROW_GAP, pad: CANVAS_PAD };
    }

    observeViewport() {
      if (!this.viewport || typeof ResizeObserver === 'undefined') return;
      this.resizeObserver = new ResizeObserver(() => {
        const prev = this.metrics.cardW;
        this.metrics = this.readMetrics();
        if (Math.abs(prev - this.metrics.cardW) >= 8) this.queueRender('resize');
      });
      this.resizeObserver.observe(this.viewport);
    }

    onStoreChange(reason) {
      if (reason === 'workspace') {
        this.dragOffsets = this.loadDragOffsets();
        this.queueRender('workspace');
        return;
      }
      if (reason === 'view') {
        this.liveView = { ...this.store.view };
        this.applyTransform(this.liveView);
        return;
      }
      if (reason === 'select') {
        this.updateSelection();
        return;
      }
      this.queueRender(reason);
    }

    queueRender(reason) {
      if (this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render(reason);
      });
    }

    layout(visible) {
      const visibleIds = new Set(visible.map(item => item.node.id));
      const positions = new Map();
      const { cardW, cardH, columnGap, rowGap, pad } = this.metrics;

      const layoutNode = (id, depth, topY) => {
        const childIds = this.childIdsForLayout(id, visibleIds);
        const x = pad + depth * (cardW + columnGap);

        if (!childIds.length) {
          positions.set(id, { x, y: topY });
          return topY + cardH + rowGap;
        }

        let cursorY = topY;
        const childTops = [];
        for (const childId of childIds) {
          childTops.push(cursorY);
          cursorY = layoutNode(childId, depth + 1, cursorY);
        }
        const blockBottom = cursorY - rowGap;
        const centerY = topY + (blockBottom - topY) / 2;
        positions.set(id, { x, y: Math.max(topY, centerY - cardH / 2) });
        return cursorY;
      };

      if (this.store.map?.rootId && visibleIds.has(this.store.map.rootId)) {
        layoutNode(this.store.map.rootId, 0, pad);
      }

      let width = cardW + pad * 2;
      let height = cardH + pad * 2;
      for (const position of positions.values()) {
        width = Math.max(width, position.x + cardW + pad);
        height = Math.max(height, position.y + cardH + pad);
      }
      return { positions, width, height };
    }

    offsetsStorageKey() {
      return `yan:code-map-offsets:${this.store.workspace || 'default'}`;
    }

    loadDragOffsets() {
      try {
        const raw = localStorage.getItem(this.offsetsStorageKey());
        if (!raw) return new Map();
        const parsed = JSON.parse(raw);
        return new Map(Object.entries(parsed).map(([id, value]) => [id, { dx: value.dx || 0, dy: value.dy || 0 }]));
      } catch {
        return new Map();
      }
    }

    saveDragOffsets() {
      try {
        const payload = {};
        for (const [id, value] of this.dragOffsets) {
          if (value.dx || value.dy) payload[id] = value;
        }
        localStorage.setItem(this.offsetsStorageKey(), JSON.stringify(payload));
      } catch { /* optional */ }
    }

    getDisplayPosition(id) {
      const base = this.positions.get(id);
      if (!base) return null;
      const offset = this.dragOffsets.get(id) || { dx: 0, dy: 0 };
      return { x: base.x + offset.dx, y: base.y + offset.dy };
    }

    recomputeSceneBounds(visibleIds) {
      const { cardW, cardH, pad } = this.metrics;
      let width = cardW + pad * 2;
      let height = cardH + pad * 2;
      for (const id of visibleIds) {
        const position = this.getDisplayPosition(id);
        if (!position) continue;
        width = Math.max(width, position.x + cardW + pad);
        height = Math.max(height, position.y + cardH + pad);
      }
      return { width, height };
    }

    applyCardTransform(card, position) {
      card.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }

    updateCardPosition(id) {
      const card = this.cardEls.get(id);
      const position = this.getDisplayPosition(id);
      if (card && position) this.applyCardTransform(card, position);
    }

    childIdsForLayout(id, visibleIds) {
      if (!visibleIds.has(id) || String(id).includes('::')) return [];
      if (!this.store.expanded.has(id)) return [];
      const node = this.store.nodes.get(id);
      if (!node) return [];
      if (node.kind === 'file' && node.meta?.symbols?.length) {
        return node.meta.symbols
          .slice(0, 20)
          .map(sym => `${node.id}::${sym.id}`)
          .filter(lazyId => visibleIds.has(lazyId));
      }
      return (this.store.children.get(id) || []).filter(childId => visibleIds.has(childId));
    }

    render(reason = 'change') {
      this.metrics = this.readMetrics();
      if (reason === 'workspace' || reason === 'map') this.dragOffsets = this.loadDragOffsets();
      const visible = this.store.getVisibleNodes().slice(0, MAX_VISIBLE_NODES);
      if (!visible.length) {
        this.world.replaceChildren();
        this.edges.replaceChildren(this.createEdgeDefs());
        this.cardEls.clear();
        return;
      }

      const anchor = STABLE_VIEW_REASONS.has(reason) ? this.captureViewportCenter() : null;
      const layout = this.layout(visible);
      this.positions = layout.positions;
      const visibleIds = new Set(visible.map(item => item.node.id));
      const bounds = this.recomputeSceneBounds(visibleIds);
      this.sceneSize = bounds;
      this.scene.style.width = `${bounds.width}px`;
      this.scene.style.height = `${bounds.height}px`;
      this.world.style.width = `${bounds.width}px`;
      this.world.style.height = `${bounds.height}px`;
      this.edges.setAttribute('width', String(bounds.width));
      this.edges.setAttribute('height', String(bounds.height));
      this.edges.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      for (const [id, el] of this.cardEls) {
        if (!visibleIds.has(id)) {
          el.remove();
          this.cardEls.delete(id);
        }
      }

      for (const { node } of visible) {
        const position = this.getDisplayPosition(node.id);
        if (!position) continue;
        let card = this.cardEls.get(node.id);
        if (!card) {
          card = this.createCard(node, position);
          this.world.appendChild(card);
          this.cardEls.set(node.id, card);
        } else {
          this.updateCard(card, node, position);
        }
      }

      if (reason !== 'view') this.renderEdges(visibleIds);
      this.applyTransform(this.liveView);

      if (anchor) this.restoreViewportCenter(anchor);

      if (reason === 'map' && !this.userMoved && !this.didInitialFit) {
        this.didInitialFit = true;
        requestAnimationFrame(() => this.fit());
      } else if (reason === 'search' && this.store.selectedId) {
        requestAnimationFrame(() => this.focusNode(this.store.selectedId, false));
      }
    }

    captureViewportCenter() {
      const cx = this.viewport.clientWidth / 2;
      const cy = this.viewport.clientHeight / 2;
      return {
        worldX: (cx - this.liveView.x) / this.liveView.scale,
        worldY: (cy - this.liveView.y) / this.liveView.scale,
        screenX: cx,
        screenY: cy
      };
    }

    restoreViewportCenter(anchor) {
      this.liveView = {
        x: anchor.screenX - anchor.worldX * this.liveView.scale,
        y: anchor.screenY - anchor.worldY * this.liveView.scale,
        scale: this.liveView.scale
      };
      this.store.view = { ...this.liveView };
      this.applyTransform(this.liveView);
    }

    createCard(node, position) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'code-map-card';
      card.dataset.nodeId = node.id;
      card.dataset.kind = node.kind;
      card.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
      this.fillCard(card, node);
      card.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const offset = this.dragOffsets.get(node.id) || { dx: 0, dy: 0 };
        this.cardDrag = {
          pointerId: event.pointerId,
          nodeId: node.id,
          startX: event.clientX,
          startY: event.clientY,
          originDx: offset.dx,
          originDy: offset.dy,
          moved: false
        };
        card.setPointerCapture(event.pointerId);
        card.classList.add('is-dragging');
      });
      card.addEventListener('click', event => {
        event.stopPropagation();
        if (this.skipCardClick) return;
        if (String(node.id).includes('::')) {
          this.store.select(node.id);
          return;
        }
        this.store.toggle(node.id);
      });
      card.addEventListener('dblclick', event => {
        event.stopPropagation();
        this.focusNode(node.id, true);
      });
      return card;
    }

    updateCard(card, node, position) {
      this.applyCardTransform(card, position);
      card.dataset.kind = node.kind;
      card.classList.toggle('is-selected', this.store.selectedId === node.id);
      card.classList.toggle('is-match', this.store.matches.has(node.id));
      const title = card.querySelector('.code-map-card-title');
      const summary = card.querySelector('.code-map-card-summary');
      const metaDetail = card.querySelector('.code-map-card-meta > span:first-child');
      const hint = card.querySelector('.code-map-expand-hint');
      if (title && title.textContent !== (node.title || '')) title.textContent = node.title || '(未命名)';
      if (summary && summary.textContent !== (node.summary || '')) summary.textContent = node.summary || '暂无职责说明。';
      if (metaDetail) metaDetail.textContent = this.metaText(node);
      if (hint) {
        const baseId = String(node.id).includes('::') ? String(node.id).split('::')[0] : node.id;
        const hasChildren = this.store.getChildIds(this.store.nodes.get(baseId) || node).length > 0;
        hint.textContent = hasChildren
          ? (this.store.expanded.has(baseId) ? '收起' : `展开 ${node.childCount || ''}`.trim())
          : '';
        hint.style.display = hasChildren ? '' : 'none';
      }
    }

    fillCard(card, node) {
      card.replaceChildren();
      if (this.store.selectedId === node.id) card.classList.add('is-selected');
      if (this.store.matches.has(node.id)) card.classList.add('is-match');

      const top = document.createElement('span');
      top.className = 'code-map-card-top';
      const pill = document.createElement('span');
      pill.className = 'code-map-kind-pill';
      pill.textContent = KIND_LABELS[node.kind] || node.kind;
      const title = document.createElement('span');
      title.className = 'code-map-card-title';
      title.textContent = node.title || '(未命名)';
      top.append(pill, title);

      const summary = document.createElement('span');
      summary.className = 'code-map-card-summary';
      summary.textContent = node.summary || '暂无职责说明。';

      const preview = node.meta?.preview;
      if (preview && (node.kind === 'file' || node.meta?.lazy)) {
        const code = document.createElement('span');
        code.className = 'code-map-card-preview';
        code.textContent = preview;
        card.append(top, summary, code);
      } else {
        card.append(top, summary);
      }

      const meta = document.createElement('span');
      meta.className = 'code-map-card-meta';
      const detail = document.createElement('span');
      detail.textContent = this.metaText(node);
      meta.appendChild(detail);
      const baseId = String(node.id).includes('::') ? String(node.id).split('::')[0] : node.id;
      const childCount = node.childCount || this.store.getChildIds(this.store.nodes.get(baseId) || node).length;
      if (childCount > 0 && !node.meta?.lazy) {
        const hint = document.createElement('span');
        hint.className = 'code-map-expand-hint';
        hint.textContent = this.store.expanded.has(baseId) ? '收起' : `展开 ${childCount}`;
        meta.appendChild(hint);
      }
      card.appendChild(meta);
      card.setAttribute('aria-label', `${KIND_LABELS[node.kind] || node.kind} ${node.title}。${node.summary || ''}`);
    }

    metaText(node) {
      if (node.kind === 'workspace') {
        return `${node.meta?.fileCount || 0} 文件 · ${node.meta?.symbolCount || 0} 符号`;
      }
      if (node.kind === 'directory') return `${node.meta?.fileCount || 0} 文件`;
      if (node.kind === 'file') {
        const source = node.meta?.summarySource === 'ai' ? ' · AI' : '';
        return `${node.meta?.language || 'text'} · ${node.meta?.lineCount || 0} 行${source}`;
      }
      const start = node.meta?.line;
      const end = node.meta?.endLine;
      return start ? `L${start}${end && end !== start ? `-${end}` : ''}` : (node.relPath || '');
    }

    createEdgeDefs() {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'code-map-arrow');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('refX', '7');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', '0 0, 8 3, 0 6');
      poly.setAttribute('fill', 'currentColor');
      marker.appendChild(poly);
      defs.appendChild(marker);
      return defs;
    }

    drawEdgePath(from, to, kind) {
      const { cardW, cardH } = this.metrics;
      const x1 = from.x + cardW;
      const y1 = from.y + cardH / 2;
      const x2 = to.x;
      const y2 = to.y + cardH / 2;
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.classList.add('code-map-edge');
      pathEl.dataset.kind = kind;
      if (kind === 'imports') pathEl.setAttribute('marker-end', 'url(#code-map-arrow)');
      const bend = Math.max(36, Math.abs(x2 - x1) * 0.38);
      pathEl.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
      return pathEl;
    }

    renderEdges(visibleIds) {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(this.createEdgeDefs());
      const edges = this.store.getVisibleEdges(visibleIds).slice(0, MAX_EDGES);
      for (const edge of edges) {
        const from = this.getDisplayPosition(edge.from);
        const to = this.getDisplayPosition(edge.to);
        if (!from || !to) continue;
        fragment.appendChild(this.drawEdgePath(from, to, edge.kind));
      }
      this.edges.replaceChildren(fragment);
    }

    updateSelection() {
      for (const [id, card] of this.cardEls) {
        card.classList.toggle('is-selected', id === this.store.selectedId);
      }
    }

    bindInteractions() {
      this.viewport.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('.code-map-card')) return;
        this.pan = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: this.liveView.x,
          originY: this.liveView.y
        };
        this.viewport.setPointerCapture(event.pointerId);
        this.viewport.classList.add('is-panning');
      });

      this.viewport.addEventListener('pointermove', event => {
        if (this.cardDrag && event.pointerId === this.cardDrag.pointerId) {
          const scale = this.liveView.scale || 1;
          const dx = (event.clientX - this.cardDrag.startX) / scale;
          const dy = (event.clientY - this.cardDrag.startY) / scale;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.cardDrag.moved = true;
          this.dragOffsets.set(this.cardDrag.nodeId, {
            dx: this.cardDrag.originDx + dx,
            dy: this.cardDrag.originDy + dy
          });
          this.updateCardPosition(this.cardDrag.nodeId);
          const visibleIds = new Set(this.store.getVisibleNodes().map(item => item.node.id));
          this.renderEdges(visibleIds);
          return;
        }
        if (!this.pan || event.pointerId !== this.pan.pointerId) return;
        this.userMoved = true;
        this.liveView = {
          x: this.pan.originX + event.clientX - this.pan.startX,
          y: this.pan.originY + event.clientY - this.pan.startY,
          scale: this.liveView.scale
        };
        this.queueFrame();
      });

      const endPointer = event => {
        if (this.cardDrag && event.pointerId === this.cardDrag.pointerId) {
          const card = this.cardEls.get(this.cardDrag.nodeId);
          card?.classList.remove('is-dragging');
          card?.releasePointerCapture?.(event.pointerId);
          if (this.cardDrag.moved) {
            this.skipCardClick = true;
            requestAnimationFrame(() => { this.skipCardClick = false; });
            this.saveDragOffsets();
            this.userMoved = true;
          }
          this.cardDrag = null;
          return;
        }
        if (!this.pan || event.pointerId !== this.pan.pointerId) return;
        this.pan = null;
        this.viewport.classList.remove('is-panning');
        this.store.view = { ...this.liveView };
      };
      this.viewport.addEventListener('pointerup', endPointer);
      this.viewport.addEventListener('pointercancel', endPointer);

      this.viewport.addEventListener('wheel', event => {
        event.preventDefault();
        const rect = this.viewport.getBoundingClientRect();
        const old = this.liveView;
        const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, old.scale * Math.exp(-event.deltaY * 0.0012)));
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const worldX = (pointerX - old.x) / old.scale;
        const worldY = (pointerY - old.y) / old.scale;
        this.userMoved = true;
        this.liveView = {
          x: pointerX - worldX * nextScale,
          y: pointerY - worldY * nextScale,
          scale: nextScale
        };
        this.queueFrame();
        this.store.view = { ...this.liveView };
      }, { passive: false });
    }

    queueFrame() {
      if (this.frameQueued) return;
      this.frameQueued = true;
      requestAnimationFrame(() => {
        this.frameQueued = false;
        this.applyTransform(this.liveView);
        if (this.zoomValue) {
          this.zoomValue.textContent = `${Math.round(this.liveView.scale * 100)}%`;
        }
      });
    }

    applyTransform(view) {
      const { x, y, scale } = view || this.liveView;
      this.scene.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      if (this.zoomValue) this.zoomValue.textContent = `${Math.round(scale * 100)}%`;
    }

    zoomBy(factor) {
      if (!this.viewport?.clientWidth) return;
      const cx = this.viewport.clientWidth / 2;
      const cy = this.viewport.clientHeight / 2;
      const old = this.liveView;
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, old.scale * factor));
      const worldX = (cx - old.x) / old.scale;
      const worldY = (cy - old.y) / old.scale;
      this.userMoved = true;
      this.liveView = {
        x: cx - worldX * nextScale,
        y: cy - worldY * nextScale,
        scale: nextScale
      };
      this.store.view = { ...this.liveView };
      this.applyTransform(this.liveView);
    }

    fit() {
      if (!this.viewport.clientWidth || !this.viewport.clientHeight) return;
      this.userMoved = false;
      const padding = 28;
      const scaleX = (this.viewport.clientWidth - padding * 2) / this.sceneSize.width;
      const scaleY = (this.viewport.clientHeight - padding * 2) / this.sceneSize.height;
      const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scaleX, scaleY));
      this.liveView = {
        x: (this.viewport.clientWidth - this.sceneSize.width * scale) / 2,
        y: (this.viewport.clientHeight - this.sceneSize.height * scale) / 2,
        scale
      };
      this.store.view = { ...this.liveView };
      this.applyTransform(this.liveView);
    }

    focusNode(id, bumpZoom) {
      const position = this.getDisplayPosition(id);
      if (!position || !this.viewport.clientWidth) return;
      const { cardW, cardH } = this.metrics;
      const scale = bumpZoom
        ? Math.max(this.liveView.scale, Math.min(MAX_ZOOM, this.liveView.scale * 1.12))
        : this.liveView.scale;
      this.userMoved = true;
      this.liveView = {
        x: this.viewport.clientWidth / 2 - (position.x + cardW / 2) * scale,
        y: this.viewport.clientHeight / 2 - (position.y + cardH / 2) * scale,
        scale
      };
      this.store.view = { ...this.liveView };
      this.applyTransform(this.liveView);
    }

    resetViewState() {
      this.didInitialFit = false;
      this.userMoved = false;
    }

    resetCardLayout() {
      this.dragOffsets.clear();
      this.saveDragOffsets();
      this.queueRender('change');
    }

    destroy() {
      this.resizeObserver?.disconnect();
      this.unsubscribe?.();
      this.cardEls.clear();
    }
  }

  namespace.GraphView = GraphView;
})(window.YanCodeMap = window.YanCodeMap || {});
