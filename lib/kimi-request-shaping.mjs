'use strict';

// K3 and K2 have different thinking contracts. Keep assistant reasoning
// intact, and do not project known restrictions onto future model versions.
import { aliasWireTools } from './family-provider-tools.mjs';
import kimiProfile from './kimi-model-profile.js';

const { clampEffort, profileFor } = kimiProfile;

export function shapeKimiRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const profile = profileFor(body.model);
  if (profile.kind !== 'kimi') return aliasWireTools(body);

  let changed = false;
  const shaped = { ...body };
  if (shaped.reasoningEffortAdjusted !== undefined) { delete shaped.reasoningEffortAdjusted; changed = true; }

  const requested = shaped.reasoningEffort ?? shaped.reasoning_effort;
  if (profile.efforts.length) {
    if (requested != null) {
      const resolution = clampEffort(body.model, requested);
      if (resolution.effort && resolution.effort !== shaped.reasoning_effort) {
        shaped.reasoning_effort = resolution.effort;
        changed = true;
      }
    }
  } else if (requested != null) {
    changed = true; // k2.x: no effort surface; the key is stripped below
  }
  if (shaped.reasoningEffort !== undefined) { delete shaped.reasoningEffort; changed = true; }
  if (shaped.reasoning_effort !== undefined && profile.efforts.length && requested == null) {
    delete shaped.reasoning_effort; changed = true;
  } else if (shaped.reasoning_effort !== undefined && !profile.efforts.length) {
    delete shaped.reasoning_effort; changed = true;
  }

  if (profile.stripSampling) {
    for (const key of ['temperature', 'top_p', 'n', 'presence_penalty', 'frequency_penalty']) {
      if (shaped[key] !== undefined) { delete shaped[key]; changed = true; }
    }
  }

  if (profile.major === 3 && shaped.thinking !== undefined) {
    delete shaped.thinking; changed = true;
  }
  if (profile.major === 2) {
    if (shaped.tool_choice === 'required') throw new Error(`KIML: ${body.model} does not support tool_choice=required; use auto or a supported explicit tool choice.`);
    if (profile.thinkingSwitch && requested != null && shaped.thinking === undefined) {
      const off = ['none', 'off', 'disabled', 'false'].includes(String(requested).trim().toLowerCase());
      shaped.thinking = { type: off ? 'disabled' : 'enabled' }; changed = true;
    }
    if (profile.alwaysThinking && shaped.thinking !== undefined) {
      if (shaped.thinking?.type !== 'enabled' || (shaped.thinking.keep != null && shaped.thinking.keep !== 'all')) {
        throw new Error(`KIML: ${body.model} always thinks and preserves thinking; disabling it is not supported.`);
      }
      delete shaped.thinking; changed = true;
    }
  }

  return aliasWireTools(changed ? shaped : body);
}

export async function shapeKimiRequest(input, init) {
  const body = init?.body;
  if (typeof body !== 'string' || !body.trimStart().startsWith('{')) return null;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return null; }
  const shaped = shapeKimiRequestBody(parsed);
  if (shaped === parsed) return null;
  return JSON.stringify(shaped);
}
