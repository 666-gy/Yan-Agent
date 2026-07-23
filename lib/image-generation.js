'use strict';

const {
  isGptImageGenerationModel,
  isGrokImageGenerationModel
} = require('./model-capabilities');

const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 5 * 60 * 1000;
const AI8_IMAGE_ENDPOINTS = Object.freeze({
  generations: 'https://ai8.my/v1/images/generations',
  edits: 'https://ai8.my/v1/images/edits'
});

function readApiError(payload, fallback) {
  return String(payload?.error?.message || payload?.message || fallback || '图片生成失败').slice(0, 500);
}

function parseGeneratedImagePayload(payload, strategy) {
  if (strategy === 'responses') {
    const call = (payload?.output || []).find(item => item?.type === 'image_generation_call' && item.result);
    if (call?.result) return { base64: call.result, mimeType: 'image/png', revisedPrompt: '' };
  }

  const item = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (item?.b64_json) {
    return {
      base64: item.b64_json,
      mimeType: item.mime_type || item.mimeType || 'image/png',
      revisedPrompt: item.revised_prompt || ''
    };
  }
  if (item?.url) {
    return { url: item.url, mimeType: item.mime_type || item.mimeType || '', revisedPrompt: item.revised_prompt || '' };
  }
  throw new Error('图片接口没有返回可用的图像数据');
}

function detectImageType(buffer, hintedMimeType = '') {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }
  if (hintedMimeType === 'image/jpeg') return { mimeType: 'image/jpeg', extension: 'jpg' };
  throw new Error('图片接口返回了无法识别的文件格式');
}

function imageSizeForAspectRatio(aspectRatio) {
  if (aspectRatio === 'auto') return 'auto';
  if (aspectRatio === '16:9') return '1536x1024';
  if (aspectRatio === '9:16') return '1024x1536';
  return '1024x1024';
}

function resolveImageEndpoint({ baseUrl, providerId, strategy, model, isEdit = false, imageEndpoints = {} }) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  if (strategy === 'responses') return `${root}/responses`;
  const custom = isEdit ? imageEndpoints?.edits : imageEndpoints?.generations;
  if (String(custom || '').trim()) return String(custom).trim();
  const usesAi8Images = root === 'https://ai8.my/v1' && (
    (providerId === 'grok' && isGrokImageGenerationModel(model))
    || (providerId === 'openai' && isGptImageGenerationModel(model))
  );
  if (usesAi8Images) {
    return AI8_IMAGE_ENDPOINTS[isEdit ? 'edits' : 'generations'];
  }
  return `${root}/images/${isEdit ? 'edits' : 'generations'}`;
}

