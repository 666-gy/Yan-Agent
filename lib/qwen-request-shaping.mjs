'use strict';

// Known Qwen contracts; preserve unknown model parameters. Implicit caching
// is the default. Explicit cache markers require an intentional opt-in.
import { aliasWireTools } from './family-provider-tools.mjs';
import qwenProfile from './qwen-model-profile.js';

const { enableThinkingFor, profileFor } = qwenProfile;

function withExplicitCacheMarker(messages) {
  if (messages.some(message => Array.isArray(message?.content) && message.content.some(block => block?.cache_control))) return messages;
  const systemIndex = messages.findLastIndex(message => message?.role === 'system');
  if (systemIndex < 0) return messages;
  const system = messages[systemIndex];
  if (typeof system.content === 'string' && system.content.trim()) {
    const next = [...messages];
    next[systemIndex] = {
      ...system,
      content: [{ type: 'text', text: system.content, cache_control: { type: 'ephemeral' } }]
    };
    return next;
  }
  if (Array.isArray(system.content)) {
    const blockIndex = system.content.findLastIndex(block => block?.type === 'text');
    if (blockIndex < 0) return messages;
    const blocks = [...system.content];
    blocks[blockIndex] = { ...blocks[blockIndex], cache_control: { type: 'ephemeral' } };
    const next = [...messages];
    next[systemIndex] = { ...system, content: blocks };
    return next;
  }
  return messages;
}

export function shapeQwenRequestBody(body, { explicitCache = false, cacheMode = 'implicit' } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const profile = profileFor(body.model);
  if (profile.kind !== 'qwen') return aliasWireTools(body);

  let changed = false;
  const shaped = { ...body };
  if (shaped.reasoningEffortAdjusted !== undefined) { delete shaped.reasoningEffortAdjusted; changed = true; }

  const requested = shaped.reasoningEffort ?? shaped.reasoning_effort;
  const thinking = enableThinkingFor(body.model, requested);
  if (profile.thinkingOnly && shaped.enable_thinking !== undefined) {
    delete shaped.enable_thinking; changed = true;
  } else if (thinking !== null && shaped.enable_thinking === undefined
      && (thinking === false || !profile.defaultThinking)) {
    shaped.enable_thinking = thinking; changed = true;
  }
  if (shaped.reasoningEffort !== undefined) { delete shaped.reasoningEffort; changed = true; }
  if (requested != null && profile.efforts.length && shaped.enable_thinking !== false) {
    const normalized = String(requested).trim().toLowerCase();
    const effort = ['high', 'max'].includes(normalized) ? 'xhigh' : normalized;
    if (!profile.efforts.includes(effort)) throw new Error(`QWEM: unsupported reasoning effort ${normalized} for ${body.model}`);
    if (shaped.reasoning_effort !== effort) { shaped.reasoning_effort = effort; changed = true; }
  } else if (shaped.reasoning_effort !== undefined) { delete shaped.reasoning_effort; changed = true; }

  if ((explicitCache || cacheMode === 'explicit') && profile.explicitCache && Array.isArray(shaped.messages)) {
    const marked = withExplicitCacheMarker(shaped.messages);
    if (marked !== shaped.messages) { shaped.messages = marked; changed = true; }
  }

  return aliasWireTools(changed ? shaped : body);
}

export async function shapeQwenRequest(input, init, options = {}) {
  const body = init?.body;
  if (typeof body !== 'string' || !body.trimStart().startsWith('{')) return null;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return null; }
  const shaped = shapeQwenRequestBody(parsed, options);
  if (shaped === parsed) return null;
  return JSON.stringify(shaped);
}
