'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-attachment-video-'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(temp, 'data') } });
    const page = await app.firstWindow();
    page.on('console', m => { if(m.type()==='error') console.log(m.text()); });
    page.on('requestfailed', r => console.log(r.url(), r.failure()));
    await page.waitForFunction(() => typeof newSession === 'function' && state.config);
    const clip = path.join(temp, 'clip.mp4'), text = path.join(temp, 'sample.txt');
    fs.copyFileSync(path.join(root, process.env.YAN_TEST_VIDEO_AUDIO ? 'test/fixtures/video-with-audio.webm' : 'renderer/assets/wallpapers/【哲风壁纸】下雨天-中式建筑.mp4'), clip); fs.writeFileSync(text, 'attachment preview');
    await page.evaluate(async ({ temp, clip, text }) => {
      await newSession({ workspace: temp, forceNew: true });
      state.attachments = [{ path: clip, name: 'clip.mp4', kind: 'file' }, { path: text, name: 'sample.txt', kind: 'file' }];
      renderAttachments();
    }, { temp, clip, text });
    await page.locator('#attachments [data-i="0"]').first().click();
    await page.waitForFunction(() => document.querySelector('.pf-video video')?.readyState >= 2);
    assert.deepEqual(await page.locator('.pf-video-speeds button').allTextContents(), ['0.5x', '1x', '1.25x', '1.5x', '2x']);
    await page.locator('.pf-video-speeds button').filter({ hasText: /^1.25x$/ }).click();
    assert.equal(await page.locator('.pf-video-tools input, .pf-video-speed-menu').count(), 0);
    await page.locator('.pf-video-volume button').click();
    assert.equal(await page.locator('.pf-video video').evaluate(video => video.muted), true);
    await page.locator('.pf-video-volume button').click();
    assert.equal(await page.locator('.pf-video video').evaluate(video => video.muted), false);
    await page.locator('.pf-video-volume button').hover();
    await page.locator('.pf-video-volume input').fill('0.4');
    assert.equal(await page.locator('.pf-video video').evaluate(video => video.volume), 0.4);
    await page.locator('.pf-video-volume input').fill('0');
    await page.locator('.pf-video-volume button').click();
    assert.equal(await page.locator('.pf-video video').evaluate(video => video.volume), 0.4);
    await page.locator('.pf-video-bar [aria-label="播放"]').click();
    await page.waitForFunction(() => document.querySelector('.pf-video video').currentTime > 0);
    await page.locator('.pf-video-bar [aria-label="暂停"]').click();
    assert.equal(await page.locator('.pf-video video').evaluate(video => video.paused), true);
    assert.equal(await page.locator('[aria-label="下载视频"]').count(), 1);
    await app.evaluate(({ dialog }) => { global.__videoDownload = null; dialog.showSaveDialog = async (...args) => { global.__videoDownload = args.at(-1); return { canceled: true }; }; });
    await page.locator('[aria-label="下载视频"]').click();
    await page.waitForTimeout(100);
    assert.ok(await app.evaluate(() => global.__videoDownload));
    await page.screenshot({ path: '.yanagent/evidence/video-controls.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.pf-video video').evaluate(video => video.playbackRate), 1.25);
    assert.equal(await page.locator('.pf-video video').evaluate(video => video.disablePictureInPicture), true);
    await page.locator('.pf-video video').evaluate(video => video.play());
    await page.waitForFunction(() => document.querySelector('.pf-video video').currentTime > 0);
    await page.locator('#attachments [data-i="1"]').first().click();
    await page.waitForFunction(() => document.querySelector('.pf-editor')?.value === 'attachment preview');
    console.log('Attachment file routing and real video playback passed');
  } finally { await app?.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
