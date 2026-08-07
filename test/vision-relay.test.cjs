'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  describeImages,
  isRecoverableStatus,
  isRecoverableVisionRelayError
} = require('../lib/vision-relay');

test('vision relay accepts an in-memory browser screenshot', async () => {
  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '可见赛车页面，速度为 53 KM/H。' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8 }
      })
    };
  };
  const result = await describeImages({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    modelId: 'vision-test',
    attachments: [{
      name: 'browser.png',
      mimeType: 'image/png',
      data: Buffer.from('browser-pixels').toString('base64')
    }],
    userPrompt: '检查赛车页面',
    fetchImpl
  });
  assert.equal(result.imageCount, 1);
  assert.equal(result.text, '可见赛车页面，速度为 53 KM/H。');
  const imagePart = requestBody.messages[1].content.find(part => part.type === 'image_url');
  assert.equal(imagePart.image_url.url, `data:image/png;base64,${Buffer.from('browser-pixels').toString('base64')}`);
});

test('vision relay accepts Agnes reports returned in reasoning_content', async () => {
  const result = await describeImages({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    modelId: 'agnes-2.0-flash',
    attachments: [{
      name: 'browser.png',
      mimeType: 'image/png',
      data: Buffer.from('browser-pixels').toString('base64')
    }],
    userPrompt: '检查赛车页面',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '', reasoning_content: '可见赛车已经驶离起点。' } }]
      })
    })
  });
  assert.equal(result.text, '可见赛车已经驶离起点。');
});

test('vision relay marks temporary Agnes gateway failures as recoverable', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isRecoverableStatus(status), true);
  for (const status of [400, 401, 404]) assert.equal(isRecoverableStatus(status), false);
  assert.equal(isRecoverableVisionRelayError({ code: 'VISION_RELAY_HTTP_ERROR', status: 502 }), true);
  assert.equal(isRecoverableVisionRelayError({ code: 'VISION_RELAY_HTTP_ERROR', status: 400 }), false);
});
