'use strict';

// Generated media store (plan T3.2): the per-run media workspace registry and
// the generated image/video cache. Moved verbatim from main.js; the image and
// viewer maps stay owned by main.js and are passed in, so nothing else has to
// change ownership.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { pathToFileURL } = require('url');
const workspaceSandbox = require('../workspace-sandbox');

const MAX_STORED_GENERATED_IMAGES = 100;
const MAX_STORED_GENERATED_IMAGE_BYTES = 1024 * 1024 * 1024;
const GENERATED_IMAGE_MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

function registerGeneratedMediaStore(deps) {
  const { app, dataDir, generatedImages, generatedImageViewers } = deps;
  const generatedImageStoreDir = path.join(dataDir, 'generated-images');
  const generatedVideoStoreDir = path.join(dataDir, 'generated-videos');
  const generatedMediaManifestDir = path.join(dataDir, 'generated-media');
  const legacyGeneratedImageTempDir = path.join(app.getPath('temp'), 'YanAgent', 'generated-images');
  // Active-run workspaces for the Yan Media MCP. The MCP env must stay
  // config-stable (see buildYanMediaMcpServer), so per-run workspaces are
  // delivered through this file and read dynamically per tool call.
  const mediaWorkspaceRegistryPath = path.join(dataDir, 'media-workspace-registry.json');

  function readMediaWorkspaceRegistry() {
    try {
      const data = JSON.parse(fs.readFileSync(mediaWorkspaceRegistryPath, 'utf8'));
      return Array.isArray(data?.entries) ? data.entries : [];
    } catch {
      return [];
    }
  }

  function writeMediaWorkspaceRegistry(entries) {
    try {
      fs.writeFileSync(mediaWorkspaceRegistryPath, JSON.stringify({
        entries: entries.slice(0, 8)
      }, null, 0), 'utf8');
    } catch (error) {
      console.warn('[media-registry] write failed:', error?.message || error);
    }
  }

  function registerMediaWorkspace(runId, workspace) {
    const normalized = workspaceSandbox.normalizeWorkspace(workspace);
    const id = String(runId || '');
    const entries = readMediaWorkspaceRegistry().filter(entry => entry?.runId !== id);
    if (normalized) entries.unshift({ runId: id, workspace: normalized, ts: Date.now() });
    writeMediaWorkspaceRegistry(entries);
  }

  function releaseMediaWorkspace(runId) {
    const id = String(runId || '');
    const entries = readMediaWorkspaceRegistry().filter(entry => entry?.runId !== id);
    writeMediaWorkspaceRegistry(entries);
  }

  function loadGeneratedImageStore() {
    generatedImages.clear();
    fs.mkdirSync(generatedImageStoreDir, { recursive: true });
    try {
      for (const file of fs.readdirSync(legacyGeneratedImageTempDir, { withFileTypes: true })) {
        if (!file.isFile() || !/^[a-f0-9]{32}\.(?:png|jpg|jpeg|webp|gif)$/i.test(file.name)) continue;
        const target = path.join(generatedImageStoreDir, file.name.toLowerCase());
        if (!fs.existsSync(target)) fs.copyFileSync(path.join(legacyGeneratedImageTempDir, file.name), target);
      }
      fs.rmSync(legacyGeneratedImageTempDir, { recursive: true, force: true });
    } catch {}

    const restored = [];
    for (const file of fs.readdirSync(generatedImageStoreDir, { withFileTypes: true })) {
      const match = file.isFile() && file.name.match(/^([a-f0-9]{32})\.(png|jpg|jpeg|webp|gif)$/i);
      if (!match) continue;
      const filePath = path.join(generatedImageStoreDir, file.name);
      try {
        const stat = fs.statSync(filePath);
        restored.push({
          assetId: match[1].toLowerCase(),
          filePath,
          name: `generated_${Math.trunc(stat.mtimeMs)}_${match[1].slice(0, 6)}.${match[2].toLowerCase()}`,
          size: stat.size,
          mimeType: GENERATED_IMAGE_MIME_BY_EXTENSION[match[2].toLowerCase()],
          createdAt: stat.mtimeMs
        });
      } catch {}
    }
    restored.sort((a, b) => a.createdAt - b.createdAt);
    for (const asset of restored) generatedImages.set(asset.assetId, asset);
    pruneGeneratedImageStore();
  }

  function closeGeneratedImageViewers() {
    for (const viewer of generatedImageViewers.values()) {
      if (!viewer.isDestroyed()) viewer.destroy();
    }
    generatedImageViewers.clear();
    generatedImages.clear();
  }

  function getGeneratedImageAsset(assetId) {
    const id = String(assetId || '').trim();
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    let asset = generatedImages.get(id);
    if (!asset) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(generatedMediaManifestDir, `${id}.json`), 'utf8'));
        const filePath = path.resolve(String(manifest.filePath || ''));
        const extension = path.extname(filePath).slice(1).toLowerCase();
        const insideDataDir = filePath.startsWith(`${dataDir}${path.sep}`);
        if (manifest.assetId === id && manifest.type === 'image' && insideDataDir && GENERATED_IMAGE_MIME_BY_EXTENSION[extension]) {
          const stat = fs.statSync(filePath);
          asset = {
            assetId: id,
            filePath,
            name: String(manifest.name || `generated_${Math.trunc(stat.mtimeMs)}_${id.slice(0, 6)}.${extension}`),
            size: stat.size,
            mimeType: String(manifest.mimeType || GENERATED_IMAGE_MIME_BY_EXTENSION[extension]),
            createdAt: Number(manifest.createdAt) || stat.mtimeMs
          };
          generatedImages.set(id, asset);
        }
      } catch {}
    }
    if (!asset || !fs.existsSync(asset.filePath)) {
      if (asset) generatedImages.delete(id);
      return null;
    }
    return asset;
  }

  function pruneGeneratedImageStore() {
    let totalBytes = [...generatedImages.values()].reduce((sum, item) => sum + item.size, 0);
    for (const [id, item] of generatedImages) {
      if (generatedImages.size <= MAX_STORED_GENERATED_IMAGES && totalBytes <= MAX_STORED_GENERATED_IMAGE_BYTES) break;
      generatedImages.delete(id);
      totalBytes -= item.size;
      fsp.unlink(item.filePath).catch(() => {});
      const viewer = generatedImageViewers.get(id);
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    }
  }

  async function registerGeneratedImage(result) {
    fs.mkdirSync(generatedImageStoreDir, { recursive: true });
    const assetId = crypto.randomBytes(16).toString('hex');
    const name = `generated_${Date.now()}_${assetId.slice(0, 6)}.${result.extension}`;
    const filePath = path.join(generatedImageStoreDir, `${assetId}.${result.extension}`);
    await fsp.writeFile(filePath, result.buffer);
    generatedImages.set(assetId, {
      assetId,
      filePath,
      name,
      size: result.buffer.length,
      mimeType: result.mimeType,
      providerId: result.providerId || '',
      model: result.model || '',
      providerRequestId: result.providerRequestId || '',
      createdAt: Date.now()
    });
    pruneGeneratedImageStore();
    return generatedImages.get(assetId);
  }

  async function cacheAuthorizedGeneratedVideo(result, signal) {
    if (!result?.url || !result?.downloadHeaders) return result;
    const response = await fetch(result.url, {
      method: 'GET',
      headers: result.downloadHeaders,
      signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`下载生成视频失败：HTTP ${response.status}`);
    }
    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize > 512 * 1024 * 1024) throw new Error('生成视频超过 512MB 限制');
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const extension = contentType.includes('webm') ? 'webm' : (contentType.includes('quicktime') ? 'mov' : 'mp4');
    await fsp.mkdir(generatedVideoStoreDir, { recursive: true });
    const assetId = crypto.randomBytes(16).toString('hex');
    const filePath = path.join(generatedVideoStoreDir, `${assetId}.${extension}`);
    try {
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath), { signal });
      const stat = await fsp.stat(filePath);
      if (stat.size > 512 * 1024 * 1024) throw new Error('生成视频超过 512MB 限制');
      return {
        ...result,
        url: pathToFileURL(filePath).href,
        size: `${(stat.size / (1024 * 1024)).toFixed(1)} MB`,
        localPath: filePath,
        downloadHeaders: undefined
      };
    } catch (error) {
      await fsp.unlink(filePath).catch(() => {});
      throw error;
    }
  }

  return {
    mediaWorkspaceRegistryPath,
    registerMediaWorkspace,
    releaseMediaWorkspace,
    loadGeneratedImageStore,
    closeGeneratedImageViewers,
    getGeneratedImageAsset,
    pruneGeneratedImageStore,
    registerGeneratedImage,
    cacheAuthorizedGeneratedVideo
  };
}

module.exports = { registerGeneratedMediaStore, GENERATED_IMAGE_MIME_BY_EXTENSION };
