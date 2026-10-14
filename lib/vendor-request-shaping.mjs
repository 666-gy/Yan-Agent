// Vendor contracts checked against official documentation on 2026-09-19.
// Unknown versions retain their parameters; UI-only receipts never go on wire.
import { aliasWireTools } from './family-provider-tools.mjs';

function prepare(body) {
  const shaped = { ...body };
  delete shaped.reasoningEffortAdjusted;
  return shaped;
}

const bareModel = body => String(body.model || '').toLowerCase().split('/').at(-1);
const effortOf = body => body.reasoningEffort ?? body.reasoning_effort;
const disabled = value => ['none', 'off', 'disabled', 'false'].includes(String(value).toLowerCase());

// Agnes Chat Completions has no reasoning_effort parameter (the FAQ counts
// unknown fields as 400s): flash models take the documented vLLM-style
// thinking toggle, pro models reason unconditionally and document no dial.
export function shapeAgnlRequestBody(body) {
  const shaped = prepare(body);
  const model = bareModel(body);
  if (/^agnes-(?:2\.0|2\.5|3\.0)-flash(?:-|$)/.test(model)) {
    const requested = effortOf(body);
    if (requested != null && shaped.chat_template_kwargs?.enable_thinking == null) {
      shaped.chat_template_kwargs = { ...shaped.chat_template_kwargs, enable_thinking: !disabled(requested) };
    }
  } else if (!/^agnes-(?:2\.5|3\.0)-pro(?:-|$)/.test(model)) {
    return aliasWireTools(shaped);
  }
  delete shaped.reasoningEffort;
  delete shaped.reasoning_effort;
  return aliasWireTools(shaped);
}

export function normalizeAgnlPayload(payload) {
  if (!payload?.usage) return payload;
  const usage = payload.usage;
  return { ...payload, usage: { ...usage,
    prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
    completion_tokens: usage.completion_tokens ?? usage.output_tokens,
    prompt_tokens_details: usage.prompt_tokens_details ?? usage.input_tokens_details,
    completion_tokens_details: usage.completion_tokens_details ?? usage.output_tokens_details
  } };
}

export function shapeGemlRequestBody(body) {
  const shaped = prepare(body);
  const model = bareModel(body);
  const known = /^gemini-(?:2\.5|3(?:\.[0-9]+)?)-(?:pro|flash)(?:-|$)/.test(model);
  if (known) {
    const requested = effortOf(body);
    // Gemini's OpenAI endpoint accepts extra_body.google.thinking_config on
    // the wire. Explicit native control wins over Yan's default effort.
    const native = shaped.extra_body?.google?.thinking_config;
    if (native?.thinking_level != null || native?.thinking_budget != null) {
      delete shaped.reasoning_effort;
    } else if (requested != null) {
      let effort = String(requested).toLowerCase();
      if (['xhigh', 'max'].includes(effort)) effort = 'high';
      if (disabled(effort)) effort = model.startsWith('gemini-2.5-flash') ? 'none' : 'low';
      if (!['none', 'minimal', 'low', 'medium', 'high'].includes(effort)) {
        throw new Error(`GEML: unsupported reasoning effort ${effort}`);
      }
      shaped.reasoning_effort = effort;
    }
    delete shaped.reasoningEffort;
  }
  return aliasWireTools(shaped);
}

export function shapeGrolRequestBody(body) {
  const shaped = prepare(body);
  const model = bareModel(body);
  const mini = /^grok-3-mini(?:-fast)?(?:-\d+|-latest)?$/.test(model);
  const modern = /^grok-4\.(?:5|6)(?:-\d+|-latest)?$/.test(model);
  const fixed = /^grok-4(?:-\d+|-latest)?$/.test(model)
    || /^grok-4(?:\.1)?-fast-reasoning(?:-latest)?$/.test(model);
  if (mini || modern || fixed) {
    for (const key of ['presence_penalty', 'frequency_penalty', 'stop']) delete shaped[key];
    const requested = effortOf(body);
    if (fixed) delete shaped.reasoning_effort;
    else if (requested != null) {
      let effort = String(requested).toLowerCase();
      if (disabled(effort) || effort === 'minimal') effort = 'low';
      if (effort === 'max') effort = 'xhigh';
      if (mini && effort === 'medium') effort = 'high';
      if (!model.startsWith('grok-4.6') && effort === 'xhigh') effort = 'high';
      if (!['low', 'medium', 'high', 'xhigh'].includes(effort)) throw new Error(`GROL: unsupported reasoning effort ${effort}`);
      shaped.reasoning_effort = effort;
    }
    delete shaped.reasoningEffort;
  }
  return aliasWireTools(shaped);
}
