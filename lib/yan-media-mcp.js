'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// Keep MCP handshake/list latency independent from optional media runtimes.
// Image/video/vision modules are loaded only when their corresponding tool is
// actually called; this process is started for every OpenCode configuration.
let mediaDependencies;
function getMediaDependencies() {
  return mediaDependencies ||= {
    ...require('./image-generation'),
    ...require('./video-generation'),
    ...require('./vision-relay')
  };
}

const runtime = readRuntime();
const dataDir = path.resolve(String(process.env.YAN_MEDIA_DATA_DIR || process.cwd()));
const imageDir = path.join(dataDir, 'generated-images');
const videoDir = path.join(dataDir, 'generated-videos');
const manifestDir = path.join(dataDir, 'generated-media');
const activeCalls = new Map();

function readRuntime() {
  try {
    const encoded = String(process.env.YAN_MEDIA_RUNTIME || '');
    return encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : {};
  } catch {
    return {};
  }
}

function isAssetId(value) {
  const id = String(value || '');
  if (id.length !== 32) return false;
  for (const character of id) {
    const code = character.charCodeAt(0);
    const digit = code >= 48 && code <= 57;
    const lowerHex = code >= 97 && code <= 102;
    if (!digit && !lowerHex) return false;
  }
  return true;
}

