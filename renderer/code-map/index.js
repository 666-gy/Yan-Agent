/* Yan Code Map - overlay controller and IPC lifecycle. */
(function (namespace) {
  'use strict';

  let controller = null;

  class CodeMapController {
    constructor(options) {
      this.api = options.api;
      this.hooks = options.hooks || {};
      this.store = new namespace.Store();
      this.layer = document.getElementById('codeMapLayer');
      this.button = document.getElementById('taskBarCodeMap');
      this.resizeHandle = document.getElementById('codeMapResizeHandle');
      this.refreshButton = document.getElementById('codeMapRefresh');
      this.search = document.getElementById('codeMapSearch');
      this.status = document.getElementById('codeMapStatus');
      this.statusText = document.getElementById('codeMapStatusText');
      this.modelBtn = document.getElementById('codeMapModelBtn');
      this.modelName = document.getElementById('codeMapModelName');
      this.modelMenu = document.getElementById('codeMapModelMenu');
      this.workspaceName = document.getElementById('codeMapWorkspaceName');
      this.empty = document.getElementById('codeMapEmpty');
      this.emptyTitle = document.getElementById('codeMapEmptyTitle');
      this.emptyText = document.getElementById('codeMapEmptyText');
      this.viewport = document.getElementById('codeMapViewport');
      this.opened = false;
      this.enriching = false;
      this.refreshTimer = null;
      this.modelCatalog = [];
      this.analysisModel = { modelId: 'deepseek-v4-flash', modelName: 'DeepSeek V4 Flash', aiAvailable: false };
      this.elementsReady = !!(this.layer && this.button && this.viewport);
      if (!this.elementsReady) return;

      this.graph = new namespace.GraphView(this.store, {
        viewport: this.viewport,
        scene: document.getElementById('codeMapScene'),
        world: document.getElementById('codeMapWorld'),
        edges: document.getElementById('codeMapEdges'),
        zoomValue: document.getElementById('codeMapZoomValue')
      });
      this.bindEvents();
      this.unsubscribeStore = this.store.subscribe((_store, reason) => this.syncChrome(reason));
      this.bindWorkspace(this.hooks.getWorkspace?.() || '');
      this.loadModelState();
    }

    shortModelName(modelId, modelName) {
      if (modelId === 'deepseek-v4-flash') return 'DS V4 Flash';
      const name = String(modelName || modelId || 'DS V4 Flash');
      return name.replace(/^DeepSeek\s+/i, 'DS ').replace(/^Qwen/i, 'Qwen');
    }

    async loadModelState() {
      if (!this.api?.getCodeMapModel || !this.modelBtn) return;
      try {
        const [current, catalog] = await Promise.all([
          this.api.getCodeMapModel(),
          this.api.listCodeMapModels?.() || []
        ]);
        if (current?.error && !current?.modelId) return;
        this.analysisModel = current || this.analysisModel;
        this.modelCatalog = Array.isArray(catalog) ? catalog : [];
        this.renderModelButton();
        this.renderModelMenu();
      } catch { /* optional */ }
    }

    renderModelButton() {
      if (!this.modelBtn || !this.modelName) return;
      const { modelId, modelName, aiAvailable } = this.analysisModel;
      this.modelName.textContent = this.shortModelName(modelId, modelName);
      this.modelBtn.classList.toggle('is-missing-key', !aiAvailable);
      this.modelBtn.title = aiAvailable
        ? `AI 解读模型：${modelName || modelId}`
        : `AI 解读模型：${modelName || modelId}（未配置 API Key）`;
    }

    renderModelMenu() {
      if (!this.modelMenu) return;
      const currentId = this.analysisModel.modelId;
      if (!this.modelCatalog.length) {
        this.modelMenu.innerHTML = '<div class="code-map-model-option-note" style="padding:8px 10px">暂无可用模型</div>';
        return;
      }
      this.modelMenu.innerHTML = this.modelCatalog.map(model => {
        const active = model.id === currentId ? ' is-active' : '';
        const disabled = model.hasKey ? '' : ' is-disabled';
        const note = model.hasKey ? '' : '<span class="code-map-model-option-note">需先在设置中配置 API Key</span>';
        return `
          <button type="button" class="code-map-model-option${active}${disabled}" data-model-id="${model.id}" role="option" aria-selected="${model.id === currentId}">
            <span class="code-map-model-option-top">
              <span class="code-map-model-option-name">${this.escapeHtml(model.name)}</span>
              <span class="code-map-model-option-provider">${this.escapeHtml(model.providerName)}</span>
            </span>
            <span class="code-map-model-option-id">${this.escapeHtml(model.id)}</span>
            ${note}
          </button>
        `;
      }).join('');
      this.modelMenu.querySelectorAll('.code-map-model-option').forEach(option => {
        option.addEventListener('click', () => this.selectModel(option.dataset.modelId));
      });
    }

    escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    setModelMenuOpen(open) {
      if (!this.modelBtn || !this.modelMenu) return;
      this.modelBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      this.modelMenu.classList.toggle('hidden', !open);
    }

    async selectModel(modelId) {
      if (!modelId || modelId === this.analysisModel.modelId) {
        this.setModelMenuOpen(false);
        return;
      }
      const target = this.modelCatalog.find(item => item.id === modelId);
      if (target && !target.hasKey) {
        this.hooks.toast?.(`请先在设置中配置 ${target.providerName} API Key`);
        return;
      }
      try {
        const result = await this.api.setCodeMapModel(modelId);
        if (result?.error) throw new Error(result.error);
        this.analysisModel = {
          modelId: result.modelId,
          modelName: result.modelName,
          providerName: result.providerName,
          aiAvailable: !!result.aiAvailable,
          error: result.error || null
        };
        this.renderModelButton();
        this.renderModelMenu();
        this.setModelMenuOpen(false);
        this.hooks.toast?.(`解读模型已切换为 ${this.shortModelName(result.modelId, result.modelName)}`);
        const pending = this.store.map?.stats?.aiPending || 0;
        if (this.opened && pending > 0 && result.aiAvailable) {
          this.enrich(this.store.requestVersion, this.store.workspace);
        }
      } catch (error) {
        this.hooks.toast?.(error.message || '切换解读模型失败');
      }
    }

    bindModelPicker() {
      if (!this.modelBtn || !this.modelMenu) return;
      this.modelBtn.addEventListener('click', event => {
        event.stopPropagation();
        const open = this.modelBtn.getAttribute('aria-expanded') !== 'true';
        this.setModelMenuOpen(open);
      });
      document.addEventListener('click', event => {
        if (!this.modelMenu || this.modelMenu.classList.contains('hidden')) return;
        if (event.target.closest('.code-map-model-picker')) return;
        this.setModelMenuOpen(false);
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') this.setModelMenuOpen(false);
      });
    }

    bindEvents() {
      this.button.addEventListener('click', () => this.toggle());
      document.getElementById('codeMapClose')?.addEventListener('click', () => this.close());
      document.getElementById('codeMapFit')?.addEventListener('click', () => this.graph.fit());
      document.getElementById('codeMapZoomIn')?.addEventListener('click', () => this.graph.zoomBy(1.18));
      document.getElementById('codeMapZoomOut')?.addEventListener('click', () => this.graph.zoomBy(1 / 1.18));
      this.refreshButton?.addEventListener('click', () => this.load({ force: true }));
      this.search?.addEventListener('input', () => this.store.applyQuery(this.search.value));
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.opened) this.close();
      });
      this.bindResize();
      this.bindModelPicker();

      this.api.onCodeMapProgress?.(progress => {
        if (!this.opened || progress?.workspace !== this.store.workspace) return;
        const completed = Number(progress.completed) || 0;
        const total = Number(progress.total) || 0;
        this.setStatus('analyzing', total
          ? `AI 解读 ${completed}/${total} · ${this.shortModelName(this.analysisModel.modelId, this.analysisModel.modelName)}`
          : `AI 正在解读 · ${this.shortModelName(this.analysisModel.modelId, this.analysisModel.modelName)}`);
      });
      this.api.onCodeMapChanged?.(detail => {
        if (!this.opened || this.enriching || detail?.workspace !== this.store.workspace) return;
        this.scheduleRefresh(300);
      });

      this.layoutObserver = new ResizeObserver(() => this.syncLayout());
      const page = document.getElementById('pageChat');
      if (page) this.layoutObserver.observe(page);
      document.getElementById('app')?.addEventListener('transitionend', event => {
        if (!this.opened) return;
        if (event.propertyName === 'width' || event.propertyName === 'opacity') this.syncLayout();
      });
    }

    bindResize() {
      let drag = null;
      const applyWidth = width => {
        const page = document.getElementById('pageChat');
        const max = page?.getBoundingClientRect().width || window.innerWidth;
        const min = Math.min(300, max);
        const chatMin = Math.min(360, Math.max(240, max * 0.34));
        const clamped = Math.max(min, Math.min(max - chatMin, width));
        this.layer.style.setProperty('--code-map-width', `${Math.round(clamped)}px`);
        return clamped;
      };
      const finish = event => {
        if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
        const width = this.layer.getBoundingClientRect().width;
        drag = null;
        this.layer.classList.remove('is-resizing');
        document.body.classList.remove('code-map-resizing');
        this.persistWidth(width);
      };

      this.resizeHandle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const pageRect = document.getElementById('pageChat').getBoundingClientRect();
        drag = { pointerId: event.pointerId, right: pageRect.right };
        this.resizeHandle.setPointerCapture(event.pointerId);
        this.layer.classList.add('is-resizing');
        document.body.classList.add('code-map-resizing');
        event.preventDefault();
      });
      this.resizeHandle.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        applyWidth(drag.right - event.clientX);
        this.graph?.readMetrics?.();
      });
      this.resizeHandle.addEventListener('pointerup', finish);
      this.resizeHandle.addEventListener('pointercancel', finish);
      this.resizeHandle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const current = this.layer.getBoundingClientRect().width;
        const width = applyWidth(current + (event.key === 'ArrowLeft' ? 32 : -32));
        this.persistWidth(width);
      });
    }

    widthKey() {
      return `yan:code-map-width:${this.store.workspace || 'default'}`;
    }

    persistWidth(width) {
      try { localStorage.setItem(this.widthKey(), String(Math.round(width))); } catch { /* optional */ }
    }

    restoreWidth() {
      const page = document.getElementById('pageChat');
      if (page?.classList.contains('code-map-active')) {
        this.layer.style.removeProperty('--code-map-width');
        return;
      }
      const max = page?.getBoundingClientRect().width || 0;
      let width = max * 0.5;
      try {
        const saved = Number(localStorage.getItem(this.widthKey()));
        if (Number.isFinite(saved) && saved > 0) width = saved;
      } catch { /* optional */ }
      width = Math.max(Math.min(300, max), Math.min(max, width));
      this.layer.style.setProperty('--code-map-width', `${Math.round(width)}px`);
    }

    syncLayout() {
      if (!this.opened) return;
      this.restoreWidth();
      this.graph?.readMetrics?.();
      this.graph?.queueRender?.('resize');
    }

    async toggle() {
      if (this.opened) this.close();
      else await this.open();
    }

    async open() {
      const workspace = this.hooks.getWorkspace?.() || this.store.workspace;
      if (!workspace) {
        this.hooks.toast?.('请先选择工作区');
        return;
      }
      this.bindWorkspace(workspace);
      this.hooks.closeBrowser?.();
      this.hooks.closeTerminal?.();
      this.hooks.setRightSidebarOpen?.(false);
      this.opened = true;
      this.layer.classList.remove('hidden');
      document.getElementById('pageChat')?.classList.add('code-map-active');
      this.button.classList.add('active');
      this.button.setAttribute('aria-label', 'Close Yan Project Map');
      this.restoreWidth();
      requestAnimationFrame(() => this.syncLayout());
      await this.loadModelState();
      if (!this.store.map) await this.load();
      else {
        this.graph.metrics = this.graph.readMetrics();
        this.graph.liveView = { ...this.store.view };
        this.graph.applyTransform(this.graph.liveView);
        this.graph.queueRender('resize');
      }
    }

    close() {
      if (!this.elementsReady) return;
      this.setModelMenuOpen(false);
      this.opened = false;
      document.getElementById('pageChat')?.classList.remove('code-map-active');
      this.layer.classList.add('hidden');
      this.button.classList.remove('active');
      this.button.setAttribute('aria-label', 'Open Yan Project Map');
    }

    bindWorkspace(workspace) {
      if (!this.elementsReady) return;
      const normalized = String(workspace || '');
      const changed = this.store.bindWorkspace(normalized);
      if (!normalized && this.opened) this.close();
      this.button.disabled = !normalized;
      this.workspaceName.textContent = normalized ? this.basename(normalized) : '未选择工作区';
      this.workspaceName.title = normalized;
      if (changed && this.search) this.search.value = '';
      if (changed && this.opened && normalized) this.load();
      if (!normalized) this.showEmpty('选择工作区后生成 Yan Project Map', '目录、文件和函数职责会显示在这里');
    }

    basename(value) {
      return String(value || '').split(/[\\/]/).filter(Boolean).pop() || value;
    }

    async load({ force = false } = {}) {
      const workspace = this.store.workspace || this.hooks.getWorkspace?.();
      if (!workspace) {
        this.showEmpty('选择工作区后生成 Yan Project Map', '目录、文件和函数职责会显示在这里');
        return;
      }
      const requestVersion = ++this.store.requestVersion;
      this.setLoading(true);
      this.setStatus('loading', force ? '正在重新扫描' : '正在读取项目');
      this.showEmpty('正在构建 Yan Project Map', '先读取本地缓存，再检查发生变化的文件');
      try {
        const result = await this.api.getCodeMap(workspace, force);
        if (requestVersion !== this.store.requestVersion || workspace !== this.store.workspace) return;
        if (result?.error) throw new Error(result.error);
        const hadMap = !!this.store.map;
        this.analysisModel = {
          modelId: result.analysisModel || this.analysisModel.modelId,
          modelName: result.analysisModelName || this.analysisModel.modelName,
          providerName: result.analysisProvider || this.analysisModel.providerName,
          aiAvailable: !!result.aiAvailable,
          error: result.analysisError || null
        };
        this.renderModelButton();
        this.store.setMap(result, { preserveView: hadMap && !force });
        this.showGraph();
        if (!hadMap || force) {
          this.graph.resetViewState();
          requestAnimationFrame(() => this.graph.fit());
        }
        const stats = result.stats || {};
        const cacheText = stats.reused ? ` · 复用 ${stats.reused}` : '';
        this.setStatus('ready', `${stats.files || 0} 文件${cacheText}`);
        if (result.aiAvailable && stats.aiPending > 0) this.enrich(requestVersion, workspace);
        else if (result.analysisError) this.setStatus('ready', `${stats.files || 0} 文件 · ${result.analysisError}`);
      } catch (error) {
        if (requestVersion !== this.store.requestVersion) return;
        this.store.setStatus('error', error.message);
        this.setStatus('error', '分析失败');
        this.showEmpty('Yan Project Map 生成失败', error.message || '请稍后重试');
      } finally {
        if (requestVersion === this.store.requestVersion) this.setLoading(false);
      }
    }

    async enrich(requestVersion, workspace) {
      if (this.enriching) return;
      this.enriching = true;
      this.setStatus('analyzing', `AI 正在补充职责 · ${this.shortModelName(this.analysisModel.modelId, this.analysisModel.modelName)}`);
      try {
        const result = await this.api.enrichCodeMap(workspace, 18);
        if (requestVersion !== this.store.requestVersion || workspace !== this.store.workspace) return;
        if (result?.analysisModel) {
          this.analysisModel = {
            ...this.analysisModel,
            modelId: result.analysisModel,
            modelName: result.analysisModelName || result.analysisModel,
            aiAvailable: true
          };
          this.renderModelButton();
        }
        if (result?.map) {
          result.map.aiAvailable = true;
          this.store.setMap(result.map, { preserveView: true });
        }
        const stats = result?.map?.stats || this.store.map?.stats || {};
        const suffix = result?.updated ? ` · AI 更新 ${result.updated}` : '';
        this.setStatus('ready', `${stats.files || 0} 文件${suffix}`);
      } catch {
        if (requestVersion === this.store.requestVersion) this.setStatus('ready', '本地分析完成');
      } finally {
        this.enriching = false;
      }
    }

    handleWorkspaceChanged(detail) {
      if (!this.opened || !this.store.workspace || this.enriching) return;
      if (detail?.workspace && detail.workspace !== this.store.workspace) return;
      this.setStatus('loading', '检测到文件变化');
      this.scheduleRefresh(1400);
    }

    scheduleRefresh(delay = 1400) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.load(), delay);
    }

    setLoading(loading) {
      this.refreshButton.disabled = loading;
      this.refreshButton.classList.toggle('is-spinning', loading);
    }

    setStatus(status, text) {
      this.status.dataset.status = status;
      this.statusText.textContent = text;
    }

    showEmpty(title, text) {
      this.emptyTitle.textContent = title;
      this.emptyText.textContent = text;
      this.empty.classList.remove('hidden');
      this.viewport.classList.add('hidden');
    }

    showGraph() {
      this.empty.classList.add('hidden');
      this.viewport.classList.remove('hidden');
    }

    syncChrome(reason) {
      if (reason === 'status' && this.store.status === 'error') {
        this.setStatus('error', this.store.error || '分析失败');
      }
    }
  }

  namespace.init = function init(options) {
    if (controller) return controller;
    controller = new CodeMapController(options);
    return controller;
  };
  namespace.open = () => controller?.open();
  namespace.close = () => controller?.close();
  namespace.toggle = () => controller?.toggle();
  namespace.bindWorkspace = workspace => controller?.bindWorkspace(workspace);
  namespace.handleWorkspaceChanged = detail => controller?.handleWorkspaceChanged(detail);
  namespace.isOpen = () => !!controller?.opened;
})(window.YanCodeMap = window.YanCodeMap || {});
