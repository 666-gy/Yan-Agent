'use strict';

const {
  isAgnesImageGenerationModel,
  isGptImageGenerationModel,
  isGrokImageGenerationModel
} = require('./model-capabilities');

const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 5 * 60 * 1000;
const IMAGE_ASPECT_RATIOS = Object.freeze(['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9']);
const OPENAI_IMAGE_SIZES = Object.freeze({
  auto: 'auto',
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '21:9': '1536x1024'
});
const FLEXIBLE_IMAGE_SIZES = Object.freeze({
  auto: '1024x1024',
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1152x768',
  '2:3': '768x1152',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '21:9': '1344x576'
});
const DOUBAO_IMAGE_SIZES = Object.freeze({
  auto: '1024x1024',
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1248x832',
  '2:3': '832x1248',
  '16:9': '1440x810',
  '9:16': '810x1440',
  '21:9': '1512x648'
});
const GLM_IMAGE_SIZES = Object.freeze({
  auto: '1280x1280',
  '1:1': '1280x1280',
  '4:3': '1472x1088',
  '3:4': '1088x1472',
  '3:2': '1568x1056',
  '2:3': '1056x1568',
  '16:9': '1728x960',
  '9:16': '960x1728',
  '21:9': '1728x960'
});
const GLM_COGVIEW_IMAGE_SIZES = Object.freeze({
  auto: '1024x1024',
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1152x768',
  '2:3': '768x1152',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '21:9': '1344x576'
});
const SILICONFLOW_QWEN_IMAGE_SIZES = Object.freeze({
  auto: '1328x1328',
  '1:1': '1328x1328',
  '4:3': '1472x1140',
  '3:4': '1140x1472',
  '3:2': '1584x1056',
  '2:3': '1056x1584',
  '16:9': '1664x928',
  '9:16': '928x1664',
  '21:9': '1664x928'
});
const AI8_IMAGE_ENDPOINTS = Object.freeze({
  generations: 'https://ai8.my/v1/images/generations',
  edits: 'https://ai8.my/v1/images/edits'
});

function readApiError(payload, fallback) {
  return String(
    payload?.error?.message
    || payload?.base_resp?.status_msg
    || payload?.data?.base_resp?.status_msg
    || payload?.message
    || fallback
    || '图片生成失败'
  ).slice(0, 500);
}

