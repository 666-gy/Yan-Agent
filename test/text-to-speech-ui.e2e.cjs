'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-tts-ui-'));
const output = path.join(root, 'output', 'tts-read-aloud');

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    fs.mkdirSync(output, { recursive: true });

    // A completed assistant reply without a run: the plain read-aloud target.
    await page.evaluate(() => {
      const el = appendMessage('assistant', '第一句正文。第二句正文！第三句正文？', [], false, 0, Date.now(), 1200, null, [], null);
      el.dataset.probe = 'tts';
    });
    const speakButton = page.locator('#messages .msg.assistant[data-probe="tts"] [data-act="speak"]');
    assert.equal(await speakButton.count(), 1, 'assistant message exposes a speak button');

    const sentenceCount = await page.evaluate(() => splitSpeechSentences('第一句正文。第二句正文！第三句正文？').length);
    assert.equal(sentenceCount, 3, 'sentence splitter keeps one segment per sentence');

    await page.evaluate(() => {
      window.__ttsLog = { synth: 0, played: 0, texts: [] };
      window.requestSpeechAudio = async payload => {
        window.__ttsLog.synth += 1;
        window.__ttsLog.texts.push(payload.text);
        return { ok: true, audio: new Uint8Array([1, 2, 3]), requestId: payload.requestId };
      };
      window.playSpeechAudio = async () => {
        window.__ttsLog.played += 1;
        return true;
      };
    });

    await speakButton.click();
    await page.waitForFunction(
      () => window.__ttsLog && window.__ttsLog.played >= 3 && speechPlayback === null,
      null,
      { timeout: 10000 }
    );
    const afterFirstPass = await page.evaluate(() => ({
      log: window.__ttsLog,
      segments: document.querySelectorAll('#messages .msg.assistant[data-probe="tts"] .tts-seg').length,
      reading: document.querySelectorAll('.tts-reading').length,
      pressed: document.querySelector('#messages .msg.assistant[data-probe="tts"] [data-act="speak"]').getAttribute('aria-pressed'),
      activeClass: document.querySelector('#messages .msg.assistant[data-probe="tts"] [data-act="speak"]').classList.contains('is-reading')
    }));
    assert.equal(afterFirstPass.log.synth, 3, 'each sentence is synthesized once');
    assert.deepEqual(afterFirstPass.log.texts, ['第一句正文。', '第二句正文！', '第三句正文？']);
    assert.equal(afterFirstPass.segments, 3, 'segments stay wrapped in the message DOM');
    assert.equal(afterFirstPass.reading, 0, 'highlight clears after playback finishes');
    assert.equal(afterFirstPass.pressed, 'false');
    assert.equal(afterFirstPass.activeClass, false);

    // Stop path: a never-ending playback must still end cleanly on the second click.
    await page.evaluate(() => {
      window.playSpeechAudio = () => new Promise(() => {});
    });
    await speakButton.click();
    await page.waitForFunction(
      () => document.querySelectorAll('#messages .msg.assistant[data-probe="tts"] .tts-reading').length === 1,
      null,
      { timeout: 5000 }
    );
    await page.screenshot({ path: path.join(output, 'reading-highlight.png') });
    await speakButton.click();
    await page.waitForFunction(() => speechPlayback === null, null, { timeout: 5000 });
    const stopped = await page.evaluate(() => ({
      reading: document.querySelectorAll('.tts-reading').length,
      pressed: document.querySelector('#messages .msg.assistant[data-probe="tts"] [data-act="speak"]').getAttribute('aria-pressed'),
      text: document.querySelector('#messages .msg.assistant[data-probe="tts"] .msg-body').textContent
    }));
    assert.equal(stopped.reading, 0, 'stopping clears the active highlight');
    assert.equal(stopped.pressed, 'false');
    assert.ok(stopped.text.includes('第一句正文。') && stopped.text.includes('第三句正文？'), 'wrapped segments preserve the reply text');

    // Settings surface: custom voice picker, rate control and preview all wired.
    await page.evaluate(() => openSettings('general'));
    await page.waitForSelector('#ttsVoicePickerTrigger', { timeout: 5000 });
    const settings = await page.evaluate(() => ({
      voices: Array.from(document.querySelectorAll('#ttsVoicePickerMenu [data-tts-voice]')).map(option => option.dataset.ttsVoice),
      rate: document.querySelector('#ttsRateRange')?.value,
      label: document.querySelector('#ttsRateValue')?.textContent,
      description: document.querySelector('#generalSpeechTitle ~ .general-settings-group .settings-group-heading p')
    }));
    assert.ok(settings.voices.length >= 8, 'curated voice list renders in the custom picker');
    assert.ok(settings.voices.includes('zh-CN-XiaoxiaoNeural'));
    assert.equal(settings.rate, '0');
    assert.equal(settings.label, '+0%');
    assert.equal(settings.description, null, 'the meaningless heading description is gone');

    await page.click('#ttsVoicePickerTrigger');
    await page.waitForSelector('#ttsVoicePickerMenu:not(.hidden) [data-tts-voice="zh-CN-YunxiNeural"]', { timeout: 10000 });
    const expanded = await page.evaluate(() => document.querySelector('#ttsVoicePickerTrigger').getAttribute('aria-expanded'));
    assert.equal(expanded, 'true', 'custom picker opens as a floating menu');
    await page.screenshot({ path: path.join(output, 'tts-voice-picker.png') });
    await page.click('#ttsVoicePickerMenu [data-tts-voice="zh-CN-YunxiNeural"]');
    await page.waitForFunction(() => state.config?.tts?.voice === 'zh-CN-YunxiNeural', null, { timeout: 5000 });
    const pickerLabel = await page.evaluate(() => document.querySelector('#ttsVoicePickerLabel')?.textContent);
    assert.ok(pickerLabel.includes('云希'), 'picker label follows the saved voice');
    const beforePreview = await page.evaluate(() => window.__ttsLog.synth);
    await page.click('#ttsPreviewBtn');
    await page.waitForFunction(
      count => window.__ttsLog && window.__ttsLog.synth > count,
      beforePreview,
      { timeout: 5000 }
    );
    const previewCall = await page.evaluate(() => window.__ttsLog.texts[window.__ttsLog.texts.length - 1]);
    assert.ok(previewCall.includes('Yan Agent'), 'preview synthesizes the sample sentence');
    await page.screenshot({ path: path.join(output, 'tts-settings.png') });

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      ok: true,
      sentences: afterFirstPass.log.synth,
      segments: afterFirstPass.segments,
      stopCleared: stopped.reading === 0,
      voiceSaved: true,
      preview: true,
      errors
    }));
  } finally {
    await app?.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
