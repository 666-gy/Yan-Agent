'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  generateImage,
  imageSizeForProvider,
  isSenseNovaImageModel
} = require('../lib/image-generation');

const PNG_HEADER_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]).toString('base64');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload)
  };
}

test('SenseNova model names use vendor-valid sizes behind an OpenAI connection', () => {
  assert.equal(isSenseNovaImageModel('openai', 'sensenova-u1-fast'), true);
  assert.deepEqual(
    ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9']
      .map(aspect => imageSizeForProvider('openai', aspect, 'sensenova-u1-fast')),
    [
      '2048x2048',
      '2368x1760',
      '1760x2368',
      '2496x1664',
      '1664x2496',
      '2752x1536',
      '1536x2752',
      '3072x1376'
    ]
  );
});

test('generateImage applies SenseNova mapping before sending a normal ratio request', async () => {
  const requests = [];
  const result = await generateImage({
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    providerId: 'conn-sensenova',
    providerOptions: { adapterKind: 'openai' },
    model: 'sensenova-u1-fast',
    prompt: 'a test image',
    aspectRatio: '16:9',
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse({ data: [{ b64_json: PNG_HEADER_BASE64 }] });
    }
  });

  assert.equal(result.mimeType, 'image/png');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].size, '2752x1536');
  assert.equal(requests[0].model, 'sensenova-u1-fast');
});

test('image provider errors retain correction context without forcing an unretryable result', async () => {
  await assert.rejects(
    generateImage({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      providerId: 'openai',
      model: 'sensenova-u1-fast',
      prompt: 'a test image',
      aspectRatio: '1:1',
      fetchImpl: async () => jsonResponse({ error: { message: 'field Size invalid' } }, 400)
    }),
    error => {
      assert.equal(error.code, 'IMAGE_GENERATION_INVALID_REQUEST');
      assert.equal(error.status, 400);
      assert.match(error.message, /field Size invalid/);
      assert.match(error.message, /2048x2048/);
      assert.equal(Object.prototype.hasOwnProperty.call(error, 'retryable'), false);
      return true;
    }
  );
});

test('image generation negotiates a rejected response format while retaining accepted options', async () => {
  const requests = [];
  const result = await generateImage({
    baseUrl: 'https://example.test/v1', apiKey: 'test-key', providerId: 'openai',
    model: 'sensenova-u1-fast', prompt: 'test image', aspectRatio: '16:9',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return 'response_format' in body
        ? jsonResponse({ error: { message: 'response_format is a forbidden field' } }, 400)
        : jsonResponse({ data: [{ b64_json: PNG_HEADER_BASE64 }] });
    }
  });
  assert.equal(result.mimeType, 'image/png');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format, 'b64_json');
  assert.deepEqual(requests[1], { model: 'sensenova-u1-fast', prompt: 'test image', n: 1, size: '2752x1536' });
});

test('image editing negotiates multipart options without removing the source image', async () => {
  const requests = [];
  await generateImage({
    baseUrl: 'https://example.test/v1', apiKey: 'test-key', providerId: 'openai',
    model: 'gpt-image-1', prompt: 'edit image', sourceImage: { buffer: Buffer.from(PNG_HEADER_BASE64, 'base64') },
    fetchImpl: async (_url, options) => {
      const body = options.body;
      requests.push({ size: body.get('size'), imageSize: body.get('image').size, prompt: body.get('prompt'), model: body.get('model') });
      return body.has('size')
        ? jsonResponse({ error: { message: 'size is a forbidden field' } }, 400)
        : jsonResponse({ data: [{ b64_json: PNG_HEADER_BASE64 }] });
    }
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].size, null);
  assert.equal(requests[1].imageSize, 8);
  assert.equal(requests[1].prompt, 'edit image');
  assert.equal(requests[1].model, 'gpt-image-1');
});
