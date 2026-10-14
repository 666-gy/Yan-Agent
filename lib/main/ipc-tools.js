'use strict';

// IPC: Text-to-speech, update packages, VS Code, PowerShell and the DSH
// code-review host (plan T1.4). Handlers moved verbatim from main.js; the
// lazy TTS service, the pending update package and the review-document
// rotation are function-local state and moved with their only consumers.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { createTextToSpeech } = require('../text-to-speech');
const { detectVsCode, launchVsCode } = require('../vscode-launcher');
const updateChecker = require('../update-checker');

function registerToolsIpc(ctx) {
  const { ipcMain, app, shell, config, paths } = ctx;
  const loadConfig = config.load;

  // -------------------------------------------------------------------------
  // Text-to-speech (Edge neural voices for reading replies aloud)
  // -------------------------------------------------------------------------
  let textToSpeechService = null;
  function getTextToSpeechService() {
    if (!textToSpeechService) {
      textToSpeechService = createTextToSpeech({
        cacheDir: path.join(paths.dataDir, 'tts-cache')
      });
    }
    return textToSpeechService;
  }

  ipcMain.handle('tts:synth', async (_e, payload = {}) => {
    try {
      const result = await getTextToSpeechService().synthesize({
        text: payload?.text,
        voice: payload?.voice,
        rate: payload?.rate,
        requestId: payload?.requestId
      });
      const audio = await fsp.readFile(result.path);
      return {
        ok: true,
        audio,
        mime: 'audio/mpeg',
        cached: !!result.cached,
        voice: result.voice,
        rate: result.rate
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('tts:voices', async () => {
    try {
      return { ok: true, voices: await getTextToSpeechService().listVoices() };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('tts:cancel', (_e, requestId) => {
    try {
      return { ok: true, cancelled: getTextToSpeechService().cancel(requestId) };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  // -------------------------------------------------------------------------
  // Update packages
  // -------------------------------------------------------------------------
  let pendingUpdatePackage = null;

  const currentBuildId = (() => {
    try {
      return String(require('../build-manifest.json').buildId || '');
    } catch {
      return '';
    }
  })();

  ipcMain.handle('update:check', async () => {
    try {
      return await updateChecker.checkForUpdates({ currentVersion: app.getVersion(), currentBuild: currentBuildId });
    } catch (error) {
      return { ok: false, error: 'check-failed', message: String(error?.message || error) };
    }
  });

  ipcMain.handle('update:download', async (event) => {
    try {
      const info = await updateChecker.checkForUpdates({ currentVersion: app.getVersion(), currentBuild: currentBuildId });
      if (!info.ok) return info;
      if (!info.hasUpdate) return { ok: false, error: 'no-update', currentVersion: info.currentVersion };
      const targetDir = path.join(app.getPath('temp'), 'yan-agent-update');
      await fsp.mkdir(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, info.fileName);
      const result = await updateChecker.downloadUpdate({
        url: info.fileUrl,
        urls: info.fileUrls || [info.fallbackFileUrl].filter(Boolean),
        targetPath,
        expectedSha512: info.sha512,
        expectedSize: info.size,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('update:progress', { ...progress, version: info.latestVersion });
          }
        }
      });
      pendingUpdatePackage = { path: result.path, version: info.latestVersion };
      return { ok: true, path: result.path, version: info.latestVersion, size: result.size };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('update:install', async () => {
    if (!pendingUpdatePackage) return { ok: false, error: 'no-package' };
    const error = await shell.openPath(pendingUpdatePackage.path);
    if (error) return { ok: false, error };
    setTimeout(() => app.quit(), 1200);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // VS Code
  // -------------------------------------------------------------------------
  ipcMain.handle('vscode:status', async () => {
    const status = await detectVsCode();
    if (!status.available || !status.executable) return status;
    try {
      const icon = await app.getFileIcon(status.executable, { size: 'normal' });
      return { ...status, iconDataUrl: icon.isEmpty() ? '' : icon.toDataURL() };
    } catch {
      return { ...status, iconDataUrl: '' };
    }
  });

  ipcMain.handle('vscode:launch', async (_e, { workspace = '', useDefault = false } = {}) => {
    const cfg = loadConfig();
    if (useDefault) {
      try {
        const target = workspace.startsWith('file:') ? fileURLToPath(workspace) : workspace;
        if (!path.isAbsolute(target) || !fs.existsSync(target)) return { error: '文件或文件夹不存在' };
        const error = await shell.openPath(target);
        return error ? { error } : { ok: true };
      } catch (error) { return { error: error.message }; }
    }
    return launchVsCode(workspace || cfg.workspace);
  });

  // -------------------------------------------------------------------------
  // PowerShell
  // -------------------------------------------------------------------------
  ipcMain.handle('powershell:open-external', async (_e, { workspace = '' } = {}) => {
    return require('../external-terminal').openExternalTerminal(workspace);
  });

  // -------------------------------------------------------------------------
  // DSH code-review host: write the upstream self-contained review page into a
  // rotated temp file and return a file: URL. The app CSP forbids inline
  // scripts in blob:/srcdoc, while the review page's inline comments and copy
  // buttons depend on inline scripts, so the iframe must load a real document.
  // -------------------------------------------------------------------------
  let dshReviewWriteSequence = 0;
  const dshReviewDocuments = new Map();
  ipcMain.handle('dsh-review:write-html', async (_event, html) => {
    if (typeof html !== 'string' || html.length === 0 || html.length > 32 * 1024 * 1024) {
      return { ok: false, error: '无效的审阅页面内容' };
    }
    try {
      const dir = path.join(app.getPath('temp'), 'yan-dsh-code-review', String(process.pid));
      await fs.promises.mkdir(dir, { recursive: true });
      const owner = _event.sender.id;
      const file = path.join(dir, `review-${owner}-${++dshReviewWriteSequence}.html`);
      await fs.promises.writeFile(file, html, 'utf8');
      let documents = dshReviewDocuments.get(owner);
      if (!documents) {
        documents = [];
        dshReviewDocuments.set(owner, documents);
        _event.sender.once('destroyed', () => {
          dshReviewDocuments.delete(owner);
          for (const document of documents.splice(0)) void fs.promises.unlink(document).catch(() => {});
        });
      }
      documents.push(file);
      for (const obsolete of documents.splice(0, Math.max(0, documents.length - 8))) {
        void fs.promises.unlink(obsolete).catch(() => {});
      }
      return { ok: true, url: pathToFileURL(file).href };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

module.exports = { registerToolsIpc };
