'use strict';
const TOOL = {
  name: 'nested_sessions',
  description: 'Persistent, user-steerable Yan child sessions. dispatch creates 1–4 isolated Git worktree sessions (one level only) and returns immediately; each new child waits behind a start gate until the user confirms a model (or keeps the default), so do not expect it to run immediately. list reads their status/results. suspend arms a durable parent wakeup: after this tool returns, finish your current reply; the host releases the run and resumes this same conversation when all current child jobs settle. Do not poll. integrate applies an explicitly identified finished or interrupted result from its frozen code snapshot, conservatively; inspect and test afterward. Results never imply integrated correctness. Children cannot dispatch. Use request_key to deduplicate dispatch/send. Never integrate an actively edited child.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['operation', 'task_id'], properties: {
    operation: { type: 'string', enum: ['dispatch', 'list', 'send', 'suspend', 'integrate'] },
    task_id: { type: 'string', description: 'Current authoritative run task_id from system context.' },
    request_key: { type: 'string' }, session_id: { type: 'string' }, result_id: { type: 'string' },
    message: { type: 'string' },
    tasks: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false,
      required: ['title', 'prompt'], properties: { title: { type: 'string' }, prompt: { type: 'string' } } } }
  } }
};
module.exports = { TOOL };
