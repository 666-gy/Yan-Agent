'use strict';

// GPTL request shaping — the OpenAI-family counterpart to
// openai-request-shaping.mjs, but driven by the shared model profile instead
// of a hand-maintained regex list. Every rule below is a documented constraint
// of the endpoint the request is actually sent to:
//
//   Chat Completions
//     - `max_completion_tokens` is the only token cap accepted by reasoning
//       models (o-series / gpt-5+); `max_tokens` is rejected.
//     - Reasoning models reject temperature / top_p / penalties / stop / seed.
//     - Function tools may not be combined with reasoning_effort on the
//       currently shipping 5.6+ families; the profile routes those requests to
//       /responses before they are built (see opencode-gptl-provider.mjs).
//     - Tool names must match ^[a-zA-Z0-9_-]{1,64}$.
//   Responses
//     - `reasoning.effort` must be one of the model's supported values;
//       sending `none` to GPT-6+ is an HTTP 400.
//     - `max_output_tokens` covers reasoning tokens too, so it is capped by the
//       model's declared maximum output.
//
// Shaping is pure and structural: bodies whose model is not a materialized GPT
// profile are returned unchanged (same reference), which keeps the DeepSeek /
// GLM / Claude paths at zero cost.

import gptProfile from './gpt-model-profile.js';
import { createHash } from 'node:crypto';

const {
  clampEffort,
  profileFor,
  sanitizeToolName
} = gptProfile;

const MAX_TOOL_NAME_LENGTH = 64;

const SAMPLING_KEYS = Object.freeze([
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty'
]);

const CHAT_COMPLETIONS_PATH = /\/chat\/completions(?:\?|$)/i;
const RESPONSES_PATH = /\/responses(?:\?|$)/i;

// 'chat' | 'responses' | '' — which wire format a captured request URL targets.
export function gptlRequestFormatFor(url) {
  const value = String(url || '');
  if (CHAT_COMPLETIONS_PATH.test(value)) return 'chat';
  if (RESPONSES_PATH.test(value)) return 'responses';
  return '';
}

function isGptBody(modelId) {
  const kind = profileFor(modelId).kind;
  return kind === 'gpt' || kind === 'o-series' || kind === 'codex' || kind === 'chat';
}

function readProviderEffort(body) {
  const value = body.reasoningEffort ?? body.reasoning_effort;
  return value == null ? null : String(value);
}

// ---------------------------------------------------------------------------
// Tool name round-trip
//
// Chat Completions rejects names outside ^[a-zA-Z0-9_-]{1,64}$. Yan's MCP ids
// can carry dots, so the outbound name is sanitized; the response side restores
// the original name with the map built from the very same tool catalog.
// ---------------------------------------------------------------------------

