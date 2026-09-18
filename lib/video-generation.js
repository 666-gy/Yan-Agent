'use strict';

const DEFAULT_VIDEO_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_VIDEO_POLL_INTERVAL_MS = 10000;
const DEFAULT_VIDEO_QUEUE_RETRY_DELAYS_MS = Object.freeze([4000, 10000]);
const DEFAULT_VIDEO_RATE_LIMIT_DELAYS_MS = Object.freeze([15000, 30000, 60000, 120000]);
const DEFAULT_VIDEO_CREATE_RATE_LIMIT_DELAYS_MS = Object.freeze([61000, 61000]);
const VIDEO_DURATION_FRAMES = Object.freeze({ 3: 81, 5: 121, 10: 241, 18: 441 });
const VIDEO_RESOLUTIONS = Object.freeze(['480p', '720p', '1080p']);
const VIDEO_ASPECT_RATIOS = Object.freeze(['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9']);
const VIDEO_ASPECT_COMPONENTS = Object.freeze({
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:4': [3, 4],
  '3:2': [3, 2],
  '2:3': [2, 3],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '21:9': [21, 9]
});

function readApiError(payload, fallback) {
  return String(
    payload?.error?.message
    || payload?.task?.error?.message
    || payload?.base_resp?.status_msg
    || payload?.data?.base_resp?.status_msg
    || payload?.message
    || payload?.reason
    || fallback
    || '视频生成失败'
  ).slice(0, 500);
}

function readMiniMaxPayloadError(payload) {
  const code = payload?.base_resp?.status_code ?? payload?.data?.base_resp?.status_code;
  if (code === undefined || code === null || String(code) === '' || Number(code) === 0) return '';
  return readApiError(payload, `MiniMax 视频接口返回错误码 ${code}`);
}

async function readJsonResponse(response) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${readApiError(payload, text)}`);
    error.httpStatus = response.status;
    error.payload = payload;
    error.retryAfterMs = readRetryAfterMs(response);
    throw error;
  }
  return payload;
}

function readRetryAfterMs(response) {
  const raw = String(response?.headers?.get?.('retry-after') || '').trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120000, Math.max(1000, seconds * 1000));
  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt)) return 0;
  return Math.min(120000, Math.max(1000, retryAt - Date.now()));
}

function parseRateLimitWindowMs(error) {
  const message = String(error?.message || error?.payload?.message || '');
  const match = message.match(/per\s+(\d+(?:\.\d+)?)\s*(second|minute|hour)s?/i);
  if (!match) return 0;
  const multiplier = { second: 1000, minute: 60000, hour: 3600000 }[match[2].toLowerCase()] || 0;
  return Math.min(10 * 60 * 1000, Math.ceil(Number(match[1]) * multiplier) + 1000);
}

function resolveVideoEndpoints(baseUrl, videoId = '', taskId = '') {
  const root = String(baseUrl || '').trim().replace(/\/$/, '');
  const parsed = new URL(root);
  const create = `${root}/videos`;
  const status = videoId
    ? new URL(`/agnesapi?video_id=${encodeURIComponent(videoId)}`, parsed.origin).href
    : '';
  const compatStatus = taskId
    ? `${root}/videos/${encodeURIComponent(taskId)}`
    : '';
  return { create, status, compatStatus };
}

function videoDimensionsForAspectRatio(aspectRatio, resolution = '720p') {
  const shortEdge = { '480p': 480, '720p': 720, '1080p': 1080 }[resolution] || 720;
  const [widthPart, heightPart] = VIDEO_ASPECT_COMPONENTS[aspectRatio] || VIDEO_ASPECT_COMPONENTS['16:9'];
  const scale = shortEdge / Math.min(widthPart, heightPart);
  return {
    width: Math.round((widthPart * scale) / 2) * 2,
    height: Math.round((heightPart * scale) / 2) * 2
  };
}

function videoFramesForDuration(durationSeconds) {
  return VIDEO_DURATION_FRAMES[Number(durationSeconds)] || 121;
}

function parseVideoId(payload) {
  return String(
    payload?.video_id
    || payload?.request_id
    || payload?.requestId
    || payload?.id
    || payload?.data?.video_id
    || payload?.data?.request_id
    || payload?.data?.requestId
    || payload?.data?.id
    || ''
  ).trim();
}

function parseVideoTaskId(payload) {
  return String(
    payload?.task_id
    || payload?.output?.task_id
    || payload?.data?.task_id
    || payload?.metadata?.task_id
    || ''
  ).trim();
}

function parseVideoStatus(payload) {
  return String(
    payload?.status
    || payload?.task?.status
    || payload?.task_status
    || payload?.output?.task_status
    || payload?.data?.status
    || payload?.data?.task_status
    || payload?.data?.data?.status
    || payload?.metadata?.status
    || ''
  ).trim().toLowerCase();
}

function parseVideoUrl(payload) {
  const outputContent = Array.isArray(payload?.output?.content)
    ? payload.output.content.find(item => item?.video_url || item?.url)
    : null;
  const value = payload?.metadata?.url
    || payload?.data?.metadata?.url
    || payload?.data?.data?.metadata?.url
    || payload?.video?.url
    || payload?.output?.video_url
    || payload?.content?.video_url
    || payload?.content?.url
    || payload?.task?.content?.url
    || outputContent?.video_url
    || outputContent?.url
    || payload?.result?.videos?.[0]?.url
    || payload?.video_result?.[0]?.url
    || payload?.results?.videos?.[0]?.url
    || payload?.data?.videos?.[0]?.url
    || payload?.data?.url
    || payload?.url
    || '';
  if (!value) return '';
  const parsed = new URL(String(value));
  if (parsed.protocol !== 'https:') throw new Error('视频接口返回了不安全的播放地址');
  return parsed.href;
}

function videoProviderRoot(baseUrl) {
  let root = String(baseUrl || '').trim();
  while (root.endsWith('/')) root = root.slice(0, -1);
  return root;
}

function dashscopeVideoRoot(baseUrl, workspaceId = '') {
  const parsed = new URL(videoProviderRoot(baseUrl));
  const workspace = String(workspaceId || '').trim();
  if (workspace && parsed.hostname === 'dashscope.aliyuncs.com') {
    return `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1`;
  }
  if (workspace && parsed.hostname === 'dashscope-intl.aliyuncs.com') {
    return `https://${workspace}.ap-southeast-1.maas.aliyuncs.com/api/v1`;
  }
  return `${parsed.origin}/api/v1`;
}

