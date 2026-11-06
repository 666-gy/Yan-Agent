'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');
const { openCodeErrorDetail, combineSystem, combineTurnPrompt } = require('../lib/kernel-policy');

test('high measured input throughput stays distinct from the Skills tool budget', () => {
  const request = { providerId: 'deepseek', modelId: 'deepseek-v4.1-flash', measuredInputTokensPerSecond: 233458 };
  const turn = combineTurnPrompt(request, 'Read the Skill.');
  assert.match(turn, /effective input throughput[^\n]*200000 tokens\/s/);
  assert.match(turn, /input_tokens_per_second=100000/);
  assert.doesNotMatch(turn, /input_tokens_per_second=200000/);
  assert.doesNotMatch(combineSystem(request), /Recent effective input throughput|input_tokens_per_second=100000/);
});

function assistant(id, parts, parentID = 'user') {
  const now = Date.now();
  return {
    info: {
      id,
      parentID,
      role: 'assistant',
      time: { created: now, completed: now },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
    },
    parts
  };
}

function fakeClient(directory, promptHandler, existingSession = null, options = {}) {
  const messages = [...(Array.isArray(options.initialMessages) ? options.initialMessages : [])];
  const calls = { create: [], get: [], update: [], delete: [], prompt: [], promptAsync: [], abort: [] };
  // Like the kernel, `update` answers with the whole session it changed, including
  // one this run just created, not only a session that existed beforehand.
  let current = existingSession;
  const client = {
    session: {
      get: async payload => {
        calls.get.push(payload);
        return { data: existingSession };
      },
      create: async payload => {
        calls.create.push(payload);
        current = { id: 'workspace-session', directory: payload.directory };
        return { data: current };
      },
      update: async payload => {
        calls.update.push(payload);
        return { data: { ...current, permission: payload.permission } };
      },
      delete: async payload => {
        calls.delete.push(payload);
        return { data: true };
      },
      messages: async () => ({ data: messages }),
      status: async () => ({
        data: typeof options.status === 'function'
          ? { 'workspace-session': options.status() }
          : { 'workspace-session': { type: 'idle' } }
      }),
      abort: async payload => {
        calls.abort.push(payload);
        if (typeof options.abort === 'function') options.abort(payload);
        if (options.abortMessage) messages.push(options.abortMessage);
        return { data: true };
      },
      prompt: async payload => {
        calls.prompt.push(payload);
        const routed = assistant(`skill-routing-${calls.prompt.length}`, [{
          type: 'text',
          text: JSON.stringify({ needsSkill: true, query: 'workspace task' })
        }]);
        return { data: routed };
      },
      promptAsync: async payload => {
        calls.promptAsync.push(payload);
        const next = promptHandler(payload, calls.promptAsync.length, messages);
        if (next) messages.push(next);
        return { data: true };
      },
      todo: async () => ({ data: typeof options.todos === 'function' ? options.todos() : (options.todos || []) }),
      diff: async () => ({ data: [] })
    },
    event: {
      subscribe: async () => ({
        stream: (async function* eventStream() {
          for (const event of options.events || []) yield event;
        })()
      })
    }
  };
  return { client, calls, messages, directory };
}

function waitForSignal(signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => signal?.addEventListener('abort', resolve, { once: true }));
}

test('openCodeErrorDetail extracts deep provider error messages', () => {
  const detail = openCodeErrorDetail({
    name: 'UnknownError',
    data: { message: 'The operation timed out.' }
  });
  assert.match(detail, /The operation timed out/);
  assert.equal(openCodeErrorDetail({ message: 'plain' }), 'plain');
});