function assertInsideDataDir(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const root = `${dataDir}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('媒体资产路径无效');
  return resolved;
}

function isInsideDirectory(rootPath, filePath) {
  const root = path.resolve(String(rootPath || ''));
  const target = path.resolve(String(filePath || ''));
  const relative = path.relative(root, target);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// The MCP env is config-stable on purpose (per-run values would restart the
// kernel); active-run workspaces arrive through the registry file instead.
function readRegistryWorkspaces() {
  const registryPath = process.env.YAN_MEDIA_WORKSPACE_REGISTRY;
  if (!registryPath) return [];
  try {
    const data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return entries
      .map(entry => String(entry?.workspace || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveLocalImagePath(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请提供图片路径或 generated_image_id');
  const access = runtime.access || {};
  const workspaces = [...new Set([
    String(access.workspace || '').trim(),
    ...readRegistryWorkspaces()
  ].filter(Boolean))];
  const primary = workspaces[0] || '';
  const candidate = path.resolve(path.isAbsolute(raw) ? raw : path.join(primary || process.cwd(), raw));
  const resolved = await fsp.realpath(candidate);
  const resolvedDataDir = await fsp.realpath(dataDir).catch(() => dataDir);
  if (isInsideDirectory(resolvedDataDir, resolved)) return resolved;
  if (String(access.accessMode || '') !== 'full') {
    if (!workspaces.length) throw new Error('当前未选择工作区；请传入 Yan 已生成图片的 generated_image_id，或先选择工作区');
    let insideAny = false;
    for (const workspace of workspaces) {
      const resolvedWorkspace = await fsp.realpath(workspace).catch(() => path.resolve(workspace));
      if (isInsideDirectory(resolvedWorkspace, resolved)) {
        insideAny = true;
        break;
      }
    }
    if (!insideAny) throw new Error('图片不在当前工作区内，无法读取');
  }
  return resolved;
}

async function resolveImageInput(input = {}) {
  const generatedImageId = String(input.generated_image_id || '').trim().toLowerCase();
  if (generatedImageId) {
    const manifest = await readManifest(generatedImageId, 'image');
    if (!manifest.filePath || !fs.existsSync(manifest.filePath)) throw new Error('历史图片文件已经失效');
    return {
      filePath: manifest.filePath,
      name: manifest.name || path.basename(manifest.filePath),
      source: 'generated',
      generatedImageId
    };
  }
  const filePath = await resolveLocalImagePath(input.path);
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error('指定路径不是图片文件');
  const file = await fsp.open(filePath, 'r');
  const header = Buffer.alloc(12);
  try { await file.read(header, 0, header.length, 0); }
  finally { await file.close(); }
  const type = getMediaDependencies().detectImageType(header);
  return { filePath, name: path.basename(filePath), mimeType: type.mimeType, source: 'local', generatedImageId: null };
}

async function readImage(input, signal) {
  const config = runtime.vision || {};
  if (runtime.access?.allowNetwork === false) throw new Error('当前已关闭网络权限，无法使用视觉中继');
  if (runtime.access?.allowFileRead === false) throw new Error('当前已关闭文件读取权限');
  const attempts = Array.isArray(config.models) && config.models.length
    ? config.models
    : [
      { providerId: config.providerId || 'agnes', baseUrl: config.baseUrl, apiKey: config.apiKey, modelId: config.preferredModelId },
      { providerId: config.providerId || 'agnes', baseUrl: config.baseUrl, apiKey: config.apiKey, modelId: config.fallbackModelId }
    ].filter(model => String(model.modelId || '').trim());
  if (!attempts.length) throw new Error('通用读图工具需要先配置可用的视觉中继模型');
  const image = await resolveImageInput(input);
  const prompt = String(input.prompt || '').trim() || '请准确描述图片中的可见内容、文字、界面元素、布局和空间关系。';
  let lastError = null;
  for (const [index, model] of attempts.entries()) {
    const modelId = String(model.modelId || '').trim();
    const baseUrl = String(model.baseUrl || config.baseUrl || '').trim();
    const apiKey = String(model.apiKey || config.apiKey || '').trim();
    if (!modelId || !baseUrl || !apiKey) continue;
    try {
      const result = await getMediaDependencies().describeImages({
        baseUrl,
        apiKey,
        modelId,
        attachments: [{ path: image.filePath, name: image.name, mimeType: image.mimeType }],
        userPrompt: prompt,
        maxTokens: (model.providerId || config.providerId) === 'glm' ? 1024 : 3000,
        signal
      });
      return {
        ok: true,
        message: '图片已读取',
        report: result.text,
        meta: {
          source: image.source,
          generatedImageId: image.generatedImageId,
          observerProvider: model.providerId || config.providerId || 'agnes',
          observerModel: modelId,
          fallback: index > 0,
          imageCount: result.imageCount,
          usage: result.usage || {}
        }
      };
    } catch (error) {
      lastError = error;
      if (getMediaDependencies().isRecoverableVisionRelayError(error) && attempts[index + 1]) continue;
      break;
    }
  }
  throw lastError || new Error('视觉中继未返回读图结果');
}

async function ensureStores() {
  await Promise.all([
    fsp.mkdir(imageDir, { recursive: true }),
    fsp.mkdir(videoDir, { recursive: true }),
    fsp.mkdir(manifestDir, { recursive: true })
  ]);
}

async function writeManifest(manifest) {
  await ensureStores();
  const target = path.join(manifestDir, `${manifest.assetId}.json`);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8');
  await fsp.rename(temporary, target);
}

async function readManifest(assetId, expectedType = '') {
  const id = String(assetId || '').trim().toLowerCase();
  if (!isAssetId(id)) throw new Error('历史媒体资产 ID 无效');
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(path.join(manifestDir, `${id}.json`), 'utf8'));
  } catch {
    if (expectedType === 'image') {
      const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
      const extension = extensions.find(value => fs.existsSync(path.join(imageDir, `${id}.${value}`)));
      if (extension) {
        const filePath = path.join(imageDir, `${id}.${extension}`);
        const stat = await fsp.stat(filePath);
        manifest = {
          assetId: id,
          type: 'image',
          filePath,
          name: `generated_${Math.trunc(stat.mtimeMs)}_${id.slice(0, 6)}.${extension}`,
          createdAt: stat.mtimeMs,
          prompt: ''
        };
      }
    }
    if (!manifest) throw new Error('历史媒体资产不存在或已经失效');
  }
  if (manifest.assetId !== id || (expectedType && manifest.type !== expectedType)) {
    throw new Error(`历史资产不是可用的${expectedType === 'image' ? '图片' : '视频'}`);
  }
  if (manifest.filePath) manifest.filePath = assertInsideDataDir(manifest.filePath);
  return manifest;
}

function normalizePrompt(value) {
  const prompt = String(value || '').trim();
  if (!prompt) throw new Error('生成提示词不能为空');
  if (prompt.length > 4000) throw new Error('生成提示词不能超过 4000 个字符');
  return prompt;
}

async function generateImageAsset(input, signal) {
  const config = runtime.image;
  if (!config) throw new Error('当前没有选择可用的生图模型');
  const prompt = normalizePrompt(input.prompt);
  const sourceAssetId = String(input.source_asset_id || '').trim().toLowerCase();
  let sourceImage = null;
  let sourceManifest = null;
  if (sourceAssetId) {
    sourceManifest = await readManifest(sourceAssetId, 'image');
    if (!sourceManifest.filePath || !fs.existsSync(sourceManifest.filePath)) {
      throw new Error('历史图片文件已经失效');
    }
    const buffer = await fsp.readFile(sourceManifest.filePath);
    const type = getMediaDependencies().detectImageType(buffer);
    sourceImage = { buffer, mimeType: type.mimeType, name: sourceManifest.name || path.basename(sourceManifest.filePath) };
  }
  const result = await getMediaDependencies().generateImage({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    providerId: config.providerId,
    strategy: config.strategy,
    model: config.modelId,
    imageEndpoints: config.imageEndpoints || {},
    providerOptions: config.providerOptions || {},
    prompt,
    aspectRatio: String(input.aspect_ratio || sourceManifest?.aspectRatio || '1:1'),
    sourceImage,
    signal
  });
  await ensureStores();
  const assetId = crypto.randomBytes(16).toString('hex');
  const extension = String(result.extension || 'png').toLowerCase();
  const filePath = path.join(imageDir, `${assetId}.${extension}`);
  const name = `generated_${Date.now()}_${assetId.slice(0, 6)}.${extension}`;
  await fsp.writeFile(filePath, result.buffer);
  const manifest = {
    assetId,
    type: 'image',
    filePath,
    name,
    size: result.buffer.length,
    mimeType: result.mimeType,
    createdAt: Date.now(),
    providerId: config.providerId,
    model: config.modelId,
    prompt,
    aspectRatio: String(input.aspect_ratio || sourceManifest?.aspectRatio || '1:1'),
    sourceAssetId: sourceAssetId || '',
    edited: !!sourceImage
  };
  await writeManifest(manifest);
  return {
    ok: true,
    message: sourceImage ? '图片已基于历史图片完成修改' : '图片已生成',
    meta: {
      mediaType: 'image',
      generatedImageId: assetId,
      name,
      providerId: config.providerId,
      model: config.modelId,
      sourceAssetId: sourceAssetId || null,
      aspectRatio: manifest.aspectRatio,
      edited: !!sourceImage,
      readBackRequired: false
    }
  };
}

function videoExtension(contentType) {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('quicktime')) return 'mov';
  return 'mp4';
}

async function persistVideo(url, assetId, signal, headers = {}) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:') return null;
  const response = await fetch(parsed.href, { signal, headers });
  if (!response.ok || !response.body) return null;
  const declaredSize = Number(response.headers.get('content-length')) || 0;
  if (declaredSize > 512 * 1024 * 1024) return null;
  const extension = videoExtension(response.headers.get('content-type'));
  const filePath = path.join(videoDir, `${assetId}.${extension}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath), { signal });
  const stat = await fsp.stat(filePath);
  return {
    filePath,
    name: `generated_${Date.now()}_${assetId.slice(0, 6)}.${extension}`,
    size: stat.size,
    mimeType: extension === 'webm' ? 'video/webm' : (extension === 'mov' ? 'video/quicktime' : 'video/mp4')
  };
}