function minimaxV2Root(baseUrl) {
  const parsed = new URL(videoProviderRoot(baseUrl));
  return `${parsed.origin}/v2`;
}

function openAiVideoSize(aspectRatio) {
  if (aspectRatio === '9:16') return '720x1280';
  if (aspectRatio === '16:9') return '1280x720';
  throw new Error('OpenAI 视频接口当前只支持 16:9 或 9:16');
}

function videoDurationForProvider(providerId, requestedSeconds, model = '') {
  const provider = String(providerId || '').toLowerCase();
  const modelId = String(model || '').toLowerCase();
  if (provider === 'grok') return Math.min(15, Number(requestedSeconds));
  const choices = provider === 'openai'
    ? [4, 8, 12, 16, 20]
    : (provider === 'qwen'
        ? [5, 10, 15]
        : (['glm', 'doubao'].includes(provider)
            ? [5, 10]
            : (provider === 'minimax'
                ? (modelId === 'minimax-h3' ? [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] : [6, 10])
                : [])));
  if (!choices.length) return Number(requestedSeconds);
  return choices.reduce((best, choice) => (
    Math.abs(choice - Number(requestedSeconds)) < Math.abs(best - Number(requestedSeconds)) ? choice : best
  ), choices[0]);
}

function resolveProviderVideoRequest({
  providerId,
  baseUrl,
  model,
  prompt,
  aspectRatio,
  durationSeconds,
  resolution,
  negativePrompt,
  seed,
  providerOptions = {}
}) {
  const provider = String(providerId || '').toLowerCase();
  const root = videoProviderRoot(baseUrl);
  let dimensions = videoDimensionsForAspectRatio(aspectRatio, resolution);
  const providerDuration = videoDurationForProvider(provider, durationSeconds, model);
  const common = {
    model,
    prompt: String(prompt).trim()
  };
  if (provider === 'openai') {
    const size = openAiVideoSize(aspectRatio);
    dimensions = size === '720x1280' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
    return {
      createUrl: `${root}/videos`,
      body: { ...common, seconds: String(providerDuration), size },
      dimensions,
      providerDuration,
      multipart: true
    };
  }
  if (provider === 'grok') {
    return {
      createUrl: `${root}/videos/generations`,
      body: { ...common, aspect_ratio: aspectRatio, duration: providerDuration },
      dimensions,
      providerDuration
    };
  }
  if (provider === 'qwen') {
    return {
      createUrl: `${dashscopeVideoRoot(root, providerOptions.workspaceId)}/services/aigc/video-generation/video-synthesis`,
      body: {
        model,
        input: { prompt: String(prompt).trim() },
        parameters: {
          resolution: String(resolution).toUpperCase(),
          ratio: aspectRatio,
          duration: providerDuration,
          prompt_extend: true,
          watermark: false
        }
      },
      dimensions,
      providerDuration,
      asyncHeader: true
    };
  }
  if (provider === 'glm') {
    return {
      createUrl: `${root}/videos/generations`,
      body: {
        ...common,
        quality: resolution === '1080p' ? 'quality' : 'speed',
        size: `${dimensions.width}x${dimensions.height}`,
        duration: providerDuration,
        fps: 30
      },
      dimensions,
      providerDuration
    };
  }
  if (provider === 'doubao') {
    return {
      createUrl: `${root}/contents/generations/tasks`,
      body: {
        model,
        content: [{ type: 'text', text: String(prompt).trim() }],
        ratio: aspectRatio,
        duration: providerDuration,
        resolution,
        watermark: false
      },
      dimensions,
      providerDuration
    };
  }
  if (provider === 'minimax') {
    const isH3 = String(model || '').toLowerCase() === 'minimax-h3';
    return {
      createUrl: isH3 ? `${minimaxV2Root(root)}/video_generation` : `${root}/video_generation`,
      body: isH3
        ? {
            model,
            content: [{ type: 'text', text: String(prompt).trim() }],
            resolution: resolution === '1080p' ? '2K' : '768P',
            duration: providerDuration,
            ratio: aspectRatio === '3:2' ? '4:3' : (aspectRatio === '2:3' ? '3:4' : aspectRatio),
            aigc_watermark: false
          }
        : {
            ...common,
            duration: providerDuration,
            resolution,
            ...(String(negativePrompt || '').trim() ? { negative_prompt: String(negativePrompt).trim() } : {}),
            ...(String(seed || '').trim() ? { seed: Number(seed) } : {})
          },
      dimensions,
      providerDuration,
      protocol: isH3 ? 'minimax-v2' : 'minimax-v1'
    };
  }
  if (provider === 'siliconflow') {
    dimensions = aspectRatio === '1:1'
      ? { width: 960, height: 960 }
      : (['9:16', '3:4', '2:3'].includes(aspectRatio)
          ? { width: 720, height: 1280 }
          : { width: 1280, height: 720 });
    return {
      createUrl: `${root}/video/submit`,
      body: {
        ...common,
        image_size: `${dimensions.width}x${dimensions.height}`,
        ...(String(negativePrompt || '').trim() ? { negative_prompt: String(negativePrompt).trim() } : {}),
        ...(String(seed || '').trim() ? { seed: Number(seed) } : {})
      },
      dimensions,
      providerDuration
    };
  }
  throw new Error(`当前没有 ${providerId || '该厂商'} 的视频生成适配器`);
}

