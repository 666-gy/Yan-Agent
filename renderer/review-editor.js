'use strict';

(() => {
  const MONACO_VS_PATH = '../node_modules/monaco-editor/min/vs';
  const THEME_DARK = 'yan-review-dark';
  const THEME_LIGHT = 'yan-review-light';
  let loadPromise = null;
  let themesRegistered = false;
  let activeTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  let modelSequence = 0;
  let editorSequence = 0;

  function defineThemes(monaco) {
    if (themesRegistered) return;
    themesRegistered = true;
    monaco.editor.defineTheme(THEME_DARK, {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#18191a',
        'editor.foreground': '#b4b8bc',
        'editorLineNumber.foreground': '#666c71',
        'editorLineNumber.activeForeground': '#b7bcc0',
        'editorGutter.background': '#18191a',
        'editor.selectionBackground': '#3d547080',
        'editor.inactiveSelectionBackground': '#35485d66',
        'editorCursor.foreground': '#a4b9df',
        'editorWhitespace.foreground': '#333638',
        'editorIndentGuide.background1': '#2d3032',
        'editorIndentGuide.activeBackground1': '#494d50',
        'editorOverviewRuler.border': '#00000000',
        'editorWidget.background': '#232526',
        'editorWidget.border': '#424649',
        'editorHoverWidget.background': '#232526',
        'editorHoverWidget.border': '#424649',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#747a8040',
        'scrollbarSlider.hoverBackground': '#858c935e',
        'scrollbarSlider.activeBackground': '#979ea66e',
        'diffEditor.border': '#424649',
        'diffEditor.diagonalFill': '#2a2c2e',
        'diffEditor.insertedLineBackground': '#65be9321',
        'diffEditor.removedLineBackground': '#db7d7721',
        'diffEditor.insertedTextBackground': '#65be9338',
        'diffEditor.removedTextBackground': '#db7d7738',
        'diffEditorGutter.insertedLineBackground': '#65be9338',
        'diffEditorGutter.removedLineBackground': '#db7d7738',
        'diffEditorOverview.insertedForeground': '#79c6a3a8',
        'diffEditorOverview.removedForeground': '#df918da8',
        'diffEditor.unchangedRegionBackground': '#232526',
        'diffEditor.unchangedRegionForeground': '#8a9095',
        'diffEditor.unchangedCodeBackground': '#1b1c1d'
      }
    });
    monaco.editor.defineTheme(THEME_LIGHT, {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#fbfbfa',
        'editor.foreground': '#4f5652',
        'editorLineNumber.foreground': '#98a19b',
        'editorLineNumber.activeForeground': '#525b56',
        'editorGutter.background': '#fbfbfa',
        'editor.selectionBackground': '#bfd3ec8a',
        'editor.inactiveSelectionBackground': '#ceddeb66',
        'editorCursor.foreground': '#386a9f',
        'editorWhitespace.foreground': '#e1e4e1',
        'editorIndentGuide.background1': '#e1e4e1',
        'editorIndentGuide.activeBackground1': '#c2c8c3',
        'editorOverviewRuler.border': '#00000000',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#cbd1cc',
        'editorHoverWidget.background': '#ffffff',
        'editorHoverWidget.border': '#cbd1cc',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#7d88812e',
        'scrollbarSlider.hoverBackground': '#6d797245',
        'scrollbarSlider.activeBackground': '#606b6557',
        'diffEditor.border': '#cbd1cc',
        'diffEditor.diagonalFill': '#e7e9e7',
        'diffEditor.insertedLineBackground': '#2a875e1b',
        'diffEditor.removedLineBackground': '#be5e5a1b',
        'diffEditor.insertedTextBackground': '#2a875e2c',
        'diffEditor.removedTextBackground': '#be5e5a2c',
        'diffEditorGutter.insertedLineBackground': '#2a875e2c',
        'diffEditorGutter.removedLineBackground': '#be5e5a2c',
        'diffEditorOverview.insertedForeground': '#287d5aaa',
        'diffEditorOverview.removedForeground': '#bb5d5aaa',
        'diffEditor.unchangedRegionBackground': '#f0f2f0',
        'diffEditor.unchangedRegionForeground': '#65706a',
        'diffEditor.unchangedCodeBackground': '#f6f7f5'
      }
    });
  }

  function loadMonaco() {
    if (globalThis.monaco?.editor) return Promise.resolve(globalThis.monaco);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const amdRequire = globalThis.require;
      if (typeof amdRequire !== 'function' || typeof amdRequire.config !== 'function') {
        reject(new Error('Monaco AMD loader is unavailable.'));
        return;
      }
      amdRequire.config({ paths: { vs: MONACO_VS_PATH } });
      amdRequire(['vs/editor/editor.main'], () => {
        const monaco = globalThis.monaco;
        if (!monaco?.editor) {
          reject(new Error('Monaco editor failed to initialize.'));
          return;
        }
        defineThemes(monaco);
        monaco.editor.setTheme(activeTheme === 'light' ? THEME_LIGHT : THEME_DARK);
        resolve(monaco);
      }, reject);
    });
    return loadPromise;
  }

  function languageForPath(filePath) {
    const extension = String(filePath || '').split('.').pop()?.toLowerCase() || '';
    return {
      js: 'javascript', cjs: 'javascript', mjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
      html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
      json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown',
      yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml',
      py: 'python', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin',
      c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
      cs: 'csharp', go: 'go', rs: 'rust', swift: 'swift', sql: 'sql',
      sh: 'shell', bash: 'shell', ps1: 'powershell', bat: 'bat', cmd: 'bat',
      ini: 'ini', toml: 'ini', dockerfile: 'dockerfile', vue: 'html', svelte: 'html'
    }[extension] || (String(filePath || '').toLowerCase().endsWith('dockerfile') ? 'dockerfile' : 'plaintext');
  }

  function modelUri(monaco, role, filePath) {
    const fileName = String(filePath || 'review.txt').replace(/\\/g, '/').split('/').pop() || 'review.txt';
    modelSequence += 1;
    return monaco.Uri.from({
      scheme: 'inmemory',
      authority: 'yan-review',
      path: `/${modelSequence}/${role}/${fileName}`
    });
  }

  class ReviewDiffEditor {
    constructor(container) {
      this.container = container;
      this.editor = null;
      this.originalModel = null;
      this.modifiedModel = null;
      this.disposables = [];
      this.originalDecorations = [];
      this.modifiedDecorations = [];
      this.onLineComment = null;
      this.instanceId = ++editorSequence;
      this.disposed = false;
    }

    bindLineComments(monaco) {
      const sources = [
        ['original', this.editor.getOriginalEditor()],
        ['modified', this.editor.getModifiedEditor()]
      ];
      for (const [side, editor] of sources) {
        this.disposables.push(editor.addAction({
          id: `yan-review-comment-${this.instanceId}-${side}`,
          label: '添加行内评论',
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 1,
          run: target => {
            const lineNumber = target.getPosition()?.lineNumber;
            if (lineNumber) this.onLineComment?.({ side, lineNumber });
          }
        }));
        this.disposables.push(editor.onMouseDown(event => {
          if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
          const lineNumber = event.target.position?.lineNumber;
          if (lineNumber) this.onLineComment?.({ side, lineNumber });
        }));
      }
    }

    renderCommentDecorations(monaco, comments) {
      const original = [];
      const modified = [];
      for (const note of Array.isArray(comments) ? comments : []) {
        const key = String(note?.key || '');
        const lineNumber = Number(key.slice(1));
        if (!lineNumber) continue;
        const decoration = {
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName: 'review-monaco-note-glyph',
            linesDecorationsClassName: 'review-monaco-note-line',
            glyphMarginHoverMessage: { value: String(note.text || '行内评论') }
          }
        };
        (key.startsWith('o') ? original : modified).push(decoration);
      }
      const originalEditor = this.editor.getOriginalEditor();
      const modifiedEditor = this.editor.getModifiedEditor();
      this.originalDecorations = originalEditor.deltaDecorations(this.originalDecorations, original);
      this.modifiedDecorations = modifiedEditor.deltaDecorations(this.modifiedDecorations, modified);
    }

    disposeModels() {
      this.editor?.setModel(null);
      this.originalDecorations = [];
      this.modifiedDecorations = [];
      this.originalModel?.dispose();
      this.modifiedModel?.dispose();
      this.originalModel = null;
      this.modifiedModel = null;
    }

    async render({ path = 'review.txt', original = '', modified = '', comments = [], onLineComment = null } = {}) {
      this.container.dataset.state = 'loading';
      const monaco = await loadMonaco();
      if (this.disposed || !this.container.isConnected) return;
      if (!this.editor) {
        this.editor = monaco.editor.createDiffEditor(this.container, {
          ariaLabel: '文件差异审阅编辑器',
          automaticLayout: true,
          readOnly: true,
          domReadOnly: true,
          originalEditable: false,
          renderSideBySide: true,
          useInlineViewWhenSpaceIsLimited: true,
          enableSplitViewResizing: true,
          renderIndicators: true,
          renderMarginRevertIcon: false,
          diffAlgorithm: 'advanced',
          maxComputationTime: 5000,
          ignoreTrimWhitespace: false,
          hideUnchangedRegions: {
            enabled: true,
            revealLineCount: 5,
            minimumLineCount: 4,
            contextLineCount: 3
          },
          fontFamily: '"Cascadia Mono", "Cascadia Code", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
          fontSize: 12,
          fontWeight: '430',
          lineHeight: 20,
          letterSpacing: 0,
          lineNumbersMinChars: 3,
          glyphMargin: true,
          folding: false,
          lineDecorationsWidth: 12,
          minimap: { enabled: false },
          stickyScroll: { enabled: false },
          guides: { indentation: false, bracketPairs: false },
          bracketPairColorization: { enabled: true },
          renderWhitespace: 'selection',
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          links: false,
          contextmenu: true,
          overviewRulerBorder: false,
          padding: { top: 8, bottom: 14 },
          wordWrap: 'off',
          scrollbar: {
            horizontalScrollbarSize: 10,
            verticalScrollbarSize: 10,
            useShadows: false,
            alwaysConsumeMouseWheel: false
          }
        });
        this.bindLineComments(monaco);
      }
      this.onLineComment = typeof onLineComment === 'function' ? onLineComment : null;
      this.disposeModels();
      const language = languageForPath(path);
      this.originalModel = monaco.editor.createModel(String(original ?? ''), language, modelUri(monaco, 'original', path));
      this.modifiedModel = monaco.editor.createModel(String(modified ?? ''), language, modelUri(monaco, 'modified', path));
      this.editor.setModel({ original: this.originalModel, modified: this.modifiedModel });
      this.editor.updateOptions({ originalAriaLabel: `${path} 修改前`, modifiedAriaLabel: `${path} 修改后` });
      this.renderCommentDecorations(monaco, comments);
      this.editor.layout();
      this.editor.revealFirstDiff?.();
      this.container.dataset.state = 'ready';
      this.container.dataset.language = language;
    }

    layout() {
      this.editor?.layout();
    }

    dispose() {
      this.disposed = true;
      this.disposables.splice(0).forEach(disposable => disposable?.dispose?.());
      this.disposeModels();
      this.editor?.dispose();
      this.editor = null;
      this.container.removeAttribute('data-state');
    }
  }

  globalThis.YanReviewEditor = Object.freeze({
    create: container => new ReviewDiffEditor(container),
    load: loadMonaco,
    setTheme(theme) {
      activeTheme = theme === 'light' ? 'light' : 'dark';
      if (globalThis.monaco?.editor) {
        defineThemes(globalThis.monaco);
        globalThis.monaco.editor.setTheme(activeTheme === 'light' ? THEME_LIGHT : THEME_DARK);
      }
    }
  });
})();