export function gptlToolAliases(tools) {
  const names = [...new Set((tools || []).map(tool => String(tool?.name || tool?.function?.name || '').trim()).filter(Boolean))].sort();
  const occupied = new Set(names.filter(name => sanitizeToolName(name) === name));
  const aliases = new Map();
  for (const name of names) {
    let clean = sanitizeToolName(name, MAX_TOOL_NAME_LENGTH);
    if (clean === name) continue;
    if (occupied.has(clean)) {
      const hash = createHash('sha256').update(name).digest('hex');
      let attempt = 0;
      do {
        const suffix = `_${hash.slice(0, 12)}_${attempt++}`;
        clean = `${sanitizeToolName(name).slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
      } while (occupied.has(clean));
    }
    occupied.add(clean);
    aliases.set(name, clean);
  }
  return aliases;
}

export function gptlToolNameRestoreMap(tools) {
  const restore = new Map();
  if (!Array.isArray(tools)) return restore;
  for (const [name, clean] of gptlToolAliases(tools)) restore.set(clean, name);
  return restore;
}

export function restoreGptlToolCallName(name, restore) {
  if (!(restore instanceof Map) || !restore.size) return name;
  return restore.get(String(name || '')) || name;
}

// doGenerate(): rewrite tool-call parts of the SDK result.
export function restoreGptlGenerateResult(result, restore) {
  if (!(restore instanceof Map) || !restore.size) return result;
  if (!Array.isArray(result?.content)) return result;
  let changed = false;
  const content = result.content.map(part => {
    if (part?.type !== 'tool-call') return part;
    const restored = restoreGptlToolCallName(part.toolName, restore);
    if (restored === part.toolName) return part;
    changed = true;
    return { ...part, toolName: restored };
  });
  return changed ? { ...result, content } : result;
}

// doStream(): rewrite streamed tool parts.
export function restoreGptlStreamPart(part, restore) {
  if (!(restore instanceof Map) || !restore.size) return part;
  if (part?.type === 'tool-input-start' || part?.type === 'tool-call') {
    const restored = restoreGptlToolCallName(part.toolName, restore);
    if (restored !== part.toolName) return { ...part, toolName: restored };
  }
  return part;
}

// ---------------------------------------------------------------------------
// Chat Completions shaping
// ---------------------------------------------------------------------------

export function shapeGptlChatBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (!isGptBody(body.model)) return body;
  const profile = profileFor(body.model);

  let changed = false;
  const mark = () => { changed = true; };
  const shaped = { ...body };

  const requested = readProviderEffort(body);
  removeKey(shaped, 'reasoningEffort', mark);
  removeKey(shaped, 'reasoning_effort', mark);

  if (profile.reasoning && profile.efforts.length) {
    const resolution = clampEffort(body.model, requested ?? profile.defaultEffort);
    if (resolution.effort) {
      shaped.reasoning_effort = resolution.effort;
      changed = true;
    }
    for (const key of SAMPLING_KEYS) removeKey(shaped, key, mark);
    removeKey(shaped, 'stop', mark);
    removeKey(shaped, 'seed', mark);
    if (typeof shaped.max_tokens === 'number') {
      shaped.max_completion_tokens = shaped.max_tokens;
      delete shaped.max_tokens;
      changed = true;
    }
  } else if (profile.kind === 'chat') {
    // Non-reasoning chat models reject reasoning_effort outright; sampling
    // parameters stay legal and pass through untouched.
    if (requested != null) changed = true;
  } else if (profile.reasoning) {
    // Reasoning models without a ladder (o1-mini class) accept no effort
    // value at all, but still require the rest of the reasoning contract:
    // sampling parameters dropped, token cap renamed.
    for (const key of SAMPLING_KEYS) removeKey(shaped, key, mark);
    removeKey(shaped, 'stop', mark);
    removeKey(shaped, 'seed', mark);
    if (typeof shaped.max_tokens === 'number') {
      shaped.max_completion_tokens = shaped.max_tokens;
      delete shaped.max_tokens;
      changed = true;
    }
  }

  const renames = gptlToolAliases(shaped.tools);
  if (Array.isArray(shaped.tools)) {
    const tools = shaped.tools.map(tool => {
      const name = typeof tool?.function?.name === 'string' ? tool.function.name : '';
      const clean = renames.get(name) || name;
      if (!name || clean === name) return tool;
      renames.set(name, clean);
      changed = true;
      return { ...tool, function: { ...tool.function, name: clean } };
    });
    if (renames.size) shaped.tools = tools;
  }

  if (renames.size && Array.isArray(shaped.messages)) {
    shaped.messages = shaped.messages.map(message => {
      if (!message || typeof message !== 'object') return message;
      let working = message;
      if (message.role === 'tool' && typeof message.name === 'string') {
        const clean = renames.get(message.name);
        if (clean) working = { ...working, name: clean };
      }
      if (Array.isArray(working.tool_calls)) {
        working = {
          ...working,
          tool_calls: working.tool_calls.map(call => {
            const name = typeof call?.function?.name === 'string' ? call.function.name : '';
            const clean = renames.get(name);
            return !clean || !call || typeof call !== 'object'
              ? call
              : { ...call, function: { ...call.function, name: clean } };
          })
        };
      }
      return working;
    });
    changed = true;
  }

  return changed ? shaped : body;
}

function removeKey(target, key, mark) {
  if (key in target) {
    delete target[key];
    mark();
  }
}

export async function shapeGptlRequest(input, init) {
  const url = typeof input === 'string' ? input : String(input?.url || '');
  const format = gptlRequestFormatFor(url);
  if (!format) return null;
  const body = init?.body;
  if (typeof body !== 'string' || !body.trimStart().startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('model' in parsed)) return null;
  const shaped = format === 'responses'
    ? shapeGptlResponsesBody(parsed)
    : shapeGptlChatBody(parsed);
  if (shaped === parsed) return null;
  return JSON.stringify(shaped);
}

// ---------------------------------------------------------------------------
// Responses shaping
// ---------------------------------------------------------------------------

export function shapeGptlResponsesBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (!isGptBody(body.model)) return body;
  const profile = profileFor(body.model);

  let changed = false;
  const shaped = { ...body };

  if (profile.reasoning && profile.efforts.length) {
    const source = shaped.reasoning && typeof shaped.reasoning === 'object' ? shaped.reasoning : null;
    const requested = source?.effort ?? readProviderEffort(body);
    const resolution = clampEffort(body.model, requested ?? profile.defaultEffort);
    const reasoning = { ...(source || {}) };
    if (resolution.effort) {
      if (reasoning.effort !== resolution.effort) {
        reasoning.effort = resolution.effort;
        changed = true;
      }
    } else if ('effort' in reasoning) {
      delete reasoning.effort;
      changed = true;
    }
    // `mode` (standard|pro) and `context` (current_turn|all_turns) only exist on
    // the 5.6+ families; stripping them keeps a downgraded model from 400ing.
    if (!profile.supportsReasoningMode && 'mode' in reasoning) {
      delete reasoning.mode;
      changed = true;
    }
    if (!profile.reasoningContextDefault && 'context' in reasoning) {
      delete reasoning.context;
      changed = true;
    }
    if (changed) shaped.reasoning = reasoning;
  } else if ('reasoning' in shaped) {
    delete shaped.reasoning;
    changed = true;
  }

  removeKey(shaped, 'reasoningEffort', () => { changed = true; });
  removeKey(shaped, 'reasoning_effort', () => { changed = true; });

  // Responses carries the same tool-name contract as Chat Completions in
  // practice; the alias is applied here too so both routes rename alike, and
  // replayed `function_call` items keep matching the declared tool catalog.
  const renames = gptlToolAliases(shaped.tools);
  if (Array.isArray(shaped.tools)) {
    shaped.tools = shaped.tools.map(tool => {
      if (!tool || typeof tool !== 'object' || tool.type !== 'function') return tool;
      const name = typeof tool.name === 'string' ? tool.name : '';
      const clean = renames.get(name) || name;
      if (!name || clean === name) return tool;
      renames.set(name, clean);
      changed = true;
      return { ...tool, name: clean };
    });
  }
  if (renames.size && Array.isArray(shaped.input)) {
    shaped.input = shaped.input.map(item => {
      if (!item || typeof item !== 'object' || item.type !== 'function_call') return item;
      const clean = renames.get(String(item.name || ''));
      return clean ? { ...item, name: clean } : item;
    });
  }

  const maxOutput = Number(shaped.max_output_tokens);
  if (profile.maxOutputTokens && Number.isFinite(maxOutput) && maxOutput > profile.maxOutputTokens) {
    shaped.max_output_tokens = profile.maxOutputTokens;
    changed = true;
  }

  return changed ? shaped : body;
}