function resolveProviderVideoStatusRequest(providerId, baseUrl, taskId, protocol = '', providerOptions = {}) {
  const provider = String(providerId || '').toLowerCase();
  const root = videoProviderRoot(baseUrl);
  const encodedId = encodeURIComponent(taskId);
  if (provider === 'openai' || provider === 'grok') {
    return { url: `${root}/videos/${encodedId}`, method: 'GET' };
  }
  if (provider === 'qwen') {
    return { url: `${dashscopeVideoRoot(root, providerOptions.workspaceId)}/tasks/${encodedId}`, method: 'GET' };
  }
  if (provider === 'glm') {
    return { url: `${root}/async-result/${encodedId}`, method: 'GET' };
  }
  if (provider === 'doubao') {
    return { url: `${root}/contents/generations/tasks/${encodedId}`, method: 'GET' };
  }
  if (provider === 'minimax') {
    return protocol === 'minimax-v2'
      ? { url: `${minimaxV2Root(root)}/query/video_generation/${encodedId}`, method: 'GET' }
      : { url: `${root}/query/video_generation?task_id=${encodedId}`, method: 'GET' };
  }
  if (provider === 'siliconflow') {
    return { url: `${root}/video/status`, method: 'POST', body: { requestId: taskId } };
  }
  throw new Error(`当前没有 ${providerId || '该厂商'} 的视频任务查询适配器`);
}

