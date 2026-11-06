'use strict';
// Regression: the image preview must not block the composer. While an image is
// open the preview yields the bottom of the window to the live composer, keeps
// the zoom bar above it, and lets the user type without closing the preview.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-preview-composer-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');
const firstPng = path.join(profile, 'preview-composer-1.png');
const secondPng = path.join(profile, 'preview-composer-2.png');
fs.mkdirSync(evidenceDir, { recursive: true });

const readLayout = page => page.evaluate(() => {
  const rect = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
  };
  const overlay = document.querySelector('.image-overlay');
  const composerWrap = document.querySelector('#composerStage .composer-wrap');
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    overlay: rect('.image-overlay'),
    overlayOpen: overlay?.open === true,
    overlayModal: overlay?.matches(':modal') === true,
    overlayInsideLayout: !!overlay?.closest('.layout'),
    bodyFlag: document.body.classList.contains('image-preview-open'),
    stage: rect('.image-overlay-stage'),
    image: rect('.image-overlay-image'),
    imageNatural: (() => {
      const image = document.querySelector('.image-overlay-image');
      return image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
    })(),
    zoom: rect('.image-overlay-zoom'),
    zoomLabel: document.querySelector('.image-overlay-zoom-label')?.textContent?.trim() || '',
    bar: rect('.image-overlay-bar'),
    titleText: document.querySelector('.image-overlay-title-text')?.textContent?.trim() || '',
    toolCount: document.querySelectorAll('.image-overlay-tools button').length,
    windowControlCount: document.querySelectorAll('.image-overlay-window-controls button').length,
    firstWindowControl: rect('.image-overlay-window-controls button'),
    menuVisible: document.querySelector('.image-overlay-menu')?.hidden === false,
    composer: rect('#composerStage .composer-wrap'),
    composerStagePosition: getComputedStyle(document.querySelector('#composerStage')).position,
    composerCenter: (() => {
      const box = document.querySelector('#composerStage .composer-wrap')?.getBoundingClientRect();
      return box ? box.left + box.width / 2 : null;
    })(),
    viewportCenter: window.innerWidth / 2,
    hiddenPanels: Object.fromEntries(['todoProgressHost', 'composerUsageWrap', 'browserFocusConversationDock']
      .map(id => {
        const node = document.getElementById(id);
        return [id, !node || getComputedStyle(node).display === 'none'];
      })),
    composerZ: composerWrap ? Number(getComputedStyle(composerWrap).zIndex) || 0 : 0,
    overlayZ: overlay ? Number(getComputedStyle(overlay).zIndex) || 0 : 0,
    inset: overlay ? getComputedStyle(overlay).getPropertyValue('--preview-composer-inset').trim() : '',
    activeInsideComposer: !!document.activeElement?.closest?.('#composerStage'),
    navVisible: document.querySelector('.image-overlay-nav')?.hidden === false,
    prevDisabled: document.querySelector('.image-overlay [data-action="prev"]')?.disabled === true,
    nextDisabled: document.querySelector('.image-overlay [data-action="next"]')?.disabled === true,
    counterCount: document.querySelectorAll('.image-overlay-counter').length,
    stageScrollbar: getComputedStyle(document.querySelector('.image-overlay-stage')).scrollbarWidth,
    stageGutter: (() => {
      const stage = document.querySelector('.image-overlay-stage');
      return stage ? stage.offsetWidth - stage.clientWidth : -1;
    })()
  };
});

