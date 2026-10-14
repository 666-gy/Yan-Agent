'use strict';

// Regression guard for the video generator dispatch: a connection is stored as
// a synthetic `conn-*` provider id and carries its adapter preset separately.
// The generator choice must read that preset, otherwise a supported vendor
// falls through to the "no adapter" branch.

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateVideo, resolveProviderVideoRequest } = require('../lib/video-generation');

const sentinel = new Error('SENTINEL_FETCH_CALLED');
const sentinelFetch = () => Promise.reject(sentinel);

const base = {
  baseUrl: 'https://apihub.agnes-ai.com/v1',
  apiKey: 'test-key',
  model: 'agnes-video-v2.0',
  prompt: 'a test clip',
  aspectRatio: '16:9',
  durationSeconds: 5,
  resolution: '720p'
};

test('Agnes legacy endpoints negotiate explicitly forbidden fields without stripping accepted parameters', async () => {
  const requests = [];
  const response = (payload, status = 200) => ({ ok: status === 200, status,
    headers: { get: () => null }, text: async () => JSON.stringify(payload) });
  const result = await generateVideo({
    ...base, providerId: 'conn-agnes', providerOptions: { adapterKind: 'agnes' },
    model: 'agnes-video-v2.0', seed: 42, pollIntervalMs: 1,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') return response({ status: 'completed', metadata: { url: 'https://example.test/clip.mp4' } });
      const body = JSON.parse(options.body); requests.push(body);
      for (const field of ['width', 'height', 'num_frames', 'frame_rate']) {
        if (field in body) return response({ error: { message: field === 'frame_rate'
          ? 'frame_rate is not an allowed request field (request id: fixture)'
          : `${field} is a forbidden field` } }, 400);
      }
      return response({ video_id: 'fixture-video' });
    }
  });
  assert.equal(requests.length, 5);
  assert.equal(requests[0].width, 1280);
  assert.equal(requests[0].num_frames, 121);
  assert.deepEqual(requests[4], { model: 'agnes-video-v2.0', prompt: base.prompt, seed: 42 });
  assert.equal(result.url, 'https://example.test/clip.mp4');
  assert.equal(result.numFrames, null);
});

test('Agnes 2.5 sends its required text mode and native options and polls with model_name', async () => {
  for (const model of ['agnes-video-2.5', 'agnes-video-2.5-flash']) {
    const requests = [];
    const result = await generateVideo({
      ...base, providerId: 'conn-agnes', providerOptions: { adapterKind: 'agnes' }, model,
      durationSeconds: 10, resolution: '1080p', aspectRatio: '9:16', seed: 42, pollIntervalMs: 1,
      fetchImpl: async (url, options) => {
        let payload;
        if (options.method === 'POST') {
          const body = JSON.parse(options.body); requests.push(body);
          assert.deepEqual(body, { model, prompt: base.prompt, mode: 'text', seconds: '10',
            size: '1080P', aspect_ratio: '9:16', seed: 42 });
          payload = { video_id: 'video-fixture', task_id: 'task-fixture', seconds: '10' };
        } else {
          const parsed = new URL(url);
          assert.equal(parsed.searchParams.get('video_id'), 'video-fixture');
          assert.equal(parsed.searchParams.get('model_name'), model);
          payload = { status: 'completed', seconds: '10', size: '1080P', url: 'https://example.test/clip.mp4' };
        }
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
      }
    });
    assert.equal(requests.length, 1);
    assert.equal(result.seconds, 10);
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    assert.equal(result.frameRate, null);
    assert.equal(result.url, 'https://example.test/clip.mp4');
  }
});

test('Agnes 2.5 maps shared options to supported values and preserves negative prompt intent', async () => {
  let body;
  await assert.rejects(generateVideo({ ...base, providerId: 'agnes', model: 'agnes-video-2.5-flash',
    durationSeconds: 3, resolution: '480p', aspectRatio: '3:2', negativePrompt: 'blurred faces',
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); throw sentinel; }
  }), error => error === sentinel);
  assert.equal(body.mode, 'text');
  assert.equal(body.seconds, '4');
  assert.equal(body.size, '720P');
  assert.equal(body.aspect_ratio, '4:3');
  assert.match(body.prompt, /Avoid: blurred faces/);
  assert.equal(Object.hasOwn(body, 'frame_rate'), false);
  assert.equal(Object.hasOwn(body, 'num_frames'), false);
});