function parseProviderTaskId(providerId, payload) {
  const provider = String(providerId || '').toLowerCase();
  if (provider === 'grok') return String(payload?.request_id || payload?.id || '').trim();
  if (provider === 'qwen') return String(payload?.output?.task_id || payload?.task_id || '').trim();
  if (provider === 'siliconflow') return String(payload?.requestId || payload?.data?.requestId || '').trim();
  return parseVideoTaskId(payload) || parseVideoId(payload);
}

function parseMiniMaxFileId(payload) {
  return String(payload?.file_id || payload?.data?.file_id || payload?.output?.file_id || '').trim();
}

async function resolveMiniMaxDownloadUrl(baseUrl, apiKey, fileId, fetchImpl, signal) {
  if (!fileId) return '';
  const root = videoProviderRoot(baseUrl);
  const response = await fetchImpl(`${root}/files/retrieve?file_id=${encodeURIComponent(fileId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${String(apiKey).trim()}` },
    signal
  });
  const payload = await readJsonResponse(response);
  return parseVideoUrl(payload)
    || String(payload?.file?.download_url || payload?.data?.download_url || payload?.download_url || '').trim();
}

function waitForPoll(ms, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function generateAgnesVideo({
  baseUrl,
  apiKey,
  model,
  prompt,
  aspectRatio = '16:9',
  durationSeconds = 5,
  resolution = '720p',
  negativePrompt = '',
  seed = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_VIDEO_GENERATION_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_VIDEO_POLL_INTERVAL_MS,
  queueRetryDelaysMs = DEFAULT_VIDEO_QUEUE_RETRY_DELAYS_MS,
  rateLimitDelaysMs = DEFAULT_VIDEO_RATE_LIMIT_DELAYS_MS,
  createRateLimitDelaysMs = DEFAULT_VIDEO_CREATE_RATE_LIMIT_DELAYS_MS,
  signal
}) {
  if (!String(apiKey || '').trim()) throw new Error('视频生成需要 API Key，请先在模型设置中配置');
  if (!String(prompt || '').trim()) throw new Error('视频提示词不能为空');
  if (!VIDEO_ASPECT_RATIOS.includes(aspectRatio)) throw new Error('不支持的视频比例');
  if (!Object.hasOwn(VIDEO_DURATION_FRAMES, Number(durationSeconds))) throw new Error('不支持的视频时长');
  if (!VIDEO_RESOLUTIONS.includes(resolution)) throw new Error('不支持的视频分辨率');
  if (String(negativePrompt || '').length > 2000) throw new Error('反向提示词不能超过 2000 个字符');
  const normalizedSeed = String(seed ?? '').trim();
  if (normalizedSeed && (!/^\d+$/.test(normalizedSeed) || Number(normalizedSeed) > 2147483647)) {
    throw new Error('随机种子必须是 0 到 2147483647 之间的整数');
  }
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');

  const controller = new AbortController();
  const externalSignal = signal && typeof signal.addEventListener === 'function' ? signal : null;
  let abortKind = null;
  const abortRequest = kind => {
    if (abortKind) return;
    abortKind = kind;
    controller.abort();
  };
  const onExternalAbort = () => abortRequest('cancelled');
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => abortRequest('timeout'), timeoutMs);
  const headers = {
    Authorization: `Bearer ${String(apiKey).trim()}`,
    'Content-Type': 'application/json'
  };

  try {
    const { width, height } = videoDimensionsForAspectRatio(aspectRatio, resolution);
    const numFrames = videoFramesForDuration(durationSeconds);
    const frameRate = 24;
    const endpoints = resolveVideoEndpoints(baseUrl);
    const createBody = {
      model,
      prompt: String(prompt).trim(),
      width,
      height,
      num_frames: numFrames,
      frame_rate: frameRate,
      ...(String(negativePrompt || '').trim() ? { negative_prompt: String(negativePrompt).trim() } : {}),
      ...(normalizedSeed ? { seed: Number(normalizedSeed) } : {})
    };
    let created;
    let queueRetryCount = 0;
    let createRateLimitRetryCount = 0;
    while (!created) {
      try {
        const response = await fetchImpl(endpoints.create, {
          method: 'POST',
          headers,
          body: JSON.stringify(createBody),
          signal: controller.signal
        });
        created = await readJsonResponse(response);
      } catch (error) {
        if (error.httpStatus === 429) {
          const fallbackDelay = createRateLimitDelaysMs[createRateLimitRetryCount];
          if (!Number.isFinite(fallbackDelay)) {
            const limited = new Error(`Agnes 视频创建接口持续限流（每分钟最多 2 次），已自动等待并重试 ${createRateLimitRetryCount} 次。请稍后再试。`);
            limited.code = 'VIDEO_CREATE_RATE_LIMITED';
            throw limited;
          }
          createRateLimitRetryCount++;
          const retryDelay = Number(error.retryAfterMs)
            || parseRateLimitWindowMs(error)
            || Math.max(1000, Number(fallbackDelay));
          await waitForPoll(retryDelay, controller.signal);
          continue;
        }
        if (error.httpStatus !== 503) throw error;
        const retryDelay = queueRetryDelaysMs[queueRetryCount];
        if (!Number.isFinite(retryDelay)) {
          const busy = new Error(`Agnes 视频队列当前已满（HTTP 503）${queueRetryCount ? `，已自动重试 ${queueRetryCount} 次` : ''}。请稍后再试。`);
          busy.code = 'VIDEO_SERVICE_BUSY';
          throw busy;
        }
        queueRetryCount++;
        await waitForPoll(Math.max(0, retryDelay), controller.signal);
      }
    }
    const videoId = parseVideoId(created);
    const taskId = parseVideoTaskId(created);
    if (!videoId && !taskId) throw new Error('视频接口没有返回 video_id 或 task_id');

    let nextPollDelay = Math.max(1000, Number(pollIntervalMs) || DEFAULT_VIDEO_POLL_INTERVAL_MS);
    let rateLimitCount = 0;
    while (true) {
      await waitForPoll(nextPollDelay, controller.signal);
      nextPollDelay = Math.max(1000, Number(pollIntervalMs) || DEFAULT_VIDEO_POLL_INTERVAL_MS);
      const endpoints = resolveVideoEndpoints(baseUrl, videoId, taskId);
      const statusResponse = await fetchImpl(endpoints.status || endpoints.compatStatus, {
        method: 'GET',
        headers: { Authorization: headers.Authorization },
        signal: controller.signal
      });
      let response = statusResponse;
      if ((statusResponse.status === 404 || statusResponse.status === 405) && endpoints.compatStatus && endpoints.status) {
        response = await fetchImpl(endpoints.compatStatus, {
          method: 'GET',
          headers: { Authorization: headers.Authorization },
          signal: controller.signal
        });
      }
      if (response.status === 429) {
        const retryAfterMs = readRetryAfterMs(response);
        const fallbackDelay = rateLimitDelaysMs[Math.min(rateLimitCount, rateLimitDelaysMs.length - 1)];
        nextPollDelay = retryAfterMs || Math.max(1000, Number(fallbackDelay) || 15000);
        rateLimitCount++;
        continue;
      }
      let statusPayload;
      try {
        statusPayload = await readJsonResponse(response);
      } catch (error) {
        if (error.httpStatus === 503) continue;
        throw error;
      }
      rateLimitCount = 0;
      const status = parseVideoStatus(statusPayload);
      if (['failed', 'error'].includes(status)) {
        throw new Error(readApiError(statusPayload, 'Agnes 视频生成失败'));
      }
      const url = parseVideoUrl(statusPayload);
      if (['completed', 'succeeded', 'success'].includes(status) && url) {
        return {
          videoId: videoId || taskId,
          taskId,
          url,
          model,
          aspectRatio,
          resolution,
          width,
          height,
          numFrames,
          frameRate,
          seconds: Number(statusPayload?.seconds || statusPayload?.data?.seconds) || numFrames / frameRate,
          size: String(statusPayload?.size || statusPayload?.data?.size || '')
        };
      }
      if (['completed', 'succeeded', 'success'].includes(status) && !url) {
        throw new Error('Agnes 视频任务已完成，但响应中没有 metadata.url 播放地址');
      }
    }
  } catch (error) {
    if (abortKind === 'cancelled') {
      const cancelled = new Error('视频生成已由用户中止');
      cancelled.code = 'VIDEO_GENERATION_CANCELLED';
      throw cancelled;
    }
    if (abortKind === 'timeout') {
      const timedOut = new Error(`视频生成等待超过 ${Math.ceil(timeoutMs / 60000)} 分钟，请稍后重试`);
      timedOut.code = 'VIDEO_GENERATION_TIMEOUT';
      throw timedOut;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

function isUnsignedInteger(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  for (const character of text) {
    if (character < '0' || character > '9') return false;
  }
  return true;
}

async function generateProviderVideo({
  baseUrl,
  apiKey,
  providerId,
  providerOptions = {},
  model,
  prompt,
  aspectRatio = '16:9',
  durationSeconds = 5,
  resolution = '720p',
  negativePrompt = '',
  seed = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_VIDEO_GENERATION_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_VIDEO_POLL_INTERVAL_MS,
  signal
}) {
  if (!String(apiKey || '').trim()) throw new Error('请先配置 API Key');
  if (!String(prompt || '').trim()) throw new Error('视频提示词不能为空');
  if (!VIDEO_ASPECT_RATIOS.includes(aspectRatio)) throw new Error('不支持的视频比例');
  if (!Object.hasOwn(VIDEO_DURATION_FRAMES, Number(durationSeconds))) throw new Error('不支持的视频时长');
  if (!VIDEO_RESOLUTIONS.includes(resolution)) throw new Error('不支持的视频分辨率');
  if (String(negativePrompt || '').length > 2000) throw new Error('反向提示词不能超过 2000 个字符');
  const normalizedSeed = String(seed ?? '').trim();
  if (!isUnsignedInteger(normalizedSeed) || Number(normalizedSeed || 0) > 2147483647) {
    throw new Error('随机种子必须是 0 到 2147483647 之间的整数');
  }
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');
  // User-defined connections carry an explicit adapter preset; request shape
  // branches on it instead of the synthetic connection provider id.
  const adapterKind = String(providerOptions?.adapterKind || '').trim().toLowerCase();
  if (adapterKind) providerId = adapterKind;

  const provider = String(providerId || '').toLowerCase();
  const controller = new AbortController();
  const externalSignal = signal && typeof signal.addEventListener === 'function' ? signal : null;
  let abortKind = null;
  const abortRequest = kind => {
    if (abortKind) return;
    abortKind = kind;
    controller.abort();
  };
  const onExternalAbort = () => abortRequest('cancelled');
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => abortRequest('timeout'), timeoutMs);
  const authorization = `Bearer ${String(apiKey).trim()}`;

  try {
    const request = resolveProviderVideoRequest({
      providerId: provider,
      baseUrl,
      model,
      prompt,
      aspectRatio,
      durationSeconds,
      resolution,
      negativePrompt,
      seed: normalizedSeed,
      providerOptions
    });
    if (String(providerOptions.videoGenerationUrl || '').trim()) {
      request.createUrl = String(providerOptions.videoGenerationUrl).trim();
    }
    const createHeaders = {
      Authorization: authorization,
      ...(!request.multipart ? { 'Content-Type': 'application/json' } : {}),
      ...(request.asyncHeader ? { 'X-DashScope-Async': 'enable' } : {}),
      ...(provider === 'qwen' && providerOptions.workspaceId
        ? { 'X-DashScope-WorkSpace': String(providerOptions.workspaceId) }
        : {})
    };
    let createBody;
    if (request.multipart) {
      if (typeof FormData !== 'function') throw new Error('当前运行环境不支持视频 multipart 请求');
      const form = new FormData();
      for (const [key, value] of Object.entries(request.body)) form.append(key, String(value));
      createBody = form;
    } else {
      createBody = JSON.stringify(request.body);
    }
    const createResponse = await fetchImpl(request.createUrl, {
      method: 'POST',
      headers: createHeaders,
      body: createBody,
      signal: controller.signal
    });
    const created = await readJsonResponse(createResponse);
    if (provider === 'minimax') {
      const payloadError = readMiniMaxPayloadError(created);
      if (payloadError) throw new Error(payloadError);
    }
    const taskId = parseProviderTaskId(provider, created);
    if (!taskId) throw new Error('视频接口没有返回任务 ID');

    let statusPayload = created;
    let nextPollDelay = Math.max(1000, Number(pollIntervalMs) || DEFAULT_VIDEO_POLL_INTERVAL_MS);
    while (true) {
      let status = parseVideoStatus(statusPayload);
      let url = parseVideoUrl(statusPayload);
      const failed = ['failed', 'failure', 'fail', 'error', 'cancelled', 'canceled', 'expired'].includes(status);
      const completed = ['done', 'completed', 'succeed', 'succeeded', 'success'].includes(status);
      if (failed) throw new Error(readApiError(statusPayload, `${providerId} 视频生成失败`));

      if (provider === 'minimax' && completed && !url) {
        url = await resolveMiniMaxDownloadUrl(
          baseUrl,
          apiKey,
          parseMiniMaxFileId(statusPayload),
          fetchImpl,
          controller.signal
        );
      }
      if (provider === 'openai' && completed && !url) {
        url = `${videoProviderRoot(baseUrl)}/videos/${encodeURIComponent(taskId)}/content`;
      }
      if ((completed || url) && url) {
        const parsedUrl = new URL(String(url));
        if (parsedUrl.protocol !== 'https:') throw new Error('视频接口返回了不安全的播放地址');
        return {
          videoId: taskId,
          taskId,
          url: parsedUrl.href,
          downloadHeaders: provider === 'openai' ? { Authorization: authorization } : undefined,
          model,
          providerId: provider,
          aspectRatio,
          resolution,
          width: request.dimensions.width,
          height: request.dimensions.height,
          numFrames: Math.round(request.providerDuration * 24),
          frameRate: 24,
          seconds: request.providerDuration,
          size: `${request.dimensions.width}x${request.dimensions.height}`
        };
      }

      await waitForPoll(nextPollDelay, controller.signal);
      nextPollDelay = Math.max(1000, Number(pollIntervalMs) || DEFAULT_VIDEO_POLL_INTERVAL_MS);
      const statusRequest = resolveProviderVideoStatusRequest(
        provider,
        baseUrl,
        taskId,
        request.protocol,
        providerOptions
      );
      const statusResponse = await fetchImpl(statusRequest.url, {
        method: statusRequest.method,
        headers: {
          Authorization: authorization,
          ...(statusRequest.body ? { 'Content-Type': 'application/json' } : {}),
          ...(provider === 'qwen' && providerOptions.workspaceId
            ? { 'X-DashScope-WorkSpace': String(providerOptions.workspaceId) }
            : {})
        },
        ...(statusRequest.body ? { body: JSON.stringify(statusRequest.body) } : {}),
        signal: controller.signal
      });
      if (statusResponse.status === 429) {
        nextPollDelay = readRetryAfterMs(statusResponse) || 15000;
        continue;
      }
      statusPayload = await readJsonResponse(statusResponse);
      if (provider === 'minimax') {
        const payloadError = readMiniMaxPayloadError(statusPayload);
        if (payloadError) throw new Error(payloadError);
      }
    }
  } catch (error) {
    if (abortKind === 'cancelled') {
      const cancelled = new Error('视频生成已由用户中止');
      cancelled.code = 'VIDEO_GENERATION_CANCELLED';
      throw cancelled;
    }
    if (abortKind === 'timeout') {
      const timedOut = new Error(`视频生成等待超过 ${Math.ceil(timeoutMs / 60000)} 分钟，请稍后重试`);
      timedOut.code = 'VIDEO_GENERATION_TIMEOUT';
      throw timedOut;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

function generateVideo(options = {}) {
  const provider = String(options.providerId || 'agnes').toLowerCase();
  return provider === 'agnes'
    ? generateAgnesVideo(options)
    : generateProviderVideo(options);
}

module.exports = {
  DEFAULT_VIDEO_GENERATION_TIMEOUT_MS,
  DEFAULT_VIDEO_CREATE_RATE_LIMIT_DELAYS_MS,
  DEFAULT_VIDEO_POLL_INTERVAL_MS,
  DEFAULT_VIDEO_QUEUE_RETRY_DELAYS_MS,
  DEFAULT_VIDEO_RATE_LIMIT_DELAYS_MS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATION_FRAMES,
  VIDEO_RESOLUTIONS,
  generateAgnesVideo,
  generateVideo,
  generateProviderVideo,
  parseVideoId,
  parseVideoTaskId,
  parseVideoStatus,
  parseVideoUrl,
  parseRateLimitWindowMs,
  readRetryAfterMs,
  resolveVideoEndpoints,
  resolveProviderVideoRequest,
  resolveProviderVideoStatusRequest,
  videoDimensionsForAspectRatio,
  videoDurationForProvider,
  videoFramesForDuration
};
