'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-history-e2e-'));

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
    await page.waitForFunction(() => typeof appendMessage === 'function' && typeof clearMessages === 'function');

    const counts = await page.evaluate(() => {
      clearMessages();
      const imageId = 'history-image-id';
      const videoUrl = 'https://example.invalid/history-video.mp4';
      const imageResult = JSON.stringify({
        ok: true,
        meta: { generatedImageId: imageId, name: '历史图片' }
      });
      const videoResult = JSON.stringify({
        ok: true,
        meta: { generatedVideoId: 'history-video-id', generatedVideoUrl: videoUrl, name: '历史视频' }
      });
      const agentRun = {
        status: 'done',
        summaryStarted: true,
        timeline: [
          { type: 'tool_result', stage: 'work', callId: 'image-call', name: 'generate_image', ok: true, output: imageResult },
          { type: 'tool_result', stage: 'work', callId: 'video-call', name: 'generate_video', ok: true, output: videoResult }
        ]
      };
      appendMessage('assistant', '媒体已生成。', [], false, 0, Date.now(), 1000, agentRun, [], [
        { type: 'image', assetId: imageId, name: '历史图片' },
        { type: 'video', assetId: 'history-video-id', url: videoUrl, name: '历史视频' }
      ]);
      return {
        images: document.querySelectorAll('#messages .generated-image-result').length,
        videos: document.querySelectorAll('#messages .generated-video-result').length
      };
    });

    assert.deepEqual(counts, { images: 1, videos: 1 });
    console.log(JSON.stringify({ ok: true, counts }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