function normalizeImageNetworkError(error, { elapsedMs = 0, isEdit = false } = {}) {
  const causeCode = String(error?.cause?.code || error?.code || '').trim().toUpperCase();
  const message = String(error?.message || '');
  const isFetchFailure = /fetch failed/i.test(message)
    || ['UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(causeCode);
  if (!isFetchFailure) return error;

  const action = isEdit ? '图片编辑' : '图片生成';
  const seconds = Math.max(1, Math.round(Number(elapsedMs) / 1000));
  let detail = '网络连接被中转站或上游服务中断';
  if (causeCode === 'ENOTFOUND') detail = '无法解析中转站地址';
  else if (causeCode === 'UND_ERR_HEADERS_TIMEOUT') detail = '等待中转站响应超时';
  else if (causeCode === 'UND_ERR_BODY_TIMEOUT') detail = '接收中转站响应超时';

  const likelyGatewayTimeout = seconds >= 150 && seconds <= 210;
  const diagnosis = likelyGatewayTimeout
    ? `请求在等待 ${seconds} 秒后断开，接近中转站常见的 180 秒上游超时`
    : `请求在等待 ${seconds} 秒后失败`;
  const normalized = new Error(`${action}失败：${detail}。${diagnosis}；为避免重复扣费，Yan Agent 未自动重试。`);
  normalized.code = likelyGatewayTimeout ? 'IMAGE_GENERATION_UPSTREAM_TIMEOUT' : 'IMAGE_GENERATION_NETWORK_ERROR';
  normalized.causeCode = causeCode || undefined;
  return normalized;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${readApiError(payload, text)}`);
  return payload;
}

async function downloadGeneratedImage(url, fetchImpl, signal) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:') throw new Error('图片接口返回了不安全的下载地址');
  const response = await fetchImpl(parsed.href, { method: 'GET', signal });
  if (!response.ok) throw new Error(`下载生成图片失败：HTTP ${response.status}`);
  const contentLength = Number(response.headers?.get?.('content-length')) || 0;
  if (contentLength > MAX_GENERATED_IMAGE_BYTES) throw new Error('生成图片超过 25MB 限制');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_GENERATED_IMAGE_BYTES) throw new Error('生成图片超过 25MB 限制');
  return { buffer, mimeType: response.headers?.get?.('content-type') || '' };
}

async function generateImage({
  baseUrl,
  apiKey,
  providerId,
  strategy,
  model,
  prompt,
  aspectRatio = '1:1',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
  signal,
  sourceImage,
  imageEndpoints
}) {
  if (!String(apiKey || '').trim()) throw new Error('请先配置 API Key');
  if (!String(prompt || '').trim()) throw new Error('生图提示词不能为空');
  if (!['auto', '1:1', '16:9', '9:16'].includes(aspectRatio)) throw new Error('不支持的图片比例');
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');
  const sourceBuffer = sourceImage?.buffer ? Buffer.from(sourceImage.buffer) : null;
  if (sourceBuffer?.length > 20 * 1024 * 1024) throw new Error('输入图片不能超过 20MB');
  const sourceType = sourceBuffer ? detectImageType(sourceBuffer, sourceImage.mimeType) : null;
  const startedAt = Date.now();

  const controller = new AbortController();
  const externalSignal = signal && typeof signal.addEventListener === 'function' ? signal : null;
  let abortKind = null;
  const abortRequest = (kind) => {
    if (abortKind) return;
    abortKind = kind;
    controller.abort();
  };
  const onExternalAbort = () => abortRequest('cancelled');
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => abortRequest('timeout'), timeoutMs);
  try {
    const isResponses = strategy === 'responses';
    const isGptImageModel = /^gpt-image-/i.test(String(model || ''));
    const isEdit = !!sourceBuffer;
    const endpoint = resolveImageEndpoint({ baseUrl, providerId, strategy, model, isEdit, imageEndpoints });
    let body = isResponses
      ? {
          model,
          input: isEdit
            ? [{
                role: 'user',
                content: [
                  { type: 'input_text', text: String(prompt).trim() },
                  { type: 'input_image', image_url: `data:${sourceType.mimeType};base64,${sourceBuffer.toString('base64')}` }
                ]
              }]
            : String(prompt).trim(),
          tools: [{
            type: 'image_generation',
            size: imageSizeForAspectRatio(aspectRatio),
            ...(isEdit ? { action: 'edit' } : {})
          }]
        }
      : {
          model,
          prompt: String(prompt).trim(),
          n: 1,
          ...(!isGptImageModel ? { response_format: 'b64_json' } : {}),
          ...(providerId === 'grok'
            ? { aspect_ratio: aspectRatio, resolution: '1k' }
            : { size: imageSizeForAspectRatio(aspectRatio) })
        };

    if (!isResponses && isEdit) {
      if (typeof FormData !== 'function' || typeof Blob !== 'function') {
        throw new Error('当前运行环境不支持图片编辑请求');
      }
      const form = new FormData();
      form.append('model', String(model));
      form.append('prompt', String(prompt).trim());
      form.append('n', '1');
      if (!isGptImageModel) form.append('response_format', 'b64_json');
      if (providerId === 'grok') {
        form.append('aspect_ratio', aspectRatio);
        form.append('resolution', '1k');
      } else {
        form.append('size', imageSizeForAspectRatio(aspectRatio));
      }
      form.append(
        'image',
        new Blob([sourceBuffer], { type: sourceType.mimeType }),
        String(sourceImage.name || `input.${sourceType.extension}`)
      );
      body = form;
    }

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(apiKey).trim()}`,
        ...(!isResponses && isEdit ? {} : { 'Content-Type': 'application/json' })
      },
      body: !isResponses && isEdit ? body : JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await readJsonResponse(response);
    const parsed = parseGeneratedImagePayload(payload, strategy);
    let buffer;
    let hintedMimeType = parsed.mimeType;
    if (parsed.base64) {
      buffer = Buffer.from(String(parsed.base64), 'base64');
    } else {
      const downloaded = await downloadGeneratedImage(parsed.url, fetchImpl, controller.signal);
      buffer = downloaded.buffer;
      hintedMimeType = downloaded.mimeType || hintedMimeType;
    }
    if (!buffer.length) throw new Error('图片接口返回了空文件');
    if (buffer.length > MAX_GENERATED_IMAGE_BYTES) throw new Error('生成图片超过 25MB 限制');
    const type = detectImageType(buffer, hintedMimeType);
    return { ...type, buffer, revisedPrompt: parsed.revisedPrompt || '', edited: isEdit };
  } catch (error) {
    if (abortKind === 'cancelled') {
      const cancelled = new Error('图片生成已由用户中止');
      cancelled.code = 'IMAGE_GENERATION_CANCELLED';
      throw cancelled;
    }
    if (abortKind === 'timeout') {
      const suffix = strategy === 'responses'
        ? '当前使用 Responses 生图，中转站可能未实现 /responses 生图；请检查接口支持情况后重试。'
        : '请检查图片接口状态后重试。';
      const timedOut = new Error(`图片生成等待超过 ${Math.ceil(timeoutMs / 60000)} 分钟。${suffix}`);
      timedOut.code = 'IMAGE_GENERATION_TIMEOUT';
      throw timedOut;
    }
    throw normalizeImageNetworkError(error, { elapsedMs: Date.now() - startedAt, isEdit: !!sourceBuffer });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

module.exports = {
  DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
  AI8_IMAGE_ENDPOINTS,
  MAX_GENERATED_IMAGE_BYTES,
  detectImageType,
  generateImage,
  imageSizeForAspectRatio,
  normalizeImageNetworkError,
  parseGeneratedImagePayload,
  resolveImageEndpoint
};