(async () => {
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }
    });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      window.__YAN_APP_READY__ && typeof appendMessage === 'function' && typeof setEmptyState === 'function'
    ));
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { document.querySelector('#app').inert = false; });

    // Two large, real images so the preview's fit-to-stage behaviour and the
    // composer hand-off are both visible in the evidence screenshot.
    const pngs = await page.evaluate(() => {
      const draw = (width, height, from, to) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255, 255, 255, .82)';
        ctx.beginPath();
        ctx.arc(width * .5, height * .45, Math.min(width, height) * .22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(20, 20, 24, .78)';
        ctx.font = `600 ${Math.round(width / 18)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('Yan preview', width / 2, height * .48);
        return canvas.toDataURL('image/png');
      };
      return [draw(1400, 900, '#1d4ed8', '#7c3aed'), draw(1200, 1200, '#0f766e', '#f59e0b')];
    });
    pngs.forEach((dataUrl, index) => {
      fs.writeFileSync(index === 0 ? firstPng : secondPng, Buffer.from(dataUrl.split(',')[1], 'base64'));
    });

    await page.evaluate(async ({ firstPng, secondPng }) => {
      if (!state.currentSession) await newSession();
      appendMessage('user', '预览时继续输入', [
        { name: 'preview-composer-1.png', path: firstPng, size: 68, kind: 'image', mimeType: 'image/png' },
        { name: 'preview-composer-2.png', path: secondPng, size: 68, kind: 'image', mimeType: 'image/png' }
      ]);
      setEmptyState(false);
    }, { firstPng, secondPng });

    // Make the auxiliary strips visible first so the preview can be proven to
    // hide them rather than relying on their default state.
    await page.evaluate(() => {
      document.querySelector('#todoProgressHost')?.classList.remove('hidden');
      document.querySelector('#composerUsageWrap')?.classList.remove('hidden');
    });

    await page.locator('.msg-attachment.image.is-previewable').first().click();
    await page.waitForFunction(() => {
      const image = document.querySelector('.image-overlay-image');
      return !!image && image.hidden === false && image.naturalWidth > 0;
    }, null, { timeout: 15000 });

    const layout = await readLayout(page);
    assert.equal(layout.overlayOpen, true);
    assert.equal(layout.overlayModal, false, 'preview must not be a modal dialog');
    assert.equal(layout.overlayInsideLayout, true, 'preview must share the app layout layer');
    assert.equal(layout.bodyFlag, true, 'preview open flag is set');
    assert.ok(layout.composer, 'composer must exist');
    assert.ok(layout.composer.height > 0, 'composer must stay visible');
    assert.ok(layout.composerZ > layout.overlayZ, `composer ${layout.composerZ} must sit above preview ${layout.overlayZ}`);
    assert.equal(layout.composerStagePosition, 'fixed', 'preview composer must be lifted out of the chat column');
    assert.ok(Math.abs(layout.composerCenter - layout.viewportCenter) <= 1, `composer center ${layout.composerCenter} must match window center ${layout.viewportCenter}`);
    for (const [id, hidden] of Object.entries(layout.hiddenPanels)) {
      assert.equal(hidden, true, `preview must hide #${id}`);
    }
    assert.ok(parseInt(layout.inset, 10) >= Math.round(layout.composer.height), `preview must reserve composer height (${layout.inset} vs ${layout.composer.height})`);
    assert.ok(layout.stage.bottom <= layout.composer.top + 1, `image stage (${layout.stage.bottom}) must end above composer (${layout.composer.top})`);
    assert.equal(layout.counterCount, 0, 'the image counter must be removed');
    assert.equal(layout.stageScrollbar, 'none', 'image stage must not show scrollbars');
    assert.equal(layout.stageGutter, 0, 'image stage must not reserve scrollbar space');
    assert.ok(layout.image.top >= layout.stage.top - 1, 'image must start inside the stage');
    assert.ok(layout.image.height < layout.imageNatural.height, 'large image must be scaled down to the shrunken stage');
    assert.ok(layout.image.bottom <= layout.stage.bottom + 1, 'image must fit above the composer');
    // The preview owns the true top edge of the window: toolbar, actions and
    // the window controls all live in that one row.
    assert.equal(layout.bar.top, 0, 'preview toolbar must start at the window top');
    assert.ok(layout.bar.height >= 48, 'preview toolbar must be a full bar');
    assert.equal(layout.titleText, '图像');
    assert.equal(layout.toolCount, 5, 'annotation toolbar must expose the five image tools');
    assert.equal(layout.windowControlCount, 3, 'window controls must live in the same layer');
    assert.ok(layout.firstWindowControl.top < layout.bar.bottom, 'window controls must sit inside the top bar');
    assert.ok(layout.zoom.top >= layout.bar.top && layout.zoom.bottom <= layout.bar.bottom, 'zoom pill must sit in the top bar');
    assert.match(layout.zoomLabel, /^\d+%$/);
    assert.equal(await page.locator('.image-overlay [data-action="panel"]').isVisible(), true);
    assert.equal(await page.locator('.image-overlay [data-action="download"]').isVisible(), true);
    assert.equal(await page.locator('.image-overlay-zoom').isVisible(), true);
    assert.equal(await page.locator('.image-overlay-actions').count(), 0, 'old floating action row must be gone');

    // Typing directly into the composer keeps the preview open.
    const input = page.locator('#composerInput');
    await input.click();
    await input.fill('继续输入也不打断预览');
    const typed = await input.evaluate(element => element.innerText.trim());
    assert.equal(typed, '继续输入也不打断预览');
    assert.equal((await readLayout(page)).overlayOpen, true, 'typing must not close the preview');

    // Arrow keys inside the composer move the caret instead of paging the gallery.
    const before = await readLayout(page);
    assert.equal(before.navVisible, true);
    assert.equal(before.prevDisabled, true);
    assert.equal(before.nextDisabled, false);
    await page.keyboard.press('ArrowRight');
    const afterComposerArrow = await readLayout(page);
    assert.equal(afterComposerArrow.prevDisabled, true, 'composer ArrowRight must not switch images');
    assert.equal(afterComposerArrow.navVisible, true);

    // Outside the composer the same key still pages the gallery.
    await page.locator('.image-overlay [data-action="close"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.image-overlay-image')?.alt.includes('preview-composer-2.png'));
    assert.equal((await readLayout(page)).prevDisabled, false);

    // The zoom pill replaces the old bottom controls with a menu.
    await page.locator('.image-overlay [data-action="zoom"]').click();
    await page.waitForFunction(() => !document.querySelector('.image-overlay-menu').hidden);
    assert.equal(await page.locator('.image-overlay-menu [data-zoom]').count(), 6);
    await page.locator('.image-overlay-menu [data-zoom="0.5"]').click();
    await page.waitForFunction(() => document.querySelector('.image-overlay-zoom-label')?.textContent.trim() === '50%');
    await page.locator('.image-overlay [data-action="zoom"]').click();
    await page.locator('.image-overlay-menu [data-zoom="fit"]').click();
    await page.waitForFunction(() => document.querySelector('.image-overlay-zoom-label')?.textContent.trim() !== '50%');
    assert.equal((await readLayout(page)).menuVisible, false);

    await page.screenshot({ path: path.join(evidenceDir, 'image-preview-composer.png') });

    // Escape closes the preview from the composer and keeps the draft.
    await input.click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.image-overlay').open);
    const after = await readLayout(page);
    assert.equal(after.bodyFlag, false, 'preview flag is cleared on close');
    assert.equal(await input.evaluate(element => element.innerText.trim()), '继续输入也不打断预览');

    // The empty task screen keeps the same composer hand-off.
    await page.evaluate(() => setEmptyState(true));
    await page.evaluate(filePath => window.yanImageOverlay.open({ filePath, name: 'preview-composer-1.png' }), firstPng);
    await page.waitForFunction(() => document.querySelector('.image-overlay-image')?.naturalWidth > 0);
    const emptyLayout = await readLayout(page);
    assert.ok(emptyLayout.composer.height > 0, 'empty-state composer must stay visible');
    assert.ok(emptyLayout.composerZ > emptyLayout.overlayZ, 'empty-state composer must sit above the preview');
    assert.ok(emptyLayout.stage.bottom <= emptyLayout.composer.top + 1, 'empty-state stage must end above the composer');

    // The text snapshot panel yields to the same composer inset.
    await page.evaluate(filePath => window.yanImageOverlay.open({
      filePath,
      name: 'preview-composer-1.png',
      snapshot: { text: '快照文本仍然可读' }
    }), firstPng);
    await page.waitForFunction(() => document.querySelector('.image-overlay [data-action="text"]')?.hidden === false);
    await page.locator('.image-overlay [data-action="text"]').click();
    await page.waitForFunction(() => document.querySelector('.image-overlay-text')?.hidden === false);
    assert.equal(await page.locator('.image-overlay-zoom').isVisible(), false, 'zoom pill must hide in text mode');
    assert.equal(await page.locator('.image-overlay-tools').isVisible(), false, 'annotation tools must hide in text mode');
    assert.equal(await page.locator('.image-overlay-stage').isVisible(), false);
    const textPanel = await page.evaluate(() => {
      const panel = document.querySelector('.image-overlay-text').getBoundingClientRect();
      const composer = document.querySelector('#composerStage .composer-wrap').getBoundingClientRect();
      return { panelBottom: panel.bottom, composerTop: composer.top, text: document.querySelector('.image-overlay-text pre').innerText };
    });
    assert.ok(textPanel.panelBottom <= textPanel.composerTop + 1, 'text panel must stay above the composer');
    assert.match(textPanel.text, /快照文本仍然可读/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.image-overlay').open);

    // Attachment cards live at the top of the input, use review type icons and
    // special folder/archive artwork, and reserve about four lines of space.
    await page.evaluate(({ firstPng, profile }) => {
      const join = name => `${profile}\\${name}`;
      state.attachments = [
        { name: 'preview-composer-1.png', path: firstPng, size: 68, kind: 'image', mimeType: 'image/png' },
        { name: 'app.js', path: join('app.js'), size: 68, kind: 'file', mimeType: 'text/javascript' },
        { name: 'src', path: join('src'), size: 0, kind: 'directory' },
        { name: 'bundle.zip', path: join('bundle.zip'), size: 68, kind: 'file', mimeType: 'application/zip' }
      ];
      renderAttachments();
      updateSendState();
    }, { firstPng, profile });
    await page.waitForFunction(() => document.querySelector('#composer')?.getBoundingClientRect().height > 150);
    const cards = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#attachments .attachment-chip')];
      return {
        count: cards.length,
        cards: cards.map(card => ({
          inComposer: !!card.closest('#composer'),
          kind: card.dataset.kind,
          hasTop: !!card.querySelector('.attachment-card-art svg'),
          hasFoot: !!card.querySelector('.attachment-card-foot .attachment-card-type svg'),
          hasThumb: !!card.querySelector('.attachment-card-thumb'),
          thumbSrc: card.querySelector('.attachment-card-thumb')?.getAttribute('src') || '',
          topPath: card.querySelector('.attachment-card-art svg path')?.getAttribute('d') || '',
          footPath: card.querySelector('.attachment-card-type svg path')?.getAttribute('d') || ''
        })),
        tray: (() => {
          const box = document.querySelector('#attachments').getBoundingClientRect();
          const composer = document.querySelector('#composer').getBoundingClientRect();
          const input = document.querySelector('#composerInput').getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: box.height, composerTop: composer.top, composerHeight: composer.height, inputTop: input.top, lineHeight: parseFloat(getComputedStyle(document.querySelector('#composerInput')).lineHeight) };
        })()
      };
    });
    assert.equal(cards.count, 4);
    assert.ok(cards.cards.every(card => card.inComposer && card.hasTop), 'attachment cards must sit inside the composer');
    assert.ok(cards.cards.filter(card => card.kind !== 'image').every(card => card.hasFoot), 'file cards must keep the footer type icon');
    const imageCard = cards.cards.find(card => card.kind === 'image');
    assert.ok(imageCard?.hasThumb, 'image cards must render the actual image');
    assert.equal(imageCard?.hasFoot, false, 'image cards must not show the footer');
    assert.ok(imageCard?.thumbSrc.startsWith('file://'), 'image cards must use a local file thumbnail');
    assert.ok(cards.cards.find(card => card.kind === 'folder')?.topPath.includes('M6 15L7.4472'), 'folder must use folder-open');
    assert.ok(cards.cards.find(card => card.kind === 'archive')?.topPath.includes('M3 7C3 5.3431'), 'archive must use folder-zip');
    assert.ok(cards.cards.find(card => card.kind === 'code')?.footPath.includes('M6 7L2 12'), 'code files must use the review code icon');
    await page.waitForFunction(() => document.querySelector('.attachment-card-thumb')?.naturalWidth > 0);
    assert.ok(cards.tray.top >= cards.tray.composerTop && cards.tray.top - cards.tray.composerTop < 20, 'attachment tray must start at the composer top');
    assert.ok(cards.tray.inputTop >= cards.tray.bottom - 1, 'text input must start below the attachment tray');
    assert.ok(cards.tray.height / cards.tray.lineHeight >= 4, 'attachment tray must reserve at least four lines');
    assert.ok(cards.tray.composerHeight > 150, 'composer must grow to fit the attachment tray');
    await page.locator('#composer').screenshot({ path: path.join(evidenceDir, 'attachment-cards.png') });

    // Overflow stays on one row, hides the scrollbar, fades both edges and pans
    // with press-and-drag instead of opening the card preview.
    await page.evaluate(({ firstPng }) => {
      state.attachments = Array.from({ length: 12 }, (_, index) => ({
        name: `image-${index + 1}.png`, path: firstPng, size: 68, kind: 'image', mimeType: 'image/png'
      }));
      renderAttachments();
      updateSendState();
    }, { firstPng });
    await page.waitForFunction(() => {
      const tray = document.querySelector('#attachments');
      return tray && tray.scrollWidth > tray.clientWidth + 1 && tray.dataset.scroll === 'start';
    });
    const overflow = await page.evaluate(() => {
      const tray = document.querySelector('#attachments');
      const style = getComputedStyle(tray);
      return { scrollWidth: tray.scrollWidth, clientWidth: tray.clientWidth, scrollbarWidth: style.scrollbarWidth, mask: style.maskImage || style.webkitMaskImage };
    });
    assert.ok(overflow.scrollWidth > overflow.clientWidth, 'overflowing attachments must stay on one horizontal row');
    assert.equal(overflow.scrollbarWidth, 'none', 'attachment tray must hide its scrollbar');
    assert.match(overflow.mask, /gradient/, 'attachment tray must fade its overflowing edge');
    const trayBox = await page.locator('#attachments').boundingBox();
    await page.mouse.move(trayBox.x + trayBox.width - 60, trayBox.y + 40);
    await page.mouse.down();
    await page.mouse.move(trayBox.x + trayBox.width - 260, trayBox.y + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const dragged = await page.evaluate(() => {
      const tray = document.querySelector('#attachments');
      return { left: tray.scrollLeft, state: tray.dataset.scroll, overlay: document.querySelector('.image-overlay')?.open === true };
    });
    assert.ok(dragged.left > 0, 'press-and-drag must pan the attachment tray');
    assert.notEqual(dragged.state, 'start', 'tray must report a scrolled mask state');
    assert.equal(dragged.overlay, false, 'panning must not open a preview');
    await page.locator('#composer').screenshot({ path: path.join(evidenceDir, 'attachment-tray-overflow.png') });
    await page.evaluate(() => { state.attachments = []; renderAttachments(); updateSendState(); });

    // Removing the visible attachment closes its preview; removing a sibling
    // only refreshes the gallery.
    await page.evaluate(({ firstPng, secondPng }) => {
      state.attachments = [
        { name: 'preview-composer-1.png', path: firstPng, size: 68, kind: 'image', mimeType: 'image/png' },
        { name: 'preview-composer-2.png', path: secondPng, size: 68, kind: 'image', mimeType: 'image/png' }
      ];
      renderAttachments();
      updateSendState();
    }, { firstPng, secondPng });
    await page.locator('.attachment-chip.image.is-previewable').first().click();
    await page.waitForFunction(() => (
      document.querySelector('.image-overlay')?.open
      && document.querySelector('.image-overlay-nav')?.hidden === false
      && document.querySelector('.image-overlay [data-action="prev"]')?.disabled === true
      && document.querySelector('.image-overlay [data-action="next"]')?.disabled === false
    ));
    await page.screenshot({ path: path.join(evidenceDir, 'image-preview-attachments.png') });
    await page.locator('.attachment-chip .remove').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.image-overlay')?.open);
    assert.equal(await page.locator('.image-overlay-nav').isVisible(), false, 'sibling removal must collapse the gallery nav');
    await page.locator('.attachment-chip .remove').first().click();
    await page.waitForFunction(() => !document.querySelector('.image-overlay')?.open);
    assert.equal(await page.evaluate(() => state.attachments.length), 0);

    // The annotation toolbar hands off to the side-panel image editor and lands
    // directly in the requested tool.
    await page.evaluate(filePath => window.yanImageOverlay.open({ filePath, name: 'preview-composer-1.png' }), firstPng);
    await page.waitForFunction(() => document.querySelector('.image-overlay-image')?.naturalWidth > 0);
    await page.locator('.image-overlay [data-action="annotate"]').click();
    await page.waitForFunction(() => !document.querySelector('.image-overlay').open);
    await page.waitForFunction(() => (
      document.querySelector('#rs-image-editor')?.classList.contains('is-annotating')
      && document.querySelector('.image-editor-image')?.naturalWidth > 0
    ), null, { timeout: 15000 });

    // The Agent tab moves chat into the right sidebar; opening an attachment
    // there must still keep the composer above the preview.
    await page.evaluate(() => {
      const host = document.querySelector('#rs-agent-chat');
      host.hidden = false;
      if (!host.contains(document.querySelector('#chatMainColumn'))) host.append(document.querySelector('#chatMainColumn'));
      const app = document.querySelector('#app');
      app.classList.add('full-agent-chat', 'browser-focus-mode');
      app.dataset.browserFocusComposer = 'expanded';
      document.querySelector('#pageChat').classList.remove('empty');
    });
    await page.evaluate(filePath => window.yanImageOverlay.open({ filePath, name: 'preview-composer-1.png' }), firstPng);
    await page.waitForFunction(() => document.querySelector('.image-overlay-image')?.naturalWidth > 0);
    const fullscreenComposer = await readLayout(page);
    assert.ok(fullscreenComposer.composer?.height > 0, 'fullscreen Agent tab must retain the composer');
    assert.ok(fullscreenComposer.composerZ > fullscreenComposer.overlayZ, 'fullscreen composer must remain above the preview');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.image-overlay').open);

    // The Nested Sessions question button must open the restored explanation.
    await page.evaluate(() => openSettings('nested-sessions'));
    await page.locator('.nested-question-btn').click();
    const aboutDialog = page.locator('#nestedSessionsAboutDialog');
    await aboutDialog.waitFor({ state: 'visible' });
    assert.match(await aboutDialog.innerText(), /嵌套会话允许Yan Agent派发子会话并行推进你的工作/);
    assert.equal(await aboutDialog.locator('[data-keyline-icon="shuffle"]').count(), 1);
    assert.equal(await aboutDialog.locator('#nestedSessionsAboutClose').count(), 0);
    await page.locator('#nestedAboutNext').click();
    assert.equal(await page.locator('#nestedAboutWorktrees').isVisible(), true);
    assert.match(await aboutDialog.innerText(), /工作树隔离，你无需担心你的项目受损/);
    await page.locator('#nestedAboutPrevious').click();
    assert.equal(await page.locator('#nestedAboutBrand').isVisible(), true);
    await page.locator('#nestedAboutNext').click();
    await page.screenshot({ path: path.join(evidenceDir, 'nested-sessions-about-integrated.png') });
    await page.locator('#nestedAboutNext').click();
    await page.waitForFunction(() => !document.querySelector('#nestedSessionsAboutDialog').open);
    await page.locator('.nested-question-btn').click();
    assert.equal(await page.locator('#nestedAboutBrand').isVisible(), true, 'reopen must reset to page one');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#nestedSessionsAboutDialog').open);

    assert.deepEqual(errors, []);
    console.log('image-preview-composer: ok');
  } finally {
    await app?.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