function readMiniMaxPayloadError(payload) {
  const code = payload?.base_resp?.status_code ?? payload?.data?.base_resp?.status_code;
  if (code === undefined || code === null || String(code) === '' || Number(code) === 0) return '';
  return readApiError(payload, `MiniMax 图片接口返回错误码 ${code}`);
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

  const candidates = [
    Array.isArray(payload?.images) ? payload.images[0] : null,
    Array.isArray(payload?.data?.images) ? payload.data.images[0] : null,
    Array.isArray(payload?.data?.image_urls) ? payload.data.image_urls[0] : null,
    Array.isArray(payload?.data?.image_base64) ? payload.data.image_base64[0] : null,
    Array.isArray(payload?.output?.results) ? payload.output.results[0] : null,
    Array.isArray(payload?.output?.choices?.[0]?.message?.content)
      ? payload.output.choices[0].message.content.find(content => content?.image || content?.url)
      : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    const value = typeof candidate === 'string'
      ? candidate
      : candidate.url || candidate.image || candidate.b64_json || candidate.base64 || '';
    if (!value) continue;
    if (String(value).startsWith('https://')) {
      return { url: String(value), mimeType: candidate.mime_type || candidate.mimeType || '', revisedPrompt: '' };
    }
    if (String(value).startsWith('data:')) {
      const comma = String(value).indexOf(',');
      const header = comma >= 0 ? String(value).slice(5, comma) : '';
      const mimeType = header.split(';')[0] || 'image/png';
      return { base64: comma >= 0 ? String(value).slice(comma + 1) : '', mimeType, revisedPrompt: '' };
    }
    return { base64: String(value), mimeType: candidate.mime_type || candidate.mimeType || 'image/png', revisedPrompt: '' };
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
  return OPENAI_IMAGE_SIZES[aspectRatio] || OPENAI_IMAGE_SIZES['1:1'];
}

function imageSizeForProvider(providerId, aspectRatio, model = '') {
  const provider = String(providerId || '').toLowerCase();
  const modelId = String(model || '').toLowerCase();
  if (provider === 'stepfun') {
    const portrait = ['3:4', '2:3', '9:16'].includes(aspectRatio);
    const landscape = ['4:3', '3:2', '16:9', '21:9'].includes(aspectRatio);
    if (modelId === 'step-2x-large') {
      if (portrait) return '800x1280';
      if (landscape) return '1280x800';
      return '1024x1024';
    }
    // step-image-edit-2 defines size as height x width.
    if (portrait) return aspectRatio === '9:16' ? '1360x768' : '1184x896';
    if (landscape) return aspectRatio === '16:9' || aspectRatio === '21:9' ? '768x1360' : '896x1184';
    return '1024x1024';
  }
  if (provider === 'doubao') {
    return DOUBAO_IMAGE_SIZES[aspectRatio] || DOUBAO_IMAGE_SIZES['1:1'];
  }
  if (provider === 'glm' && modelId === 'glm-image') {
    return GLM_IMAGE_SIZES[aspectRatio] || GLM_IMAGE_SIZES['1:1'];
  }
  if (provider === 'glm' && modelId.includes('cogview')) {
    return GLM_COGVIEW_IMAGE_SIZES[aspectRatio] || GLM_COGVIEW_IMAGE_SIZES['1:1'];
  }
  if (provider === 'siliconflow' && modelId.includes('qwen-image')) {
    return SILICONFLOW_QWEN_IMAGE_SIZES[aspectRatio] || SILICONFLOW_QWEN_IMAGE_SIZES['1:1'];
  }
  if (['agnes', 'qwen', 'glm', 'stepfun', 'siliconflow'].includes(provider)) {
    return FLEXIBLE_IMAGE_SIZES[aspectRatio] || FLEXIBLE_IMAGE_SIZES['1:1'];
  }
  return imageSizeForAspectRatio(aspectRatio);
}

function imageAspectRatioForProvider(providerId, aspectRatio) {
  const value = aspectRatio === 'auto' ? '1:1' : aspectRatio;
  if (String(providerId || '').toLowerCase() === 'minimax') return value;
  return aspectRatio;
}

function providerRoot(baseUrl) {
  let root = String(baseUrl || '').trim();
  while (root.endsWith('/')) root = root.slice(0, -1);
  return root;
}

function dashscopeNativeRoot(baseUrl, workspaceId = '') {
  const parsed = new URL(providerRoot(baseUrl));
  const workspace = String(workspaceId || '').trim();
  if (workspace && parsed.hostname === 'dashscope.aliyuncs.com') {
    return `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1`;
  }
  if (workspace && parsed.hostname === 'dashscope-intl.aliyuncs.com') {
    return `https://${workspace}.ap-southeast-1.maas.aliyuncs.com/api/v1`;
  }
  return `${parsed.origin}/api/v1`;
}

function resolveImageEndpoint({ baseUrl, providerId, strategy, model, isEdit = false, imageEndpoints = {}, providerOptions = {} }) {
  const root = providerRoot(baseUrl);
  const provider = String(providerId || '').toLowerCase();
  if (strategy === 'responses') return `${root}/responses`;
  const sharedImageEndpoint = ['agnes', 'qwen', 'minimax', 'doubao', 'siliconflow'].includes(provider);
  const custom = isEdit
    ? (imageEndpoints?.edits || (sharedImageEndpoint ? imageEndpoints?.generations : ''))
    : imageEndpoints?.generations;
  if (String(custom || '').trim()) return String(custom).trim();
  if (provider === 'agnes' && isAgnesImageGenerationModel(model)) {
    const generations = String(imageEndpoints?.generations || '').trim();
    return generations || `${root}/images/generations`;
  }
  const usesAi8Images = root === 'https://ai8.my/v1' && (
    (providerId === 'grok' && isGrokImageGenerationModel(model))
    || (providerId === 'openai' && isGptImageGenerationModel(model))
  );
  if (usesAi8Images) {
    return AI8_IMAGE_ENDPOINTS[isEdit ? 'edits' : 'generations'];
  }
  if (provider === 'qwen') return `${dashscopeNativeRoot(root, providerOptions.workspaceId)}/services/aigc/multimodal-generation/generation`;
  if (provider === 'minimax') return `${root}/image_generation`;
  if (provider === 'siliconflow' || (provider === 'doubao' && isEdit)) return `${root}/images/generations`;
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
  imageEndpoints,
  providerOptions = {}
}) {
  if (!String(apiKey || '').trim()) throw new Error('请先配置 API Key');
  if (!String(prompt || '').trim()) throw new Error('生图提示词不能为空');
  if (!IMAGE_ASPECT_RATIOS.includes(aspectRatio)) throw new Error('不支持的图片比例');
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
    const provider = String(providerId || '').toLowerCase();
    const isResponses = strategy === 'responses';
    const isGptImageModel = /^gpt-image-/i.test(String(model || ''));
    const isAgnesImageModel = String(providerId || '').toLowerCase() === 'agnes'
      && isAgnesImageGenerationModel(model);
    const isAgnesImage21 = isAgnesImageModel && /^agnes-image-2\.1-/i.test(String(model || ''));
    const isEdit = !!sourceBuffer;
    if (isEdit && provider === 'glm') {
      throw new Error('GLM 当前图片适配器不支持参考图编辑');
    }
    const usesMultipart = !isResponses && isEdit && ['openai', 'stepfun'].includes(provider);
    const endpoint = resolveImageEndpoint({ baseUrl, providerId, strategy, model, isEdit, imageEndpoints, providerOptions });
    const promptText = String(prompt).trim();
    const sourceDataUrl = sourceBuffer
      ? `data:${sourceType.mimeType};base64,${sourceBuffer.toString('base64')}`
      : '';
    let body = isResponses
      ? {
          model,
          input: isEdit
            ? [{
                role: 'user',
                content: [
                  { type: 'input_text', text: promptText },
                  { type: 'input_image', image_url: sourceDataUrl }
                ]
              }]
            : promptText,
          tools: [{
            type: 'image_generation',
            size: imageSizeForAspectRatio(aspectRatio),
            ...(isEdit ? { action: 'edit' } : {})
          }]
        }
      : isAgnesImageModel
        ? {
            model,
            prompt: promptText,
            ...(isAgnesImage21
              ? { size: '1K', ratio: aspectRatio === 'auto' ? '1:1' : aspectRatio }
              : { size: imageSizeForProvider(providerId, aspectRatio, model) }),
            extra_body: {
              ...(isEdit
                ? { image: [sourceDataUrl] }
                : {}),
              response_format: 'b64_json'
            }
          }
        : provider === 'qwen'
          ? {
              model,
              input: {
                messages: [{
                  role: 'user',
                  content: [
                    ...(isEdit ? [{ image: sourceDataUrl }] : []),
                    { text: promptText }
                  ]
                }]
              },
              parameters: {
                size: imageSizeForProvider(provider, aspectRatio, model).replace('x', '*'),
                n: 1,
                prompt_extend: true,
                watermark: false
              }
            }
          : provider === 'grok'
            ? {
                model,
                prompt: promptText,
                n: 1,
                aspect_ratio: aspectRatio,
                resolution: '1k',
                ...(isEdit ? { image: { url: sourceDataUrl } } : {})
              }
            : provider === 'minimax'
              ? {
                  model,
                  prompt: promptText,
                  aspect_ratio: imageAspectRatioForProvider(provider, aspectRatio),
                  response_format: 'url',
                  n: 1,
                  ...(isEdit
                    ? { subject_reference: [{ type: 'character', image_file: sourceDataUrl }] }
                    : {})
                }
              : provider === 'siliconflow'
                ? {
                    model,
                    prompt: promptText,
                    ...(!String(model || '').toLowerCase().includes('qwen-image-edit')
                      ? {
                          image_size: imageSizeForProvider(provider, aspectRatio, model),
                          batch_size: 1
                        }
                      : {}),
                    num_inference_steps: 20,
                    guidance_scale: 7.5,
                    ...(isEdit ? { image: sourceDataUrl } : {})
                  }
                : provider === 'glm'
                  ? {
                      model,
                      prompt: promptText,
                      size: imageSizeForProvider(provider, aspectRatio, model)
                    }
                  : provider === 'doubao'
                    ? {
                        model,
                        prompt: promptText,
                        size: imageSizeForProvider(provider, aspectRatio, model),
                        response_format: 'b64_json',
                        watermark: false,
                        ...(isEdit ? { image: sourceDataUrl } : {})
                      }
                    : {
                        model,
                        prompt: promptText,
                        n: 1,
                        ...(!isGptImageModel ? { response_format: 'b64_json' } : {}),
                        size: imageSizeForProvider(provider, aspectRatio, model)
                      };

    if (usesMultipart) {
      if (typeof FormData !== 'function' || typeof Blob !== 'function') {
        throw new Error('当前运行环境不支持图片编辑请求');
      }
      const form = new FormData();
      form.append('model', String(model));
      form.append('prompt', promptText);
      form.append('n', '1');
      if (!isGptImageModel) form.append('response_format', 'b64_json');
      form.append('size', imageSizeForProvider(provider, aspectRatio, model));
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
        ...(provider === 'qwen' && providerOptions.workspaceId
          ? { 'X-DashScope-WorkSpace': String(providerOptions.workspaceId) }
          : {}),
        ...(usesMultipart ? {} : { 'Content-Type': 'application/json' })
      },
      body: usesMultipart ? body : JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await readJsonResponse(response);
    const providerRequestId = String(
      payload?.request_id
      || payload?.requestId
      || response.headers?.get?.('x-request-id')
      || response.headers?.get?.('x-dashscope-request-id')
      || ''
    ).trim();
    if (provider === 'minimax') {
      const payloadError = readMiniMaxPayloadError(payload);
      if (payloadError) throw new Error(payloadError);
    }
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
    return {
      ...type,
      buffer,
      revisedPrompt: parsed.revisedPrompt || '',
      edited: isEdit,
      providerRequestId,
      providerUsage: payload?.usage && typeof payload.usage === 'object'
        ? {
            imageCount: Number(payload.usage.image_count) || 0,
            size: String(payload.usage.size || '')
          }
        : null
    };
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
  IMAGE_ASPECT_RATIOS,
  MAX_GENERATED_IMAGE_BYTES,
  detectImageType,
  generateImage,
  imageSizeForAspectRatio,
  imageSizeForProvider,
  normalizeImageNetworkError,
  parseGeneratedImagePayload,
  resolveImageEndpoint
};
