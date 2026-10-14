'use strict';

// E2E smoke: the dsh-code-review sidebar surface must render the verbatim
// upstream page inside the review tab iframe, run its inline scripts under the
// app CSP (file: document), and pipe inline-comment posts back into the Yan
// composer exactly like upstream's composerWriter.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-dsh-review-e2e-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.waitForFunction(() => (
      typeof globalThis.YanDshReview?.open === 'function'
      && globalThis.DshCodeReviewCore?.parseGitDiff != null
      && document.querySelector('#yanDshReviewMount')
    ), { timeout: 30_000 });

    await page.evaluate(() => {
      const before = 'const a = 1;\nconst b = 2;\n';
      const after = 'const a = 0;\nconst b = 2;\nconst c = 3;\n';
      const lines = [];
      lines.push('diff --git a/src/app.js b/src/app.js');
      lines.push('--- a/src/app.js');
      lines.push('+++ b/src/app.js');
      lines.push('@@ -1,2 +1,3 @@');
      lines.push('-const a = 1;');
      lines.push('+const a = 0;');
      lines.push(' const b = 2;');
      lines.push('+const c = 3;');
      void before; void after;
      window.__comparisonChoices = [];
      window.__dshReviewOpen = globalThis.YanDshReview.open({
        comparison: { currentBranch: 'codex/merge-macos', defaultBranch: 'main', branches: ['main', 'codex/merge-macos', 'origin'], mode: 'all', baseBranch: 'main' },
        onComparisonChange: selection => window.__comparisonChoices.push(selection),
        summary: {
          count: 1,
          additions: 2,
          deletions: 1,
          files: [{ path: 'src/app.js', status: 'modified', additions: 2, deletions: 1, patch: lines.join('\n') }]
        }
      });
    });
    await page.evaluate(() => window.__dshReviewOpen);

    await page.waitForFunction(() => {
      const frame = document.querySelector('#yanDshReviewFrame');
      return frame && frame.src.startsWith('file:')
        && frame.contentDocument?.querySelectorAll('.dsh-cr-grid .dsh-cr-row').length > 0;
    }, { timeout: 15_000 });

    const insideFrame = await page.evaluate(() => {
      const frame = document.querySelector('#yanDshReviewFrame');
      const doc = frame.contentDocument;
      return {
        scope: doc.querySelector('#yan-review-scope')?.textContent || '',
        hasOldStats: !!doc.querySelector('.stats'),
        fileSections: doc.querySelectorAll('main .file').length,
        styleInjected: !!doc.querySelector('style'),
        topbarButtons: [...doc.querySelectorAll('.topbar .btn')].map(button => button.textContent),
        hasSubmitComments: !!doc.querySelector('#submit-comments'),
        hasCopyRaw: !!doc.querySelector('#copy-raw'),
        hasSubmitPanel: !!doc.querySelector('#submit-panel'),
        fileAdd: doc.querySelector('.file-stats .file-add')?.textContent || '',
        fileDel: doc.querySelector('.file-stats .file-del')?.textContent || '',
        topbarButtonIds: [...doc.querySelectorAll('.topbar .btn')].map(button => button.id),
        fileStatsCount: doc.querySelectorAll('.file-stats').length,
        fileActionLabels: [...doc.querySelectorAll('.file-actions .file-action')].map(button => button.textContent.trim()),
      fileActionsHidden: getComputedStyle(doc.querySelector('.file-actions')).visibility === 'hidden',
        fileActionSvgCount: doc.querySelectorAll('.file-actions .file-action svg').length,
        codeFontFamily: getComputedStyle(doc.querySelector('.dsh-cr-cell')).fontFamily,
        filebarTitle: doc.querySelector('#yan-review-filebar')?.getAttribute('title') || '',
        hasRawWrap: !!doc.querySelector('.rawwrap'),
        fileIcon: doc.querySelector('.file-type-icon')?.dataset.fileIcon || '',
        navClickHandlerPresent: !!doc.querySelector('.navitem'),
        filebarOnLeft: getComputedStyle(doc.querySelector('.sidenav')).left === '0px' && getComputedStyle(doc.querySelector('.sidenav')).right === 'auto',
        filebarHidden: getComputedStyle(doc.querySelector('.sidenav')).display === 'none',
        pillButtons: [...doc.querySelectorAll('.yan-review-pill button')].map(button => button.id),
        hasExpandAll: !!doc.querySelector('#yan-review-expand'),
        projectOnLeft: !!doc.querySelector('.yan-review-leading #yan-review-filebar'),
        mainMarginLeft: getComputedStyle(doc.querySelector('main')).marginLeft,
        mainMarginRight: getComputedStyle(doc.querySelector('main')).marginRight,
        filebarWidth: getComputedStyle(doc.documentElement).getPropertyValue('--yan-review-filebar-width'),
        rootClass: doc.documentElement.className,
        filebarResizerPresent: !!doc.querySelector('#yan-review-filebar-resizer'),
        filebarBorderRight: getComputedStyle(doc.querySelector('.sidenav')).borderRightStyle,
        commentHoverRule: [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter(rule => rule.selectorText === '.dsh-cr-num[data-cr-line]:hover::after').at(-1)?.cssText || ''
      };
    });
    assert.equal(insideFrame.fileSections, 1);
    assert.match(insideFrame.scope, /main.*工作区/);
    assert.equal(insideFrame.hasOldStats, false);
    assert.deepEqual(insideFrame.topbarButtons.length, 4);
    assert.ok(!insideFrame.topbarButtons.includes('撤销'));
    assert.deepEqual(insideFrame.topbarButtonIds, ['yan-review-filebar', 'yan-review-search', 'yan-review-wrap', 'yan-review-refresh']);
    assert.equal(insideFrame.hasSubmitComments, false);
    assert.equal(insideFrame.hasCopyRaw, false);
    assert.equal(insideFrame.hasSubmitPanel, false);
    assert.equal(insideFrame.fileAdd, '+2');
    assert.equal(insideFrame.fileDel, '-1');
    assert.equal(insideFrame.fileStatsCount, 1);
    assert.deepEqual(insideFrame.fileActionLabels, ['', '']);
    assert.equal(insideFrame.fileActionsHidden, true);
    assert.equal(insideFrame.fileActionSvgCount, 2);
    assert.match(insideFrame.codeFontFamily, /Consolas|Cascadia|SF Mono|monospace/i);
    assert.equal(insideFrame.filebarTitle, '显示项目');
    assert.equal(insideFrame.filebarHidden, true);
    assert.equal(insideFrame.projectOnLeft, true);
    assert.equal(insideFrame.hasExpandAll, false);
    assert.deepEqual(insideFrame.pillButtons, ['yan-review-wrap', 'yan-review-refresh']);
    assert.equal(insideFrame.hasRawWrap, false);
    assert.equal(insideFrame.fileIcon, 'code-xml');
    assert.equal(insideFrame.navClickHandlerPresent, true);
    assert.equal(insideFrame.filebarOnLeft, true);
    assert.equal(insideFrame.mainMarginLeft, '0px');
    assert.equal(insideFrame.mainMarginRight, '0px');
    assert.equal(insideFrame.filebarResizerPresent, true);
    assert.equal(insideFrame.filebarBorderRight, 'solid');
    assert.match(insideFrame.commentHoverRule, /border-radius:\s*50%/);
    assert.match(insideFrame.commentHoverRule, /background:\s*var\(--dsw-alias-state-business-primary\)/);

    // 行内评论回传:按真实流程,由页面内联 JS 在 frame 内向 window.parent
    // postMessage(宿主侧 handler 校验 event.source === iframe.contentWindow)。
    // 注意主页面本身也是 file: URL,必须按临时目录路径匹配审阅 frame。
    const reviewFrame = page.frames().find(frame => frame.url().includes('yan-dsh-code-review'));
    await reviewFrame.evaluate(() => document.querySelector('#yan-review-filebar').click());
    const scopeState = await reviewFrame.evaluate(() => {
      const button = document.querySelector('#yan-review-scope');button.click();
      const all = document.querySelector('#yan-review-scope-all');
      const checked = all.getAttribute('aria-checked');
      const allLabel = all.textContent;
      document.querySelector('#yan-review-compare').click();
      const names = [...document.querySelectorAll('#yan-review-branch-list button .yan-review-option-label')].map(label => label.textContent);
      const defaultLabel = document.querySelector('#yan-review-branch-list button').textContent;
      const input = document.querySelector('#yan-review-branch-search');
      input.value = 'MERGE';input.dispatchEvent(new Event('input'));
      const filtered = document.querySelectorAll('#yan-review-branch-list button').length;
      document.querySelector('#yan-review-branch-list button').click();
      const closed = document.querySelector('#yan-review-scope-menu').hidden;
      button.click();document.querySelector('#yan-review-scope-uncommitted').click();
      const uncommitted = document.querySelector('#yan-review-scope-uncommitted').getAttribute('aria-checked');
      return { checked, allLabel, names, defaultLabel, filtered, closed, uncommitted };
    });
    assert.equal(scopeState.checked, 'true');
    assert.match(scopeState.allLabel, /全部改动.*main/);
    assert.deepEqual(scopeState.names, ['main', 'codex/merge-macos', 'origin']);
    assert.match(scopeState.defaultLabel, /默认/);
    assert.equal(scopeState.filtered, 1);
    assert.equal(scopeState.closed, true);
    assert.equal(scopeState.uncommitted, 'true');
    await page.waitForFunction(() => window.__comparisonChoices.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__comparisonChoices), [
      { mode: 'all', baseBranch: 'codex/merge-macos' },
      { mode: 'uncommitted', baseBranch: 'codex/merge-macos' }
    ]);
    const initialFilebarWidth = await reviewFrame.locator('.sidenav').evaluate(element => parseFloat(getComputedStyle(element).width));
    await reviewFrame.locator('#yan-review-filebar-resizer').dispatchEvent('pointerdown', { pointerId: 1, clientX: 100, bubbles: true });
    await reviewFrame.locator('#yan-review-filebar-resizer').dispatchEvent('pointermove', { pointerId: 1, clientX: 200, bubbles: true });
    await reviewFrame.locator('#yan-review-filebar-resizer').dispatchEvent('pointerup', { pointerId: 1, clientX: 200, bubbles: true });
    const resizedFilebarWidth = await reviewFrame.locator('.sidenav').evaluate(element => parseFloat(getComputedStyle(element).width));
    assert.ok(resizedFilebarWidth >= 0 && resizedFilebarWidth <= 520 && resizedFilebarWidth !== initialFilebarWidth, `filebar did not resize: ${initialFilebarWidth} -> ${resizedFilebarWidth}`);
    await reviewFrame.locator('#yan-review-filebar-resizer').dispatchEvent('pointerdown', { pointerId: 2, clientX: 0, bubbles: true });
    await reviewFrame.locator('#yan-review-filebar-resizer').dispatchEvent('pointerup', { pointerId: 2, clientX: 0, bubbles: true });
    const zeroFilebarWidth = await reviewFrame.locator('.sidenav').evaluate(element => parseFloat(getComputedStyle(element).width));
    assert.equal(zeroFilebarWidth, 0);
    await reviewFrame.evaluate(() => document.querySelector('#yan-review-filebar')?.click());
    const restoredFilebarState = await reviewFrame.evaluate(() => ({
      width: parseFloat(getComputedStyle(document.querySelector('.sidenav')).width),
      title: document.querySelector('#yan-review-filebar')?.getAttribute('title') || '',
      hidden: document.documentElement.classList.contains('yan-filebar-hidden'),
      zero: document.documentElement.classList.contains('yan-filebar-zero')
    }));
    assert.ok(restoredFilebarState.width > 16, `filebar did not restore after zero-width drag: ${JSON.stringify(restoredFilebarState)}`);
    assert.equal(restoredFilebarState.title, '隐藏项目');
    assert.equal(restoredFilebarState.hidden, false);
    assert.equal(restoredFilebarState.zero, false);
    await reviewFrame.evaluate(width => document.documentElement.style.setProperty('--yan-review-filebar-width', width + 'px'), initialFilebarWidth);
    const initialFileTop = await reviewFrame.locator('#file-0').evaluate(element => element.getBoundingClientRect().top);
    await reviewFrame.evaluate(() => document.querySelector('.navitem')?.click());
    const positionedFileTop = await reviewFrame.locator('#file-0').evaluate(element => element.getBoundingClientRect().top);
    const topbarHeight = await reviewFrame.locator('.topbar').evaluate(element => element.getBoundingClientRect().height);
    assert.ok(positionedFileTop >= topbarHeight - 1, `file header was covered by topbar: ${positionedFileTop} < ${topbarHeight}`);
    assert.ok(Math.abs(positionedFileTop - initialFileTop) < 2 || positionedFileTop >= topbarHeight - 1);
    await reviewFrame.evaluate(() => document.querySelector('#yan-review-wrap')?.click());
    const noWrapState = await reviewFrame.evaluate(() => ({
      hasNoWrapClass: document.documentElement.classList.contains('yan-no-wrap'),
      title: document.querySelector('#yan-review-wrap')?.getAttribute('title') || '',
      gridOverflowX: getComputedStyle(document.querySelector('.dsh-cr-grid')).overflowX,
      fileOverflowX: getComputedStyle(document.querySelector('main .file')).overflowX,
      bodyScrollbarWidth: getComputedStyle(document.body).scrollbarWidth
    }));
    assert.equal(noWrapState.hasNoWrapClass, true);
    assert.equal(noWrapState.title, '启用自动换行');
    assert.equal(noWrapState.gridOverflowX, 'auto');
    assert.equal(noWrapState.fileOverflowX, 'hidden');
    await reviewFrame.evaluate(() => document.querySelector('#yan-review-wrap')?.click());
    await reviewFrame.evaluate(() => document.querySelector('.filehead')?.click());
    const collapsedState = await reviewFrame.evaluate(() => ({
      fileCollapsed: document.querySelector('main .file')?.classList.contains('yan-file-collapsed') || false,
      gridDisplay: getComputedStyle(document.querySelector('main .file .dsh-cr-grid')).display,
    }));
    assert.deepEqual(collapsedState, { fileCollapsed: true, gridDisplay: 'none' });
    await reviewFrame.evaluate(() => document.querySelector('.filehead')?.click());
    const fileExpandedState = await reviewFrame.evaluate(() => ({
      fileCollapsed: document.querySelector('main .file')?.classList.contains('yan-file-collapsed') || false,
      buttonLabel: document.querySelector('.file-disclosure')?.textContent.trim() || '',
      buttonHasSvg: !!document.querySelector('.file-disclosure svg')
    }));
    assert.deepEqual(fileExpandedState, { fileCollapsed: false, buttonLabel: '', buttonHasSvg: true });
    await reviewFrame.evaluate(() => document.querySelector('#yan-review-filebar')?.click());
    const hiddenFilebarState = await reviewFrame.evaluate(() => ({
      hidden: document.documentElement.classList.contains('yan-filebar-hidden'),
      navDisplay: getComputedStyle(document.querySelector('.sidenav')).display,
      mainMargin: getComputedStyle(document.querySelector('main')).marginLeft,
      title: document.querySelector('#yan-review-filebar')?.getAttribute('title') || ''
    }));
    assert.equal(hiddenFilebarState.hidden, true);
    assert.equal(hiddenFilebarState.navDisplay, 'none');
    assert.equal(hiddenFilebarState.title, '显示项目');
    await reviewFrame.evaluate(() => document.querySelector('#yan-review-filebar')?.click());
    const shownFilebarState = await reviewFrame.evaluate(() => document.documentElement.classList.contains('yan-filebar-hidden'));
    assert.equal(shownFilebarState, false);
    await page.evaluate(() => {
      window.__dshReviewAddedOpen = globalThis.YanDshReview.open({
        summary: {
          count: 1,
          additions: 2,
          deletions: 0,
          files: [{ path: 'src/new.js', status: 'added', additions: 2, deletions: 0, patch: [
            'diff --git a/src/new.js b/src/new.js',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/new.js',
            '@@ -0,0 +1,2 @@',
            '+export const ready = true;',
            '+export const shipped = true;'
          ].join('\n') }]
        }
      });
    });
    await page.evaluate(() => window.__dshReviewAddedOpen);
    await page.waitForFunction(() => {
      const frame = document.querySelector('#yanDshReviewFrame');
      return frame?.contentDocument?.querySelector('.filehead.yan-file-add-only') != null;
    }, { timeout: 15_000 });
    const addedOnlyState = await page.evaluate(() => {
      const frame = document.querySelector('#yanDshReviewFrame');
      const doc = frame.contentDocument;
      const grid = doc.querySelector('.filehead.yan-file-add-only + .dsh-cr-grid');
      return {
        oldNumbers: getComputedStyle(doc.querySelector('.dsh-cr-num-old')).display,
        oldCells: getComputedStyle(doc.querySelector('.dsh-cr-cell-old')).display,
        gridColumns: getComputedStyle(grid).gridTemplateColumns,
        fileStats: doc.querySelector('.file-stats')?.textContent || ''
      };
    });
    assert.equal(addedOnlyState.oldNumbers, 'none');
    assert.equal(addedOnlyState.oldCells, 'none');
    assert.notEqual(addedOnlyState.gridColumns.split(' ').length, 4);
    assert.match(addedOnlyState.fileStats, /\+2/);
    await page.evaluate(() => {
      window.__dshReviewOriginalOpen = globalThis.YanDshReview.open({
        summary: {
          count: 1,
          additions: 2,
          deletions: 1,
          files: [{ path: 'src/app.js', status: 'modified', additions: 2, deletions: 1, patch: [
            'diff --git a/src/app.js b/src/app.js',
            '--- a/src/app.js',
            '+++ b/src/app.js',
            '@@ -1,2 +1,3 @@',
            '-const a = 1;',
            '+const a = 0;',
            ' const b = 2;',
            '+const c = 3;'
          ].join('\n') }]
        }
      });
    });
    await page.evaluate(() => window.__dshReviewOriginalOpen);
    await page.waitForFunction(() => { const doc = document.querySelector('#yanDshReviewFrame')?.contentDocument; return doc?.querySelector('.path')?.textContent === 'app.js' && doc?.querySelector('.dsh-cr-grid .dsh-cr-row') != null; }, { timeout: 15_000 });
    const reviewFrameAgain = page.frames().find(frame => frame.url().includes('yan-dsh-code-review'));
    assert.ok(reviewFrameAgain, 'review frame present after added-only check');
    await reviewFrameAgain.evaluate(() => {
      window.parent.postMessage({
        type: 'dsh-code-review-comments',
        kind: 'comment',
        comments: [{ path: 'src/app.js', lineNo: 2, text: '这里改错了' }]
      }, '*');
    });
    // composer 是 contenteditable(setComposerText 走 DOM 子节点),读 textContent。
    await page.waitForFunction(() => (
      String(document.querySelector('#composerInput')?.textContent || '').includes('src/app.js:2')
    ), { timeout: 10_000 });
    const composerValue = await page.evaluate(() => document.querySelector('#composerInput').textContent);
    assert.match(composerValue, /Code Review/);
    assert.match(composerValue, /这里改错了/);
    await page.evaluate(() => {
      const frame = document.querySelector('#yanDshReviewFrame');
      for (let node = frame; node; node = node.parentElement) {
        node.classList.remove('hidden');
        node.style.setProperty('display', 'block', 'important');
      }
      frame.style.cssText = 'display:block!important;position:fixed;inset:0;width:1800px;height:900px';
    });
    const layout = await reviewFrameAgain.evaluate(() => {
      const grid = document.querySelector('.dsh-cr-grid');
      const notice = document.createElement('div');
      notice.className = 'yan-review-notice';
      notice.textContent = '当前仅显示部分差异（最多 1200 行）；完整内容请在编辑器中查看。';
      grid.appendChild(notice);
      const folder = document.querySelector('.yan-review-folder');
      const summary = folder.querySelector('summary');
      const result = {
        span: getComputedStyle(notice).gridColumn,
        marker: getComputedStyle(summary, '::before').content,
        counts: document.querySelectorAll('.yan-review-folder-count').length,
        openIcon: getComputedStyle(summary.querySelector('.yan-folder-open')).display,
        closedIcon: getComputedStyle(summary.querySelector('.yan-folder-closed')).display
      };
      folder.open = false;
      result.collapsedIcon = getComputedStyle(summary.querySelector('.yan-folder-closed')).display;
      result.hiddenOpenIcon = getComputedStyle(summary.querySelector('.yan-folder-open')).display;
      // Isolate the live grid at a desktop width to measure its track sizes
      // even when the host review tab is hidden by the test setup.
      const probe = grid.cloneNode(true);
      probe.style.cssText = 'position:fixed;top:0;left:0;width:1600px;display:grid!important';
      document.body.appendChild(probe);
      result.gutterWidth = probe.querySelector('.dsh-cr-num-old').getBoundingClientRect().width;
      probe.remove();
      return result;
    });
    assert.equal(layout.span, '1 / -1');
    assert.ok(layout.gutterWidth > 0 && layout.gutterWidth < 80, JSON.stringify(layout));
    assert.equal(layout.counts, 0);
    assert.equal(layout.marker, 'none');
    assert.equal(layout.openIcon, 'flex');
    assert.equal(layout.closedIcon, 'none');
    assert.equal(layout.collapsedIcon, 'flex');
    assert.equal(layout.hiddenOpenIcon, 'none');
    await page.evaluate(async () => {
      const manifest = [
        { path: 'src/app.js', additions: 2, deletions: 1 },
        { path: 'renderer/theme.css', additions: 4, deletions: 0 },
        { path: 'README.md', additions: 1, deletions: 0 },
        { path: 'assets/photo.webp', additions: 0, deletions: 0 },
        { path: 'assets/demo.mp4', additions: 0, deletions: 0 },
        { path: 'LICENSE', additions: 0, deletions: 0 }
      ];
      window.__reviewLoadCalls = [];
      await YanDshReview.open({ summary: { files: manifest }, lazy: true, selectedPath: 'assets/photo.webp',
        comparison: { currentBranch: 'main', defaultBranch: 'main', branches: ['main', 'codex/merge-macos', 'origin'], baseBranch: 'main' },
        loadFile: async requested => {
          window.__reviewLoadCalls.push(requested);
          return { path: requested, status: 'modified', patch: `diff --git a/${requested} b/${requested}\n--- a/${requested}\n+++ b/${requested}\n@@ -1 +1 @@\n-old\n+new` };
        }
      });
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelectorAll('main .file').length === 6);
    const rectangularFrame = page.frames().find(frame => frame.url().includes('yan-dsh-code-review'));
    const geometry = await rectangularFrame.evaluate(() => {
      const files = [...document.querySelectorAll('main .file')];
      files.forEach(file => file.querySelector('.filehead').click());

      return {
        icons: files.map(file => file.querySelector('.file-type-icon').dataset.fileIcon),
        empty: files.slice(3).map(file => ({ collapsed: file.classList.contains('yan-file-collapsed'),
          disabled: file.querySelector('.filehead').getAttribute('aria-disabled'),
          grid: getComputedStyle(file.querySelector('.dsh-cr-grid')).display,
          triangle: getComputedStyle(file.querySelector('.file-disclosure')).visibility })),
        radii: files.map(file => getComputedStyle(file).borderRadius),
        margins: files.map(file => getComputedStyle(file).marginBottom),
        separateToggles: document.querySelectorAll('[data-toggle-file]').length,
        undo: !!document.querySelector('#yan-review-undo'),
        name: files[0].querySelector('.path').textContent,
        directory: files[0].querySelector('.file-directory').textContent
      };
    });
    assert.deepEqual(geometry.icons, ['code-xml', 'code-xml', 'file', 'image', 'square-play', 'file']);
    geometry.empty.forEach(file => assert.deepEqual(file, { collapsed: true, disabled: 'true', grid: 'none', triangle: 'hidden' }));
    assert.ok(geometry.radii.every(radius => radius === '0px'));
    assert.ok(geometry.margins.every(margin => margin === '0px'));
    assert.equal(geometry.separateToggles, 0);
    assert.equal(geometry.undo, false);
    assert.equal(geometry.name, 'app.js');
    assert.equal(geometry.directory, 'src');
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelector('#file-0 [data-cr-line]'));
    const loadedPaths = await page.evaluate(() => window.__reviewLoadCalls);
    assert.ok(!loadedPaths.some(path => /photo|demo|LICENSE/.test(path)));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      const frame = document.querySelector('#yanDshReviewFrame');
      for (let node = frame.parentElement; node; node = node.parentElement) {
        node.classList.remove('hidden');
        node.style.setProperty('display', 'block', 'important');
        node.style.setProperty('z-index', '9999', 'important');
        node.style.setProperty('position', 'static', 'important');
        node.style.setProperty('transform', 'none', 'important');
      }
      frame.style.cssText = 'display:block!important;position:fixed;inset:0;width:100%;height:100%;z-index:99999';
    });
    const searchResults = await rectangularFrame.evaluate(() => {
      document.querySelector('#yan-review-search').click();
      const input = document.querySelector('#yan-review-search-input');
      input.value = 'PHOTO';input.dispatchEvent(new Event('input'));
      const paths = [...document.querySelectorAll('main .file:not([hidden])')].map(file => file.dataset.yanPath);
      const count = document.querySelector('#yan-review-search-count').textContent;
      input.value = 'not-a-real-file';input.dispatchEvent(new Event('input'));
      const emptyVisible = !document.querySelector('#yan-review-search-empty').hidden;
      input.value = 'old';input.dispatchEvent(new Event('input'));
      const contentMatches = document.querySelectorAll('main .file:not([hidden])').length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const restored = document.querySelectorAll('main .file:not([hidden])').length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
      const shortcutOpened = !document.querySelector('#yan-review-search-panel').hidden;
      document.querySelector('#yan-review-search-close').click();
      return { paths, count, emptyVisible, contentMatches, restored, shortcutOpened };
    });
    assert.deepEqual(searchResults, { paths: ['assets/photo.webp'], count: '1 / 6', emptyVisible: true,
      contentMatches: 3, restored: 6, shortcutOpened: true });
    // Whole-row and keyboard toggles, including clicks on the display triangle.
    await rectangularFrame.locator('#file-0 .filehead').evaluate(head => head.click());
    assert.equal(await rectangularFrame.locator('#file-0').evaluate(file => file.classList.contains('yan-file-collapsed')), true);
    await rectangularFrame.locator('#file-0 .filehead').focus();
    await rectangularFrame.locator('#file-0 .filehead').press('Enter');
    assert.equal(await rectangularFrame.locator('#file-0 .filehead').getAttribute('aria-expanded'), 'true');
    await rectangularFrame.locator('#file-0 .filehead').press('Space');
    assert.equal(await rectangularFrame.locator('#file-0 .filehead').getAttribute('aria-expanded'), 'false');
    await rectangularFrame.locator('#file-0 .file-disclosure').evaluate(triangle => triangle.click());
    assert.equal(await rectangularFrame.locator('#file-0 .filehead').getAttribute('aria-expanded'), 'true');
    if (process.env.YAN_REVIEW_SCREENSHOT) {
      const url = rectangularFrame.url();
      const previewReady = application.waitForEvent('window');
      await application.evaluate(async ({ BrowserWindow }, url) => {
        const preview = new BrowserWindow({ width: 1440, height: 900, show: true });
        await preview.loadURL(url);
      }, url);
      const preview = await previewReady;
      await preview.waitForLoadState();
      await preview.waitForFunction(() => document.querySelectorAll('main .file').length === 6);
      await preview.screenshot({ path: process.env.YAN_REVIEW_SCREENSHOT });
      await preview.locator('#yan-review-scope').click();
      await preview.locator('#yan-review-compare').click();
      await preview.locator('#yan-review-branch-menu').waitFor({ state: 'visible' });
      await preview.screenshot({ path: process.env.YAN_REVIEW_SCREENSHOT.replace(/\.png$/, '-comparison.png') });
      await preview.locator('#yan-review-branch-search').press('Escape');
      await preview.locator('#yan-review-compare').press('Escape');
      await preview.locator('#yan-review-filebar').click();
      await preview.locator('.sidenav').waitFor({ state: 'visible' });
      await preview.locator('.sidenav').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      await preview.screenshot({ path: process.env.YAN_REVIEW_SCREENSHOT.replace(/\.png$/, '-project.png') });
      await preview.locator('#yan-review-search').click();
      await preview.locator('#yan-review-search-input').fill('photo');
      await preview.screenshot({ path: process.env.YAN_REVIEW_SCREENSHOT.replace(/\.png$/, '-search.png') });
      await preview.locator('#yan-review-search-close').click();
      await preview.locator('#yan-review-filebar').click();
      for (const width of [320, 375, 414, 768]) {
        await preview.setViewportSize({ width, height: 700 });
        assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
          `review toolbar should fit at ${width}px`);
        await preview.locator('#yan-review-scope').click();
        await preview.locator('#yan-review-compare').click();
        const popupFits = await preview.locator('#yan-review-branch-menu').evaluate(element => {
          const rect = element.getBoundingClientRect();return rect.left >= 0 && rect.right <= innerWidth;
        });
        assert.equal(popupFits, true, `comparison popup should fit at ${width}px`);
        await preview.locator('#yan-review-branch-search').press('Escape');
        await preview.locator('#yan-review-compare').press('Escape');

      }


    }
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, insideFrame }));
  } finally {
    await application?.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }); } catch { /* Chromium can hold the isolated profile briefly on Windows. */ }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
