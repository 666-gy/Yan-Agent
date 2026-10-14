'use strict';

// IPC: File uploads, attachment inspection and generated media (plan T1.3).
// Handlers moved verbatim from main.js; main.js keeps ownership of the
// generated-image store, the active generation maps and the viewer windows,
// which this module reaches only through the injected main context.

const fsp = require('fs/promises');
const path = require('path');
const { detectImageType, generateImage } = require('../image-generation');
const { generateVideo } = require('../video-generation');
const { sanitizeUploadName } = require('./upload-store');

function registerFilesMediaIpc(ctx) {
  require('./computer-control').registerComputerControlIpc(ctx);
  require('./app-snapshot').registerAppSnapshotIpc(ctx, require('electron').desktopCapturer);
  const { ipcMain, app, dialog, shell, config, paths, windows } = ctx;
  const loadConfig = config.load;
  const filesDir = paths.filesDir;
  const {
    registerGeneratedImage,
    getGeneratedImageAsset,
    cacheAuthorizedGeneratedVideo,
    showImageViewerWindow,
    resolveStoredUploadPath,
    updateImageGenerationConfig,
    resolveRequestedGenerationConfig,
    getProviderConnectionForSupplier,
    providerAdapterPreset,
    normalizeLanguage,
    ensureDirs,
    generatedImageMimeByExtension: GENERATED_IMAGE_MIME_BY_EXTENSION,
    modelProviders: MODEL_PROVIDERS
  } = ctx.services;
  const { activeImageGenerations, activeVideoGenerations, generatedImages } = ctx.stores;

  ipcMain.handle('file:choose-directory', async () => {
    const result = await dialog.showOpenDialog(windows.getMainWindow(), {
      properties: ['openDirectory']
    });
    return !result.canceled && result.filePaths.length ? result.filePaths[0] : null;
  });

  ipcMain.handle('file:inspect-attachment-path', async (event, filePath) => {
    const mainWindow = windows.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return { ok: false, error: '无权检查该附件路径', code: 'UNAUTHORIZED' };
    }
    const rawPath = String(filePath || '').trim();
    if (!rawPath) return { ok: false, error: '附件路径为空', code: 'PATH_EMPTY' };
    if (rawPath.includes('\0')) return { ok: false, error: '附件路径无效', code: 'PATH_INVALID' };

    let resolvedPath;
    try {
      resolvedPath = path.resolve(rawPath);
    } catch (error) {
      return {
        ok: false,
        error: `附件路径无效：${error?.message || String(error || '未知错误')}`,
        code: 'PATH_INVALID'
      };
    }

    try {
      const stat = await fsp.stat(resolvedPath);
      const isDirectory = stat.isDirectory();
      const isFile = stat.isFile();
      if (!isDirectory && !isFile) {
        return { ok: false, error: '暂不支持该附件类型', code: 'ATTACHMENT_TYPE_UNSUPPORTED' };
      }
      return {
        ok: true,
        path: resolvedPath,
        name: path.basename(resolvedPath) || resolvedPath,
        isDirectory,
        isFile,
        size: isFile ? stat.size : 0
      };
    } catch (error) {
      const reason = error?.code === 'ENOENT'
        ? '路径不存在'
        : (error?.code === 'EACCES' || error?.code === 'EPERM')
          ? '没有权限访问该路径'
          : (error?.message || String(error || '未知错误'));
      return {
        ok: false,
        error: `无法读取附件：${reason}`,
        code: error?.code || 'ATTACHMENT_PATH_UNREADABLE'
      };
    }
  });

  // Upload: copy a file into the uploads dir & return metadata
  ipcMain.handle('file:upload', async (_e, { name, data: b64, mimeType = '' }) => {
    ensureDirs();
    const safeName = sanitizeUploadName(name);
    const buffer = Buffer.from(String(b64 || ''), 'base64');
    if (buffer.length > 50 * 1024 * 1024) return { error: '附件不能超过 50MB' };
    const target = path.join(filesDir, Date.now() + '_' + safeName);
    await fsp.writeFile(target, buffer);
    const stat = await fsp.stat(target);
    return { path: target, name: safeName, size: stat.size, mimeType: String(mimeType || '') };
  });

  ipcMain.handle('image:generate', async (_e, payload = {}) => {
    const cfg = loadConfig();
    if (!cfg.permissions.allowNetwork) return { error: '网络访问权限已关闭，无法生成图片' };
    updateImageGenerationConfig(cfg);
    const imageConfig = resolveRequestedGenerationConfig(cfg, 'image', payload.providerId, payload.modelId);
    if (imageConfig?.error) return { error: imageConfig.error };
    if (!imageConfig.available) return { error: '当前模型配置没有可用的图片生成能力' };
    const imageConnection = getProviderConnectionForSupplier(cfg, imageConfig.providerId, imageConfig.supplierId);
    if (!imageConnection.apiKey) {
      return { error: `请先配置 ${MODEL_PROVIDERS[imageConfig.providerId]?.name || imageConfig.providerId} API Key` };
    }
    const prompt = String(payload.prompt || '').trim();
    const requestId = String(payload.requestId || '').trim().slice(0, 160);
    if (!prompt) return { error: '生图提示词不能为空' };
    if (prompt.length > 4000) return { error: '生图提示词不能超过 4000 个字符' };
    if (!requestId) return { error: '生图请求缺少任务标识' };
    if (activeImageGenerations.has(requestId)) return { error: '该生图任务正在执行，请勿重复提交' };
    let sourceImage = null;
    if (payload.sourceImagePath) {
      if (!cfg.permissions.allowFileRead) return { error: '文件读取权限已关闭，无法编辑图片' };
      const sourcePath = resolveStoredUploadPath(payload.sourceImagePath);
      if (!sourcePath) return { error: '只能编辑 Yan Agent 保存的图片附件' };
      try {
        const stat = await fsp.stat(sourcePath);
        if (stat.size > 20 * 1024 * 1024) return { error: '输入图片不能超过 20MB' };
        const buffer = await fsp.readFile(sourcePath);
        const type = detectImageType(buffer);
        sourceImage = { buffer, mimeType: type.mimeType, name: path.basename(sourcePath) };
      } catch (error) {
        return { error: `无法读取输入图片：${error.message}` };
      }
    }
    const controller = new AbortController();
    const activeRequest = { controller, ownerId: _e.sender.id };
    activeImageGenerations.set(requestId, activeRequest);
    try {
      const result = await generateImage({
        baseUrl: imageConnection.baseUrl,
        apiKey: imageConnection.apiKey,
        providerId: imageConfig.providerId,
        strategy: imageConfig.strategy,
        model: imageConfig.model,
        imageEndpoints: {
          generations: imageConnection.imageGenerationUrl,
          edits: imageConnection.imageEditUrl
        },
        providerOptions: {
          workspaceId: imageConnection.workspaceId,
          adapterKind: providerAdapterPreset(cfg, imageConfig.providerId)
        },
        prompt,
        aspectRatio: payload.aspectRatio || '1:1',
        signal: controller.signal,
        sourceImage
      });
      const asset = await registerGeneratedImage({
        ...result,
        providerId: imageConfig.providerId,
        model: imageConfig.model
      });
      return {
        ok: true,
        assetId: asset.assetId,
        name: asset.name,
        size: result.buffer.length,
        mimeType: result.mimeType,
        providerId: imageConfig.providerId,
        model: imageConfig.model,
        providerRequestId: result.providerRequestId || '',
        providerUsage: result.providerUsage || null,
        strategy: imageConfig.strategy,
        edited: !!result.edited,
        revisedPrompt: result.revisedPrompt || ''
      };
    } catch (error) {
      return { error: error.message, code: error.code || undefined };
    } finally {
      if (activeImageGenerations.get(requestId) === activeRequest) {
        activeImageGenerations.delete(requestId);
      }
    }
  });

  ipcMain.handle('image:cancel', (_e, requestId) => {
    const id = String(requestId || '').trim();
    const activeRequest = activeImageGenerations.get(id);
    if (!activeRequest || activeRequest.ownerId !== _e.sender.id) return { ok: false };
    activeRequest.controller.abort();
    return { ok: true };
  });

  ipcMain.handle('video:generate', async (_e, payload = {}) => {
    const cfg = loadConfig();
    if (!cfg.permissions.allowNetwork) return { error: '网络访问权限已关闭，无法生成视频' };
    updateImageGenerationConfig(cfg);
    const videoConfig = resolveRequestedGenerationConfig(cfg, 'video', payload.providerId, payload.modelId);
    if (videoConfig?.error) return { error: videoConfig.error };
    if (!videoConfig?.available) return { error: '当前模型配置没有可用的视频生成能力' };
    const connection = getProviderConnectionForSupplier(cfg, videoConfig.providerId, videoConfig.supplierId);
    if (!connection.apiKey) {
      return { error: `请先配置 ${MODEL_PROVIDERS[videoConfig.providerId]?.name || videoConfig.providerId} API Key` };
    }
    const prompt = String(payload.prompt || '').trim();
    const requestId = String(payload.requestId || '').trim().slice(0, 160);
    if (!prompt) return { error: '视频提示词不能为空' };
    if (prompt.length > 4000) return { error: '视频提示词不能超过 4000 个字符' };
    if (!requestId) return { error: '视频请求缺少任务标识' };
    if (activeVideoGenerations.has(requestId)) return { error: '该视频任务正在执行，请勿重复提交' };

    const controller = new AbortController();
    const activeRequest = { controller, ownerId: _e.sender.id };
    activeVideoGenerations.set(requestId, activeRequest);
    try {
      const generated = await generateVideo({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
        providerId: videoConfig.providerId,
        providerOptions: {
          workspaceId: connection.workspaceId,
          videoGenerationUrl: connection.videoGenerationUrl,
          adapterKind: providerAdapterPreset(cfg, videoConfig.providerId)
        },
        model: videoConfig.model,
        prompt,
        aspectRatio: payload.aspectRatio || '16:9',
        durationSeconds: payload.durationSeconds,
        resolution: payload.resolution,
        negativePrompt: payload.negativePrompt,
        seed: payload.seed,
        signal: controller.signal
      });
      const result = await cacheAuthorizedGeneratedVideo(generated, controller.signal);
      return { ok: true, ...result };
    } catch (error) {
      return { error: error.message, code: error.code || undefined };
    } finally {
      if (activeVideoGenerations.get(requestId) === activeRequest) activeVideoGenerations.delete(requestId);
    }
  });

  ipcMain.handle('video:cancel', (_e, requestId) => {
    const id = String(requestId || '').trim();
    const activeRequest = activeVideoGenerations.get(id);
    if (!activeRequest || activeRequest.ownerId !== _e.sender.id) return { ok: false };
    activeRequest.controller.abort();
    return { ok: true };
  });

  ipcMain.handle('image:generated-read', async (_e, assetId) => {
    const asset = getGeneratedImageAsset(assetId);
    if (!asset) return { error: '会话图片已失效，请重新生成' };
    try {
      const buffer = await fsp.readFile(asset.filePath);
      return {
        assetId: asset.assetId,
        path: asset.filePath,
        name: asset.name,
        size: asset.size,
        mimeType: asset.mimeType,
        dataUrl: `data:${asset.mimeType};base64,${buffer.toString('base64')}`
      };
    } catch (error) {
      generatedImages.delete(asset.assetId);
      return { error: error.message };
    }
  });

  function openGeneratedImageViewer(assetId) {
    const asset = getGeneratedImageAsset(assetId);
    if (!asset) return { error: '会话图片已失效，请重新生成' };
    return showImageViewerWindow(asset.assetId, {
      assetId: asset.assetId,
      lang: normalizeLanguage(loadConfig().language)
    });
  }

  ipcMain.handle('image:generated-open', (_e, assetId) => openGeneratedImageViewer(assetId));

  ipcMain.handle('image:generated-download', async (_e, assetId) => {
    const asset = getGeneratedImageAsset(assetId);
    if (!asset) return { error: '会话图片已失效，请重新生成' };
    const owner = windows.fromWebContents(_e.sender);
    const extension = path.extname(asset.name).slice(1).toLowerCase() || 'png';
    const mainWindow = windows.getMainWindow();
    const result = await dialog.showSaveDialog(owner && !owner.isDestroyed() ? owner : mainWindow, {
      title: '下载图片',
      buttonLabel: '下载',
      defaultPath: path.join(app.getPath('downloads'), asset.name),
      filters: [{ name: '图片', extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await fsp.copyFile(asset.filePath, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { error: `下载失败：${error.message}` };
    }
  });

  // User-uploaded attachments preview through the same viewer window. Resolve a
  // local image path with an extension allow-list plus a real-file check, and key
  // the window by path so repeat clicks reuse the already-open viewer.
  async function resolveLocalImageFile(filePath) {
    const target = path.resolve(String(filePath || ''));
    const extension = path.extname(target).slice(1).toLowerCase();
    const mimeType = GENERATED_IMAGE_MIME_BY_EXTENSION[extension];
    if (!mimeType) return null;
    try {
      const stat = await fsp.stat(target);
      if (!stat.isFile() || !stat.size) return null;
      return { path: target, name: path.basename(target), mimeType, size: stat.size };
    } catch {
      return null;
    }
  }

  async function openImageFileViewer(filePath) {
    const file = await resolveLocalImageFile(filePath);
    if (!file) return { error: '图片不可用或格式不支持预览' };
    const key = process.platform === 'win32' ? `file:${file.path.toLowerCase()}` : `file:${file.path}`;
    return showImageViewerWindow(key, {
      file: file.path,
      lang: normalizeLanguage(loadConfig().language)
    });
  }

  ipcMain.handle('image:file-open', (_e, filePath) => openImageFileViewer(filePath));

  ipcMain.handle('image:file-read', async (_e, filePath) => {
    const file = await resolveLocalImageFile(filePath);
    if (!file) return { error: '图片不可用或格式不支持预览' };
    try {
      const buffer = await fsp.readFile(file.path);
      let mimeType = file.mimeType;
      try {
        mimeType = detectImageType(buffer, file.mimeType).mimeType || mimeType;
      } catch {}
      return {
        name: file.name,
        size: file.size,
        mimeType,
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
      };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('image:file-default', async (_e, filePath) => {
    const file = await resolveLocalImageFile(filePath);
    if (!file) return { error: '图片不可用或格式不支持' };
    try {
      const error = await shell.openPath(file.path);
      return error ? { error } : { ok: true };
    } catch (error) { return { error: error.message }; }
  });

  ipcMain.handle('image:file-download', async (_e, filePath) => {
    const file = await resolveLocalImageFile(filePath);
    if (!file) return { error: '图片不可用或格式不支持预览' };
    const owner = windows.fromWebContents(_e.sender);
    const extension = path.extname(file.name).slice(1).toLowerCase() || 'png';
    const mainWindow = windows.getMainWindow();
    const result = await dialog.showSaveDialog(owner && !owner.isDestroyed() ? owner : mainWindow, {
      title: '下载图片',
      buttonLabel: '下载',
      defaultPath: path.join(app.getPath('downloads'), file.name),
      filters: [{ name: '图片', extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await fsp.copyFile(file.path, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { error: `下载失败：${error.message}` };
    }
  });

  ipcMain.handle('file:reveal', async (_e, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
  });
}

module.exports = { registerFilesMediaIpc };
