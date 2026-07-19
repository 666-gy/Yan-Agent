/* Yan Code Map - workspace-scoped state store. */
(function (namespace) {
  'use strict';

  const MAX_LAZY_SYMBOLS = 20;

  class CodeMapStore {
    constructor() {
      this.workspace = '';
      this.status = 'idle';
      this.error = null;
      this.map = null;
      this.nodes = new Map();
      this.children = new Map();
      this.edges = [];
      this.expanded = new Set();
      this.selectedId = null;
      this.matches = new Set();
      this.query = '';
      this.requestVersion = 0;
      this.view = { x: 36, y: 36, scale: 1 };
      this.listeners = new Set();
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit(reason = 'change') {
      for (const listener of this.listeners) listener(this, reason);
    }

    bindWorkspace(workspace) {
      const normalized = String(workspace || '');
      if (normalized === this.workspace) return false;
      this.workspace = normalized;
      this.requestVersion++;
      this.status = normalized ? 'idle' : 'empty';
      this.error = null;
      this.map = null;
      this.nodes.clear();
      this.children.clear();
      this.edges = [];
      this.expanded.clear();
      this.selectedId = null;
      this.matches.clear();
      this.query = '';
      this.view = { x: 36, y: 36, scale: 1 };
      this.emit('workspace');
      return true;
    }

    setStatus(status, error = null) {
      this.status = status;
      this.error = error;
      this.emit('status');
    }

    setMap(map, options = {}) {
      const previousExpanded = new Set(this.expanded);
      const previousSelected = this.selectedId;
      const previousView = { ...this.view };
      this.map = map;
      this.nodes = new Map((map?.nodes || []).map(node => [node.id, node]));
      this.edges = map?.edges || [];
      this.children = new Map();
      for (const node of this.nodes.values()) {
        if (!node.parentId) continue;
        if (!this.children.has(node.parentId)) this.children.set(node.parentId, []);
        this.children.get(node.parentId).push(node.id);
      }
      for (const ids of this.children.values()) {
        ids.sort((a, b) => this.compareNodes(this.nodes.get(a), this.nodes.get(b)));
      }

      this.expanded.clear();
      if (options.preserveView) {
        for (const id of previousExpanded) {
          if (this.nodes.has(id)) this.expanded.add(id);
        }
        if (map?.rootId) this.expanded.add(map.rootId);
        this.selectedId = this.nodes.has(previousSelected) ? previousSelected : map?.rootId || null;
        this.view = previousView;
      } else if (map?.rootId) {
        this.expanded.add(map.rootId);
        this.expandSingleFileWorkspace(map.rootId);
        this.selectedId = map.rootId;
      }
      this.status = 'ready';
      this.error = null;
      this.applyQuery(this.query, false);
      this.emit(options.preserveView ? 'map-refresh' : 'map');
    }

    compareNodes(a, b) {
      const priority = { workspace: 0, directory: 1, file: 2 };
      const ap = priority[a?.kind] ?? 3;
      const bp = priority[b?.kind] ?? 3;
      return ap - bp || String(a?.title || '').localeCompare(String(b?.title || ''), 'zh-CN');
    }

    expandSingleFileWorkspace(startId) {
      const fileCount = this.map?.stats?.files || 0;
      if (fileCount !== 1) return;
      let current = startId;
      while (current) {
        const node = this.nodes.get(current);
        if (!node) break;
        this.expanded.add(current);
        const children = this.getChildIds(node);
        if (children.length !== 1) break;
        current = children[0];
      }
    }

    getChildIds(node) {
      if (!node) return [];
      if (node.kind === 'file' && node.meta?.symbols?.length) {
        return node.meta.symbols.slice(0, MAX_LAZY_SYMBOLS).map(sym => `${node.id}::${sym.id}`);
      }
      return this.children.get(node.id) || [];
    }

    lazySymbolNode(fileNode, symbol) {
      return {
        id: `${fileNode.id}::${symbol.id}`,
        kind: symbol.kind || 'symbol',
        title: symbol.title || symbol.name,
        path: fileNode.path,
        relPath: fileNode.relPath,
        parentId: fileNode.id,
        summary: symbol.summary || '',
        meta: {
          line: symbol.line,
          endLine: symbol.endLine,
          preview: symbol.preview,
          language: fileNode.meta?.language,
          lazy: true
        },
        childCount: 0
      };
    }

    toggle(id) {
      const node = this.nodes.get(id);
      const hasChildren = node ? this.getChildIds(node).length > 0 : (this.children.get(id) || []).length > 0;
      if (!hasChildren) {
        this.selectedId = id;
        this.emit('select');
        return;
      }
      if (this.expanded.has(id)) this.expanded.delete(id);
      else this.expanded.add(id);
      this.selectedId = id;
      this.emit('expand');
    }

    select(id) {
      if (!this.nodes.has(id) && !String(id).includes('::')) return;
      this.selectedId = id;
      this.emit('select');
    }

    revealAncestors(id) {
      const baseId = String(id).includes('::') ? String(id).split('::')[0] : id;
      let current = this.nodes.get(baseId);
      while (current?.parentId) {
        this.expanded.add(current.parentId);
        current = this.nodes.get(current.parentId);
      }
      if (String(id).includes('::')) {
        this.expanded.add(baseId);
      }
    }

    applyQuery(query, shouldEmit = true) {
      this.query = String(query || '').trim().toLowerCase();
      this.matches.clear();
      if (this.query) {
        for (const node of this.nodes.values()) {
          const text = `${node.title || ''} ${node.relPath || ''} ${node.summary || ''}`.toLowerCase();
          if (text.includes(this.query)) {
            this.matches.add(node.id);
            this.revealAncestors(node.id);
          }
          if (node.kind === 'file' && node.meta?.symbols?.length) {
            for (const sym of node.meta.symbols) {
              const symText = `${sym.name || ''} ${sym.summary || ''}`.toLowerCase();
              if (!symText.includes(this.query)) continue;
              const lazyId = `${node.id}::${sym.id}`;
              this.matches.add(lazyId);
              this.revealAncestors(lazyId);
            }
          }
        }
        const first = this.matches.values().next().value;
        if (first) this.selectedId = first;
      }
      if (shouldEmit) this.emit('search');
    }

    getVisibleNodes() {
      const rootId = this.map?.rootId;
      if (!rootId || !this.nodes.has(rootId)) return [];
      const visible = [];
      const visit = (id, depth) => {
        const node = this.nodes.get(id);
        if (!node) return;
        visible.push({ node, depth });
        if (!this.expanded.has(id)) return;

        if (node.kind === 'file' && node.meta?.symbols?.length) {
          for (const sym of node.meta.symbols.slice(0, MAX_LAZY_SYMBOLS)) {
            visible.push({ node: this.lazySymbolNode(node, sym), depth: depth + 1 });
          }
          return;
        }

        for (const childId of this.children.get(id) || []) visit(childId, depth + 1);
      };
      visit(rootId, 0);
      return visible;
    }

    getVisibleEdges(visibleIds) {
      const out = [];
      for (const edge of this.edges) {
        if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
        if (edge.kind === 'contains' || edge.kind === 'imports' || edge.kind === 'related') out.push(edge);
      }
      for (const id of visibleIds) {
        if (!String(id).includes('::')) continue;
        const parentId = String(id).split('::')[0];
        if (!visibleIds.has(parentId)) continue;
        out.push({ id: `${parentId}->${id}`, from: parentId, to: id, kind: 'contains' });
      }
      return out;
    }

    setView(view, emit = true) {
      this.view = {
        x: Number.isFinite(view.x) ? view.x : this.view.x,
        y: Number.isFinite(view.y) ? view.y : this.view.y,
        scale: Math.max(0.2, Math.min(4, Number(view.scale) || this.view.scale))
      };
      if (emit) this.emit('view');
    }
  }

  namespace.Store = CodeMapStore;
})(window.YanCodeMap = window.YanCodeMap || {});