async function generateVideoAsset(input, signal) {
  const config = runtime.video;
  if (!config) throw new Error('当前没有选择可用的生视频模型');
  const requestedPrompt = normalizePrompt(input.prompt);
  const sourceAssetId = String(input.source_asset_id || '').trim().toLowerCase();
  const sourceManifest = sourceAssetId ? await readManifest(sourceAssetId, 'video') : null;
  const aspectRatio = String(input.aspect_ratio || sourceManifest?.aspectRatio || '16:9');
  const durationSeconds = Number(input.duration_seconds || sourceManifest?.durationSeconds || 5);
  const resolution = String(input.resolution || sourceManifest?.resolution || '720p');
  const prompt = sourceManifest
    ? [
        'Create a revised version of the previous generated video.',
        `Previous generation brief: ${String(sourceManifest.prompt || '').trim()}`,
        `Requested revision: ${requestedPrompt}`,
        'Preserve every unspecified subject, scene, style, composition, and motion detail from the previous brief.'
      ].join('\n')
    : requestedPrompt;
  const result = await getMediaDependencies().generateVideo({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    providerId: config.providerId,
    providerOptions: config.providerOptions || {},
    model: config.modelId,
    prompt: prompt.slice(0, 4000),
    aspectRatio,
    durationSeconds,
    resolution,
    negativePrompt: String(input.negative_prompt || sourceManifest?.negativePrompt || ''),
    seed: input.seed ?? '',
    signal
  });
  await ensureStores();
  const assetId = crypto.randomBytes(16).toString('hex');
  let stored = null;
  try { stored = await persistVideo(result.url, assetId, signal, result.downloadHeaders || {}); } catch {}
  const manifest = {
    assetId,
    type: 'video',
    filePath: stored?.filePath || '',
    name: stored?.name || `generated_${Date.now()}_${assetId.slice(0, 6)}.mp4`,
    size: stored?.size || 0,
    mimeType: stored?.mimeType || 'video/mp4',
    createdAt: Date.now(),
    providerId: config.providerId,
    model: config.modelId,
    prompt: requestedPrompt,
    effectivePrompt: prompt.slice(0, 4000),
    url: result.url,
    aspectRatio,
    durationSeconds: result.seconds || durationSeconds,
    resolution,
    negativePrompt: String(input.negative_prompt || sourceManifest?.negativePrompt || ''),
    sourceAssetId: sourceAssetId || '',
    revisionMode: sourceManifest ? 'contextual-regeneration' : 'new'
  };
  await writeManifest(manifest);
  return {
    ok: true,
    message: sourceManifest ? '视频已继承上一版设定完成修改' : '视频已生成',
    meta: {
      mediaType: 'video',
      generatedVideoId: assetId,
      generatedVideoUrl: result.url,
      name: manifest.name,
      providerId: config.providerId,
      model: config.modelId,
      sourceAssetId: sourceAssetId || null,
      revisionMode: manifest.revisionMode,
      aspectRatio: manifest.aspectRatio,
      durationSeconds: manifest.durationSeconds,
      resolution
    }
  };
}

