'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requestMediaWithOptionalParameters } = require('../lib/media-request-parameters');

function rejection(message, httpStatus = 400) {
  return Object.assign(new Error(message), { httpStatus });
}

test('retains all parameters when a provider accepts them', async () => {
  const body = { model: 'test', prompt: 'clip', width: 1280, num_frames: 121 };
  let calls = 0;
  const result = await requestMediaWithOptionalParameters(body, ['width', 'num_frames'], async request => {
    calls++;
    assert.deepEqual(request, body);
    return 'created';
  });
  assert.equal(result, 'created');
  assert.equal(calls, 1);
  assert.equal(body.width, 1280);
  assert.equal(body.num_frames, 121);
});

test('removes only explicitly rejected optional fields, one at a time', async () => {
  const body = { model: 'test', prompt: 'clip', width: 1280, num_frames: 121, seed: 0 };
  const requests = [];
  await requestMediaWithOptionalParameters(body, ['width', 'num_frames', 'seed'], async request => {
    requests.push({ ...request });
    if ('width' in request) throw rejection('width is a forbidden field');
    if ('num_frames' in request) throw rejection('num_frames is a forbidden field');
    return 'created';
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[2], { model: 'test', prompt: 'clip', seed: 0 });
});

test('nested and multipart optional parameters can be rejected', async () => {
  const body = { model: 'test', parameters: { size: '1024*1024', n: 1 } };
  await requestMediaWithOptionalParameters(body, ['size', 'parameters.size'], async request => {
    if ('size' in request.parameters) throw rejection('Unknown parameter: "size"', 422);
    return 'created';
  });
  assert.deepEqual(body.parameters, { n: 1 });
  const form = new FormData(); form.set('model', 'test'); form.set('size', 'auto');
  await requestMediaWithOptionalParameters(form, ['size'], async request => {
    if (request.has('size')) throw rejection('Parameter `size` is not supported');
    return 'created';
  });
  assert.equal(form.has('size'), false);
  assert.equal(form.get('model'), 'test');
});

test('recognizes the latest Agnes frame_rate rejection and equivalent explicit refusals', async () => {
  for (const message of [
    'HTTP 400: frame_rate is not an allowed request field (request id: fixture)',
    '"frame_rate" is not a supported request parameter',
    '`frame_rate` is not permitted',
    'frame_rate is not supported'
  ]) {
    const requests = [];
    await requestMediaWithOptionalParameters({ model: 'test', prompt: 'clip', frame_rate: 24, seed: 42 },
      ['frame_rate', 'seed'], async body => {
        requests.push({ ...body });
        if ('frame_rate' in body) throw rejection(message);
        return 'created';
      });
    assert.equal(requests.length, 2, message);
    assert.equal(requests[0].frame_rate, 24);
    assert.deepEqual(requests[1], { model: 'test', prompt: 'clip', seed: 42 });
  }
});

test('required fields, invalid values, unrelated failures and repeated rejections do not retry', async () => {
  for (const error of [rejection('model is a forbidden field'), rejection('field width invalid'),
    rejection('width is a forbidden field', 500), rejection('permission denied'),
    rejection('unknown parameter: absent'), rejection('width is not a valid request field'),
    rejection('width is not an allowed request field', 503), new Error('fetch failed')]) {
    let calls = 0;
    await assert.rejects(requestMediaWithOptionalParameters({ model: 'test', width: 1280 }, ['width'], async () => {
      calls++; throw error;
    }), actual => actual === error);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(requestMediaWithOptionalParameters({ width: 1280 }, ['width'], async () => {
    calls++; throw rejection('width is a forbidden field');
  }));
  assert.equal(calls, 2);
});
