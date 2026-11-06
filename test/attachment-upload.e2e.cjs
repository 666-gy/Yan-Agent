'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const { OpenCodeV2Sidecar } = require('../lib/kernel-v2/sidecar');
const { prepareAttachments } = require('../lib/kernel-v2/attachments');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-attachment-desktop-'));
  let app, sidecar;
  try {
    app = await electron.launch({ executablePath: process.env.YAN_TEST_PACKAGED_EXE || require('electron'), args: process.env.YAN_TEST_PACKAGED_EXE ? [] : [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(temp, 'data') } });
    const page = await app.firstWindow();
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => typeof newSession === 'function' && state.config);
    if (process.env.YAN_TEST_PACKAGED_EXE) {
      assert.match(await page.evaluate(() => window.YanAboutContent.versionLabel), new RegExp(require('../package.json').displayVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(await page.locator('#yanxiNavBtn').count(), 0);
      assert.equal(await page.locator('script[src="yanxi.js"]').count(), 0);
      await page.evaluate(() => {
        document.querySelector('#titlebarHelpMenuBtn').click();
        document.querySelector('#titlebarHelpMenu [data-titlebar-action="whats-new"]').click();
      });
      await page.locator('#titlebarWhatsNewDialog[open]').waitFor();
      const about = await page.locator('#titlebarWhatsNewDialog').innerText();
      assert.match(about, /内置浏览器验收现支持快速\/严谨两种模式/);
      assert.match(about, /修复了大文件上传时的500报错/);
      await page.evaluate(() => document.querySelector('#titlebarWhatsNewDialog .about-dialog-close').click());
    }
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    const large = path.join(temp, 'large.apk');
    fs.writeFileSync(large, 'APK_HEADER'); fs.truncateSync(large, 320 * 1024 * 1024);
    await page.evaluate(async temp => {
      await newSession({ workspace: temp, forceNew: true });
      window.attachmentProgress = [];
      window.uploadSendBlocked = [];
      api.onUploadProgress(event => { window.attachmentProgress.push(event.percent); window.uploadSendBlocked.push(sendBtn.disabled); });
      window.originalFileToBase64 = fileToBase64;
      fileToBase64 = () => { throw new Error('Disk file must not pass through base64 IPC'); };
    }, temp);
    await page.locator('#fileInput').setInputFiles(large);
    await page.waitForFunction(() => state.attachments.length === 1 && !hasPendingAttachments());
    const meta = await page.evaluate(() => state.attachments[0]);
    assert.equal(meta.size, 320 * 1024 * 1024);
    assert.equal(meta.mode, 'reference');
    assert.notEqual(meta.path, large);
    assert.equal((await page.locator('#attachments').innerText()).trim(), 'large.apk');
    assert.ok((await page.evaluate(() => window.attachmentProgress)).includes(100));
    assert.ok((await page.evaluate(() => window.uploadSendBlocked)).every(Boolean));
    fs.unlinkSync(large); assert.equal(fs.statSync(meta.path).size, meta.size);
    const imageFile = path.join(temp, 'large-image.png');
    const imageBytes = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 3000; canvas.height = 2400;
      const context = canvas.getContext('2d');
      const pixels = context.createImageData(canvas.width, canvas.height);
      let seed = 123;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[i] = seed & 255; pixels.data[i + 1] = (seed >>> 8) & 255; pixels.data[i + 2] = (seed >>> 16) & 255; pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(imageFile, Buffer.from(imageBytes, 'base64'));
    await page.locator('#fileInput').setInputFiles(imageFile);
    await page.waitForFunction(() => state.attachments.length === 2 && !hasPendingAttachments(), { timeout: 30000 });
    const imageMeta = await page.evaluate(() => state.attachments[1]);
    assert.equal(imageMeta.mode, 'inline');
    assert.ok(imageMeta.inlinePath);
    assert.ok(Math.ceil(fs.statSync(imageMeta.inlinePath).size / 3) * 4 <= 2 * 1024 * 1024);
    const dimensions = await app.evaluate(({ nativeImage }, file) => nativeImage.createFromPath(file).getSize(), imageMeta.inlinePath);
    assert.ok(dimensions.width <= 2000 && dimensions.height <= 2000);
    assert.deepEqual(fs.readFileSync(imageMeta.path), fs.readFileSync(imageFile));
    await page.evaluate(async () => {
      await addAttachment(new File(['clipboard content'], 'clipboard.txt', { type: 'text/plain' }));
    });
    assert.equal(await page.evaluate(() => state.attachments.length), 3);
    await page.evaluate(async () => {
      await addAttachment(new File([new Uint8Array(21 * 1024 * 1024)], 'browser-blob.zip', { type: 'application/zip' }));
    });
    const blobMeta = await page.evaluate(() => state.attachments[3]);
    assert.equal(blobMeta.size, 21 * 1024 * 1024);
    assert.equal(fs.statSync(blobMeta.path).size, blobMeta.size);
    const formats = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      return { webp: canvas.toDataURL('image/webp').split(',')[1], gif: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
    });
    for (const [extension, data] of Object.entries(formats)) {
      const file = path.join(temp, 'format.' + extension); fs.writeFileSync(file, Buffer.from(data, 'base64'));
      const result = await page.evaluate(async ({ file, extension }) => api.uploadFilePath('format.' + extension, file, 'image/' + extension), { file, extension });
      assert.ok(result.inlinePath, JSON.stringify(result));
    }
    sidecar = new OpenCodeV2Sidecar({ appRoot: root, dataDir: path.join(temp, 'kernel') });
    await sidecar.start({});
    const session = await sidecar.client.session.create({ location: { directory: temp } });
    const prepared = await prepareAttachments([meta, imageMeta, blobMeta]);
    assert.equal(prepared.files.length, 1);
    const admitted = await sidecar.client.session.prompt({ sessionID: session.id, text: prepared.context, files: prepared.files, resume: false });
    assert.ok(admitted.id, 'mixed 320 MiB binary and large image must reach real kernel admission');
    assert.deepEqual(pageErrors, []);
    const evidence = path.join(root, '.yanagent/evidence/attachment-upload-fixed.png');
    await page.screenshot({ path: evidence });
    console.log(JSON.stringify({ copiedBytes: meta.size, originalImageBytes: imageMeta.size, inlineImageBytes: fs.statSync(imageMeta.inlinePath).size, dimensions, evidence }));
  } finally {
    await sidecar?.stop();
    await app?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