function toolDefinitions() {
  const tools = [];
  if (runtime.vision?.enabled !== false) {
    tools.push({
      name: 'read_image',
      description: 'Read visual facts from a local or prior Yan-generated image through the configured GLM-first visual relay when the task actually depends on image contents. Use this for user-provided images, explicit visual analysis or verification, and later tasks with unknown visible details. Do not call it as a routine read-back after generate_image succeeds; generation success already proves completion. Revisions should pass generatedImageId directly to generate_image as source_asset_id. The result is a visual evidence report, not a claim that the primary model directly saw the image.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path, or a path relative to the current Yan workspace.' },
          generated_image_id: { type: 'string', description: 'generatedImageId returned by a previous Yan image generation.' },
          prompt: { type: 'string', description: 'What visual facts should the configured relay inspect or verify.' }
        },
        additionalProperties: false
      }
    });
  }
  if (runtime.image) {
    tools.push({
      name: 'generate_image',
      description: 'Generate an image with the configured secondary image model. Yan Media converts the normal aspect_ratio values into dimensions accepted by the selected model, including models with vendor-specific size lists. A successful result completes generation and must be summarized directly without a routine read_image call. For revisions of an image generated earlier in this Yan conversation, pass its generatedImageId as source_asset_id without reading it first. Never ask the user to download and re-upload a Yan-generated image.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Complete image generation or editing brief.' },
          aspect_ratio: { type: 'string', enum: ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
          source_asset_id: { type: 'string', description: 'Optional generatedImageId from a previous Yan media tool result.' }
        },
        required: ['prompt'],
        additionalProperties: false
      }
    });
  }
  if (runtime.video) {
    tools.push({
      name: 'generate_video',
      description: 'Generate a video with the configured secondary video model. For revisions of a video generated earlier in this Yan conversation, pass its generatedVideoId as source_asset_id so Yan can inherit the prior brief and settings without download or re-upload. After the tool returns, continue the same turn and summarize the result.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Complete new video brief or requested changes.' },
          aspect_ratio: { type: 'string', enum: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
          duration_seconds: { type: 'integer', enum: [3, 5, 10, 18] },
          resolution: { type: 'string', enum: ['480p', '720p', '1080p'] },
          negative_prompt: { type: 'string' },
          seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
          source_asset_id: { type: 'string', description: 'Optional generatedVideoId from a previous Yan media tool result.' }
        },
        required: ['prompt'],
        additionalProperties: false
      }
    });
  }
  return tools;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Media MCP error') } });
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  const controller = new AbortController();
  activeCalls.set(request.id, controller);
  try {
    let result;
    if (name === 'read_image' && runtime.vision?.enabled === false) {
      throw new Error('视觉中继已关闭，图片应由主模型原生读取');
    }
    if (name === 'read_image') result = await readImage(input, controller.signal);
    else if (name === 'generate_image') result = await generateImageAsset(input, controller.signal);
    else if (name === 'generate_video') result = await generateVideoAsset(input, controller.signal);
    else throw new Error(`未知媒体工具：${name}`);
    success(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false
    });
  } catch (error) {
    const result = { ok: false, error: error?.message || String(error) };
    if (error?.code) result.code = String(error.code);
    if (Number.isFinite(Number(error?.status))) result.status = Number(error.status);
    if (error?.providerId) result.providerId = String(error.providerId);
    if (error?.model) result.model = String(error.model);
    success(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: true
    });
  } finally {
    activeCalls.delete(request.id);
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/cancelled') {
    activeCalls.get(message.params?.requestId)?.abort();
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Media', version: '1.0.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    await callTool(message);
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `不支持的方法：${message.method}`);
}

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  let newline = inputBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (line) {
      try { void handle(JSON.parse(line)); }
      catch (error) { process.stderr.write(`[yan-media-mcp] ${error.message}\n`); }
    }
    newline = inputBuffer.indexOf('\n');
  }
});
process.stdin.resume();
