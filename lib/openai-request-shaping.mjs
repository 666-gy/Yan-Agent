'use strict';

// Request-body shaping for real OpenAI models reached through the generic
// OpenAI-compatible channel. Yan's stack was tuned against DeepSeek-style
// gateways, which silently accept parameters official OpenAI endpoints reject:
//   - gpt-5 / o-series only accept max_completion_tokens (not max_tokens)
//   - they reject custom temperature/top_p/penalties entirely
//   - non-reasoning chat models (gpt-4o) reject reasoning_effort
//   - reasoning_effort values are limited to low|medium|high (+minimal) —
//     Yan's xhigh/max UI tiers and mid-station-specific enums 400 otherwise
//   - tool names must match ^[a-zA-Z0-9_-]+$; MCP ids keep '.' alive through
//     sanitizeId, so mcp_default_playwright_* would be rejected
// Shaping is pure and structural: bodies without a target OpenAI model are
// returned as the original reference (zero-cost fast path for DeepSeek/GLM).

const MAX_TOOL_NAME_LENGTH = 64;

const OPENAI_REASONING_MODEL_PATTERN = /^(?:gpt-5|5\.6(?:[.\-_]?(?:sol|terra|luna))?|o[134](?:-pro)?(?:[.\-]|$)|o4-mini(?:[.\-]|$)|codex-mini-latest(?:[.\-]|$))/i;
const OPENAI_CHAT_MODEL_PATTERN = /^gpt-(?:4o|4\.1|4\.5|3\.5|chatgpt-4o)/i;

const REASONING_EFFORT_VALUES = Object.freeze(['low', 'medium', 'high']);

// Sampling controls rejected by reasoning models must be dropped outright; on
// chat models they stay legal and pass through untouched.
const SAMPLING_KEYS = Object.freeze([
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty'
]);

function familyFromModelId(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return '';
  if (OPENAI_REASONING_MODEL_PATTERN.test(id)) return 'openai-reasoning';
  if (OPENAI_CHAT_MODEL_PATTERN.test(id)) return 'openai-chat';
  return '';
}

// Stable rename so a call id stays consistent between the tools[] definition,
// the assistant's historical tool_calls, and the following tool role message.
function sanitizeToolName(name) {
  const raw = String(name || '');
  if (!raw || /^[a-zA-Z0-9_-]{1,64}$/.test(raw)) return raw;
  let cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleaned.length > MAX_TOOL_NAME_LENGTH) {
    // Keep a short deterministic tail so distinct long names cannot collide.
    const suffix = Buffer.from(raw).toString('base64url').replace(/[^a-zA-Z0-9_-]/g, '').slice(-8);
    cleaned = `${cleaned.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length - 1)}_${suffix}`;
  }
  return cleaned;
}

function clampReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (REASONING_EFFORT_VALUES.includes(normalized)) return normalized;
  // Yan's xhigh/max tiers map down; unknown gateway enums play safe at high.
  return 'high';
}

// Deep clones only what shaping rewrites; arrays/objects on untouched paths
// are shared by reference with the input body.
export function shapeOpenAiRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const family = familyFromModelId(body.model);
  if (!family) return body;

  let changed = false;
  const shaped = { ...body };
  const remove = key => {
    if (key in shaped) {
      delete shaped[key];
      changed = true;
    }
  };
  remove('reasoning_effort');

  if (family === 'openai-reasoning') {
    for (const key of SAMPLING_KEYS) remove(key);
    remove('stop');
    remove('seed');
    const effort = clampReasoningEffort(body.reasoningEffort ?? body.reasoning_effort);
    if (effort) {
      shaped.reasoning_effort = effort;
      changed = true;
    }
    if (typeof shaped.max_tokens === 'number') {
      shaped.max_completion_tokens = shaped.max_tokens;
      delete shaped.max_tokens;
      changed = true;
    }
  }

  const renames = new Map();
  if (Array.isArray(shaped.tools)) {
    const tools = shaped.tools.map(tool => {
      const name = typeof tool?.function?.name === 'string' ? tool.function.name : '';
      const clean = sanitizeToolName(name);
      if (!name || clean === name) return tool;
      renames.set(name, clean);
      changed = true;
      return { ...tool, function: { ...tool.function, name: clean } };
    });
    if (renames.size) shaped.tools = tools;
  }

  if (renames.size && Array.isArray(shaped.messages)) {
    // Tool results carry the invoked name in both OpenAI's canonical field
    // and back-compat shapes some mid-stations emit; history tool_calls must
    // be renamed too so call/name references stay consistent.
    const messages = shaped.messages.map(message => {
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
    shaped.messages = messages;
    changed = true;
  }

  return changed ? shaped : body;
}

export async function shapeOpenAiRequest(input, init) {
  const body = init?.body;
  if (typeof body !== 'string' || !body.trimStart().startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('model' in parsed)) return null;
  const shaped = shapeOpenAiRequestBody(parsed);
  if (shaped === parsed) return null;
  return JSON.stringify(shaped);
}
