'use strict';

const { parsePlanMarker } = require('./plan');

// Enforce declared dependencies at dispatch and again at child permission
// boundaries. Legacy tasks without a plan retain their existing behavior.
function taskAdmission(records = [], { prompt = '', plan = parsePlanMarker(prompt), callId = '' } = {}) {
  if (!plan) return { granted: true, reason: '' };
  const peers = records.filter(record => !callId || record.callId !== callId);
  if (peers.some(record => record.plan?.id === plan.id && !['completed', 'error', 'failed', 'cancelled'].includes(record.status))) {
    return { granted: false, reason: `duplicate active plan id: ${plan.id}` };
  }
  for (const dependency of plan.dependsOn || []) {
    if (dependency === plan.id) return { granted: false, reason: `self dependency: ${plan.id}` };
    const matches = peers.filter(record => record.plan?.id === dependency);
    const latest = matches.at(-1);
    if (!latest || latest.status !== 'completed' || /state=["']running["']/.test(latest.outputTail || '')) {
      return { granted: false, reason: `dependency ${dependency} has not completed successfully` };
    }
  }
  return { granted: true, reason: '' };
}

// Native task permission metadata carries description/role, not prompt. If
// the running tool SSE was missed, recover its input before granting dispatch.
async function recoverTaskInput(client, { sessionID, directory, callId, signal, timeoutMs = 2000 }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let timer;
  let cancel;
  const cancelled = new Promise(resolve => {
    cancel = () => resolve(null);
    if (controller.signal.aborted) resolve(null);
    else controller.signal.addEventListener('abort', cancel, { once: true });
  });
  timer = setTimeout(abort, timeoutMs);
  try {
    if (controller.signal.aborted) return null;
    return await Promise.race([cancelled, (async () => {
      const response = await client.session.messages({ sessionID, directory }, { signal: controller.signal });
      const messages = response?.data?.messages || response?.data || response?.messages || [];
      if (!Array.isArray(messages)) return null;
      for (const message of [...messages].reverse()) {
        const part = message.parts?.find(part => part.tool === 'task' && (part.callID || part.callId) === callId);
        if (part?.state?.input && typeof part.state.input.prompt === 'string') return part;
      }
      return null;
    })().catch(() => null)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
  }
}

module.exports = { taskAdmission, recoverTaskInput };