test('Agnes 2.5 retains required mode when a compatible endpoint rejects an optional field', async () => {
  const requests = [];
  await assert.rejects(generateVideo({ ...base, providerId: 'agnes', model: 'agnes-video-2.5-flash',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if ('size' in body) return { ok: false, status: 400, headers: { get: () => null },
        text: async () => JSON.stringify({ error: { message: 'size is a forbidden field' } }) };
      throw sentinel;
    }
  }), error => error === sentinel);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].mode, 'text');
  assert.equal(requests[1].seconds, '5');
  assert.equal(requests[1].aspect_ratio, '16:9');
  assert.equal(Object.hasOwn(requests[1], 'size'), false);
});

test('Agnes providers accepting frame parameters receive the complete original request', async () => {
  let body;
  await assert.rejects(generateVideo({ ...base, providerId: 'agnes', fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body); throw sentinel;
  } }), error => error === sentinel);
  assert.equal(body.width, 1280);
  assert.equal(body.height, 720);
  assert.equal(body.num_frames, 121);
  assert.equal(body.frame_rate, 24);
});

test('other video adapters retain parameters and negotiate only a named rejection', async () => {
  const requests = [];
  const result = await generateVideo({
    ...base, providerId: 'conn-glm', providerOptions: { adapterKind: 'glm' }, model: 'cogvideox-3',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const payload = 'fps' in body
        ? { error: { message: 'fps is a forbidden field' } }
        : { id: 'clip', status: 'completed', metadata: { url: 'https://example.test/clip.mp4' } };
      return { ok: !('fps' in body), status: 'fps' in body ? 400 : 200,
        headers: { get: () => null }, text: async () => JSON.stringify(payload) };
    }
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].fps, 30);
  assert.equal(requests[1].duration, 5);
  assert.equal(requests[1].size, '1280x720');
  assert.equal(requests[1].quality, 'speed');
  assert.equal(Object.hasOwn(requests[1], 'fps'), false);
  assert.equal(result.url, 'https://example.test/clip.mp4');
});

test('a connection preset selects the matching video implementation', async () => {
  await assert.rejects(
    generateVideo({
      ...base,
      providerId: 'conn-mu84yp42-ncca',
      providerOptions: { adapterKind: 'agnes' },
      fetchImpl: sentinelFetch
    }),
    error => error === sentinel
  );
});

test('a literal agnes provider id still selects the agnes implementation', async () => {
  await assert.rejects(
    generateVideo({ ...base, providerId: 'agnes', providerOptions: {}, fetchImpl: sentinelFetch }),
    error => error === sentinel
  );
});

test('the preset wins over a mismatched connection id', async () => {
  await assert.rejects(
    generateVideo({
      ...base,
      providerId: 'conn-glm-connection',
      providerOptions: { adapterKind: 'agnes' },
      fetchImpl: sentinelFetch
    }),
    error => error === sentinel
  );
});

test('an unknown preset is still rejected before any network call', async () => {
  await assert.rejects(
    generateVideo({
      ...base,
      providerId: 'conn-future',
      providerOptions: { adapterKind: 'futurevendor' },
      fetchImpl: sentinelFetch
    }),
    /当前没有 futurevendor 的视频生成适配器/
  );
});

test('known vendor profiles keep their documented create endpoint', () => {
  const request = resolveProviderVideoRequest({
    providerId: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'cogvideox-3',
    prompt: 'x',
    aspectRatio: '16:9',
    durationSeconds: 5,
    resolution: '720p'
  });
  assert.equal(request.createUrl, 'https://open.bigmodel.cn/api/paas/v4/videos/generations');
});
