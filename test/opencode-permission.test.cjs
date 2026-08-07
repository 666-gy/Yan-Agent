'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenCodeSidecar } = require('../lib/opencode-sidecar');

function sidecarWithPermissionReply(reply) {
  const sidecar = new OpenCodeSidecar();
  sidecar.client = { permission: { reply } };
  return sidecar;
}

test('permission reply succeeds normally', async () => {
  const calls = [];
  const sidecar = sidecarWithPermissionReply(async payload => {
    calls.push(payload);
    return { data: true };
  });

  const result = await sidecar.replyPermission({
    requestId: 'per_active',
    directory: 'C:\\workspace',
    reply: 'always'
  });

  assert.deepEqual(result, { ok: true, result: true });
  assert.equal(calls[0].requestID, 'per_active');
  assert.equal(calls[0].reply, 'always');
});

test('an already-settled permission reply is idempotent', async () => {
  const sidecar = sidecarWithPermissionReply(async () => ({
    error: {
      name: 'PermissionNotFoundError',
      data: { message: 'Permission request not found: per_stale' }
    }
  }));

  const result = await sidecar.replyPermission({
    requestId: 'per_stale',
    directory: 'C:\\workspace',
    reply: 'always'
  });

  assert.deepEqual(result, { ok: true, stale: true, requestId: 'per_stale' });
});

test('the structured OpenCode permission-not-found response is idempotent', async () => {
  const sidecar = sidecarWithPermissionReply(async () => ({
    error: {
      _tag: 'PermissionNotFoundError',
      requestID: 'per_structured',
      message: ''
    }
  }));

  const result = await sidecar.replyPermission({
    requestId: 'per_structured',
    directory: 'C:\\workspace',
    reply: 'always'
  });

  assert.deepEqual(result, { ok: true, stale: true, requestId: 'per_structured' });
});

test('an SDK-wrapped permission-not-found error is idempotent', async () => {
  const wrapped = new Error('POST /permission/per_wrapped/reply -> 404');
  wrapped.cause = {
    status: 404,
    body: {
      _tag: 'PermissionNotFoundError',
      requestID: 'per_wrapped',
      message: 'Permission request not found: per_wrapped'
    }
  };
  const sidecar = sidecarWithPermissionReply(async () => {
    throw wrapped;
  });

  const result = await sidecar.replyPermission({
    requestId: 'per_wrapped',
    directory: 'C:\\workspace',
    reply: 'always'
  });

  assert.deepEqual(result, { ok: true, stale: true, requestId: 'per_wrapped' });
});

test('permission reply preserves real OpenCode failures', async () => {
  const sidecar = sidecarWithPermissionReply(async () => ({
    error: { message: 'OpenCode server unavailable' }
  }));

  await assert.rejects(
    sidecar.replyPermission({ requestId: 'per_active', directory: 'C:\\workspace', reply: 'once' }),
    /OpenCode permission reply failed: OpenCode server unavailable/
  );
});
