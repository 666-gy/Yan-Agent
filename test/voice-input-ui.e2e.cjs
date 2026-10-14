'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-voice-ui-'));
// Existing config takes the skill migration path that a clean first launch skips.
fs.mkdirSync(path.join(userData, 'YanData'), { recursive: true });
fs.writeFileSync(path.join(userData, 'YanData/config.json'), JSON.stringify({ voice: { enabled: false, language: 'auto', downloadSource: 'auto' } }));
const output = path.join(root, 'output/playwright/voice');
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.setViewportSize({ width: 1440, height: 1000 });
    fs.mkdirSync(output, { recursive: true });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-voice').click();
    assert.equal(await page.locator('#settingsSectionTitle').textContent(), '语音功能');
    assert.equal(await page.locator('#settings-tab-voice [data-keyline-icon="mic"]').count(), 1);
    assert.equal(await page.locator('#voiceEnabled').count(), 0);
    assert.equal(await page.locator('#voiceInstall').isEnabled(), true);
    assert.deepEqual(await page.locator('.voice-block-heading').allTextContents(), ['安装模型', '设置快捷键']);
    assert.equal(await page.locator('#voiceShortcut').textContent(), 'Ctrl+Shift+1');
    await page.locator('#voiceShortcut').click();
    await page.keyboard.press('Control+Alt+2');
    await page.waitForFunction(() => state.config.voice.shortcut === 'Ctrl+Alt+2');
    await page.locator('#voiceShortcut').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#voiceShortcut').textContent(), 'Ctrl+Alt+2');
    assert.equal(await page.locator('.voice-model-actions button').count(), 1);
    assert.equal(await page.locator('#tab-voice').innerText().then(text => /INT8|音频隐私|处理位置|无需 API Key/.test(text)), false);
    assert.equal(await page.locator('#voiceMicButton').isVisible(), false);
    await page.evaluate(() => api.voiceConfigure({ enabled: true }));
    await page.waitForFunction(() => state.config.voice.enabled && !document.querySelector('#voiceInstall').disabled);
    assert.equal(fs.existsSync(path.join(userData, 'YanData/voice/models')), false, 'enabling never downloads a model');
    await page.locator('#voiceLanguage').selectOption('zh', { force: true });
    await page.waitForFunction(() => state.config.voice.language === 'zh');
    await page.locator('#voiceDownloadSource').selectOption('mirror', { force: true });
    await page.waitForFunction(() => state.config.voice.downloadSource === 'mirror');
    await page.reload(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-voice').click();
    assert.equal(await page.locator('#voiceShortcut').textContent(), 'Ctrl+Alt+2');
    assert.equal(await page.locator('#voiceLanguage').inputValue(), 'zh');
    assert.equal(await page.locator('#voiceDownloadSource').inputValue(), 'mirror');
    const initialVoice = await page.evaluate(async () => (await api.voiceStatus()).value);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => applyTheme(value), theme);
      await page.screenshot({ path: path.join(output, `settings-${theme}.png`) });
      await app.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('voice:changed', {
        ...snapshot, preparation: { phase: 'downloading', completedBytes: 420, totalBytes: 1000, steps: [] }
      }), initialVoice);
      await page.waitForFunction(() => document.querySelector('#voiceInstallProgress').getAttribute('aria-valuenow') === '42');
      assert.equal(await page.locator('#voiceInstall').getAttribute('data-state'), 'installing');
      assert.equal(await page.locator('#voiceInstall').isEnabled(), true, 'download can be cancelled');
      assert.equal(await page.locator('#voiceInstallProgress').isVisible(), true);
      assert.equal(await page.locator('.voice-action-download').isVisible(), false);
      assert.equal(await page.locator('.voice-action-remove').isVisible(), false);
      await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('.voice-progress-value')).strokeDashoffset) - .58) < .001);
      await page.screenshot({ path: path.join(output, `settings-downloading-${theme}.png`) });
      await page.locator('#voiceInstall').click();
      await page.waitForFunction(() => document.querySelector('#voiceInstall').dataset.state === 'download');
      assert.equal(await page.locator('#voiceInstallProgress').isVisible(), false);
      assert.equal(await page.locator('.voice-action-download').isVisible(), true);
    }
    for (const width of [320, 375, 414, 768, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.locator('#tab-voice').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `Voice settings fit at ${width}px`);
      const boxes = await page.locator('.voice-model-heading').evaluate(el => {
        const heading = el.querySelector('h3').getBoundingClientRect(), actions = el.querySelector('.voice-model-actions').getBoundingClientRect();
        return { gap: actions.left - heading.right, diameter: actions.height, width: el.querySelector('button').getBoundingClientRect().width };
      });
      assert.ok(boxes.gap >= 0, `Model controls do not overlap the name at ${width}px`);
      assert.equal(boxes.diameter, boxes.width, 'model button remains circular');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => api.voiceConfigure({ enabled: false }));
    await page.waitForFunction(() => !state.config.voice.enabled);
    const cache = path.join(root, 'output/voice-smoke/voice');
    if (fs.existsSync(cache)) {
      fs.cpSync(cache, path.join(userData, 'YanData/voice'), { recursive: true });
      await page.evaluate(() => api.voiceConfigure({ enabled: true }));
      await page.waitForFunction(() => document.querySelector('#voiceInstall').dataset.state === 'remove');
      assert.equal(await page.locator('#voiceInstall').getAttribute('title'), '卸载模型');
      assert.equal(await page.locator('.voice-action-remove').isVisible(), true);
      assert.equal(await page.locator('.voice-action-download').isVisible(), false);
      await page.evaluate(() => api.voicePrepare());
      await page.waitForFunction(async () => (await api.voiceStatus()).value.preparation.phase === 'ready');
      const realResult = await page.evaluate(bytes => api.voiceTranscribe({ requestId: 'electron-native-smoke', audio: Uint8Array.from(bytes) }), Array.from(fs.readFileSync(path.join(root, 'output/voice-smoke/zh.wav'))));
      assert.equal(realResult.ok, true, JSON.stringify(realResult));
      assert.match(realResult.value.text, /9点.*5点/);
      console.log('PASS real SenseVoice inference in Electron:', realResult.value.text);
      await page.screenshot({ path: path.join(output, 'settings-installed.png') });
      await app.evaluate(({ ipcMain }) => {
        global.__voiceReplies = { mode: 'immediate', resolve: null, audioBytes: 0 };
        ipcMain.removeHandler('voice:transcribe');
        ipcMain.handle('voice:transcribe', async (_event, request) => {
          global.__voiceReplies.audioBytes = request.audio.byteLength;
          if (global.__voiceReplies.mode === 'delayed') await new Promise(resolve => { global.__voiceReplies.resolve = resolve; });
          return { ok: true, value: { text: '这是一段语音输入。', audioSeconds: 1, inferenceSeconds: 0.1 } };
        });
      });
      await page.evaluate(() => closeSettings());
      assert.deepEqual(await page.evaluate(() => {
        const merge = window.YanVoiceInput.mergePartial;
        return [merge('', '你好'), merge('你好', '你好今天'), merge('你好今天', '今天我们'), merge('你好今天我们', '你好今天')];
      }), ['你好', '你好今天', '你好今天我们', '你好今天我们']);
      await page.locator('#composerInput').fill('原有草稿 ');
      await page.locator('#composerInput').press('End');
      await page.evaluate(() => {
        const input = document.querySelector('#composerInput');
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      });
      await page.keyboard.press('Control+Alt+2');
      await page.waitForFunction(() => document.querySelector('.voice-recording-row [role="status"]').textContent === '正在录音');
      assert.equal(await page.locator('#voiceMicButton').isVisible(), true, 'microphone remains visible after capture starts');
      assert.equal(await page.locator('.voice-wave').isVisible(), true, 'wave appears while recording');
      assert.equal(await page.locator('#voiceMicButton .voice-wave').isVisible(), true);
      assert.equal(await page.locator('#voiceMicButton svg').isVisible(), false);
      assert.equal(await page.locator('.voice-recording-row time').count(), 0);
      await page.evaluate(() => document.querySelector('#composerInput').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await page.screenshot({ path: path.join(output, 'recording.png') });
      await page.waitForTimeout(800);
      await page.keyboard.press('Control+Alt+2');
      assert.equal(await page.locator('.voice-wave').isVisible(), false, 'wave stops when recording ends');
      assert.equal(await page.locator('#voiceMicButton').isVisible(), true, 'microphone remains available while transcribing');
      await page.waitForFunction(() => getComposerText().includes('这是一段语音输入。'));
      assert.match(await page.locator('#composerInput').innerText(), /原有草稿/);
      assert.ok(await app.evaluate(() => global.__voiceReplies.audioBytes > 46));
      await page.locator('#composerInput').press('Control+z');
      assert.equal(await page.locator('#composerInput').innerText(), '原有草稿 ');
      console.log('PASS microphone capture, PCM WAV, insertion and undo');

      await app.evaluate(({ ipcMain }) => {
        global.__voiceStreamChunks = 0;
        ipcMain.removeHandler('voice:stream-start');
        ipcMain.removeHandler('voice:stream-chunk');
        ipcMain.removeHandler('voice:stream-finish');
        ipcMain.handle('voice:stream-start', async () => ({ ok: true, value: { ok: true } }));
        ipcMain.handle('voice:stream-chunk', async () => {
          const text = ['你好', '你好我们', '你好我们可以做什么'][Math.min(global.__voiceStreamChunks++, 2)];
          return { ok: true, value: { text, final: false } };
        });
        ipcMain.handle('voice:stream-finish', async () => ({ ok: true, value: { text: '你好我们可以做什么', final: true } }));
      });
      await page.locator('#composerInput').fill('');
      await page.locator('#voiceMicButton').click();
      await page.waitForFunction(() => document.querySelector('.voice-recording-row [role="status"]').textContent === '正在录音');
      assert.equal(await page.locator('#voiceMicButton').isVisible(), true, 'microphone can start a second recording');
      assert.equal(await page.locator('.voice-wave').isVisible(), true);
      await page.waitForFunction(() => getComposerText().includes('你好我们可以做什么'));
      assert.equal(await page.locator('#composerInput').innerText(), '你好我们可以做什么');
      assert.ok(await app.evaluate(() => global.__voiceStreamChunks >= 3));
      await page.locator('#voiceMicButton').click();
      assert.equal(await page.locator('.voice-wave').isVisible(), false);
      await page.waitForFunction(() => document.querySelector('.voice-recording-row').classList.contains('hidden'));
      assert.equal(await page.locator('#composerInput').innerText(), '这是一段语音输入。');
      console.log('PASS streaming partials replace the current transcript without duplication');

      await app.evaluate(() => { global.__voiceReplies.mode = 'delayed'; });
      await page.locator('#voiceMicButton').click();
      await page.waitForFunction(() => document.querySelector('.voice-recording-row [role="status"]').textContent === '正在录音');
      await page.waitForTimeout(800); await page.locator('#voiceMicButton').click();
      await page.locator('#composerInput').fill('转写期间修改的草稿');
      await app.evaluate(async () => {
        const until = Date.now() + 5000;
        while (!global.__voiceReplies.resolve) { if (Date.now() > until) throw new Error('Transcription was not admitted'); await new Promise(resolve => setTimeout(resolve, 20)); }
        global.__voiceReplies.resolve(); global.__voiceReplies.resolve = null;
      });
      assert.equal(await page.locator('#composerInput').innerText(), '转写期间修改的草稿');
      await page.waitForFunction(() => document.querySelector('.voice-recording-row [role="status"]').textContent === '转写已完成');
      assert.equal(await page.locator('.voice-wave').isVisible(), false, 'feedback never leaves the waveform running');
      assert.equal(await page.locator('#voiceMicButton').isVisible(), true, 'microphone remains reusable after feedback');
      console.log('PASS changed drafts remain untouched while recording');

      await page.locator('#voiceMicButton').click();
      await page.waitForFunction(() => document.querySelector('.voice-recording-row [role="status"]').textContent === '正在录音');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.voice-recording-row').isVisible(), false);
      await page.locator('#voiceMicButton').click();
      await page.waitForFunction(() => document.querySelector('.voice-recording-row [role="status"]').textContent === '正在录音');
      await page.waitForTimeout(800); await page.locator('#voiceMicButton').click();
      await app.evaluate(async () => {
        const until = Date.now() + 5000;
        while (!global.__voiceReplies.resolve) { if (Date.now() > until) throw new Error('Transcription was not admitted'); await new Promise(resolve => setTimeout(resolve, 20)); }
      });
      await page.evaluate(() => newSession({ forceNew: true }));
      await app.evaluate(() => {
        global.__voiceReplies.resolve(); global.__voiceReplies.resolve = null;
      });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('#composerInput').innerText(), '');
      await page.evaluate(() => openSettings('voice'));
      await page.locator('#voiceInstall').click();
      await page.locator('#voiceRemoveConfirm').click();
      await page.waitForFunction(() => document.querySelector('#voiceInstall').dataset.state === 'download');
      assert.equal(await page.locator('#voiceMicButton').isVisible(), false);
    }
    assert.deepEqual(errors, []);
    console.log('PASS voice settings, explicit activation, persistence, themes, responsive layout, recording, undo, draft conflict, cancellation and session isolation.');
  } catch (error) {
    const windows = app ? app.windows() : [];
    if (windows[0]) {
      console.error('Voice UI state:', await windows[0].evaluate(() => ({ text: getComposerText(), html: document.querySelector('#composerInput').innerHTML, feedback: document.querySelector('.voice-recording-row [role="status"]').textContent })).catch(() => null));
      await windows[0].screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    try { await app?.close(); } finally {
      try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) {
        if (!['EPERM', 'EBUSY'].includes(error.code)) throw error;
        console.warn('Temporary Electron profile remains locked:', userData);
      }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
