'use strict';

// Provider Adapter seam. Yan Core never parses vendor protocols itself; an
// adapter translates one execution backend (OpenCode today, direct Chat
// Completions / Responses relays tomorrow) into Core lifecycle calls:
//
//   adapter.startTurn(request, onEvent) -> Promise<normalized result>
//   adapter.cancel(turnId)              -> Promise<{ ok }>
//   adapter.healthCheck()               -> Promise<{ ok, detail? }>
//
// onEvent receives raw provider events; Core's mapProviderEvent() owns the
// normalization into Yan Protocol events, and the adapter owns only protocol
// *differences* (finish reasons, usage shapes, tool-call shapes).

class ProviderAdapter {
  constructor(name) {
    if (!name) throw new TypeError('ProviderAdapter requires a name.');
    this.name = String(name);
  }

  get supportsResume() {
    return false;
  }

  // eslint-disable-next-line no-unused-vars
  async startTurn(request, onEvent) {
    throw new Error(`ProviderAdapter "${this.name}" does not implement startTurn().`);
  }

  // eslint-disable-next-line no-unused-vars
  async cancel(turnId) {
    throw new Error(`ProviderAdapter "${this.name}" does not implement cancel().`);
  }

  async healthCheck() {
    return { ok: false, reason: 'not_supported' };
  }

  normalizeUsage(usage = {}) {
    return {
      input: Number(usage?.input) || 0,
      output: Number(usage?.output) || 0,
      reasoning: Number(usage?.reasoning) || 0,
      cacheRead: Number(usage?.cacheRead ?? usage?.cache?.read) || 0,
      cacheWrite: Number(usage?.cacheWrite ?? usage?.cache?.write) || 0,
      cost: Number(usage?.cost) || 0
    };
  }

  // Terminal finish reasons that must not be mistaken for "the model is done
  // talking" — a tool-calls finish means more turns are coming.
  isSettledFinishReason(finishReason) {
    const value = String(finishReason || '').toLowerCase();
    return value !== '' && value !== 'tool-calls' && value !== 'tool_calls' && value !== 'unknown';
  }
}

class OpenCodeProviderAdapter extends ProviderAdapter {
  // `sidecar` is the OpenCodeSidecar instance; any object exposing
  // run()/cancel() with the same shapes works (tests use fakes).
  constructor(sidecar) {
    super('opencode');
    if (!sidecar) throw new TypeError('OpenCodeProviderAdapter requires a sidecar.');
    this.sidecar = sidecar;
  }

  get supportsResume() {
    return true; // OpenCode sessions survive across runs via openCodeSessionId
  }

  async startTurn(request, onEvent) {
    return this.sidecar.run(request, onEvent);
  }

  async cancel(turnId) {
    return this.sidecar.cancel(turnId);
  }

  async healthCheck() {
    if (typeof this.sidecar.status === 'function') {
      try {
        const detail = await this.sidecar.status();
        return { ok: true, detail };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }
    return { ok: Boolean(this.sidecar.client), reason: this.sidecar.client ? '' : 'kernel_not_started' };
  }

  normalizeToolCall(part = {}) {
    return {
      callId: String(part.callID || part.callId || part.id || ''),
      name: String(part.tool || part.name || ''),
      status: String(part.state?.status || part.status || 'pending'),
      output: part.state?.output ?? part.state?.error ?? '',
      ok: String(part.state?.status || part.status || '') === 'completed'
    };
  }
}

const ADAPTER_REGISTRY = new Map();

function registerAdapter(adapter) {
  if (!(adapter instanceof ProviderAdapter)) throw new TypeError('registerAdapter requires a ProviderAdapter.');
  ADAPTER_REGISTRY.set(adapter.name, adapter);
  return adapter;
}

function getAdapter(name) {
  return ADAPTER_REGISTRY.get(String(name || '')) || null;
}

module.exports = {
  ADAPTER_REGISTRY,
  OpenCodeProviderAdapter,
  ProviderAdapter,
  getAdapter,
  registerAdapter
};
