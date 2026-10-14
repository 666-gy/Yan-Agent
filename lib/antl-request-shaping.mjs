// ANTL — Anthropic Messages native preset.
//
// Anthropic prompt caching is *explicit*: unlike the implicit server-side
// caches the other adapters meet, nothing is reused until a `cache_control`
// breakpoint is placed on a content block, and the cache only ever matches a
// byte-identical prefix up to that breakpoint. Two consequences drive this
// module:
//
//   1. Breakpoint placement is the entire cache strategy. Placing one on a
//      block that changes every turn caps the hit at that block, which is why
//      the volatile tail is never marked.
//   2. Breakpoint count is capped by the API (4). Marking more is not stronger,
//      it is silently ignored, so the selection here is deliberate and bounded.
//
// Requests arrive already converted to the native Messages shape by
// @ai-sdk/anthropic, which owns keys, roles and content blocks. This module
// therefore only adds declarative metadata and deterministic ordering; it never
// rewrites block content, because doing so would move the cached prefix.
//
// Contract details verified against the installed @ai-sdk/anthropic 3.0.42:
//   - `cache_control` is read from block level and accepts { type:'ephemeral',
//     ttl?:'5m'|'1h' }; more than 4 breakpoints produces a warning and the
//     extra ones are ignored.
//   - The SDK already maps `cache_read_input_tokens` / `cache_creation_input_tokens`
//     into usage.cacheRead / usage.cacheWrite, so correct reporting follows
//     from correct placement.

// The API accepts at most four breakpoints; past that the extras are dropped.
export const MAX_CACHE_BREAKPOINTS = 4;

// Cache TTL is a billing decision, not a correctness one: the default 5m window
// keeps the cheaper write rate, and callers may opt into the 1h window when
// their turn cadence would otherwise let the prefix expire between requests.
const CACHE_TTL_DEFAULT = undefined;
const VALID_TTLS = new Set(['5m', '1h']);

const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const isBlock = value => isObject(value) && typeof value.type === 'string';
const hasCacheControl = block => isObject(block) && block.cache_control != null;

function cacheControl(ttl) {
  return ttl && VALID_TTLS.has(ttl) ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
}

// Determine the message family from the model id. Kept as a predicate rather
// than a roster so a future Fable/Sonnet/Opus version is handled on arrival —
// the wire format is owned by the Messages API, not by the model generation.
const ANTHROPIC_FAMILIES = /(?:^|[/_.-])(?:claude|anthropic)(?:$|[/\d_.-])/i;
const FABLE = /(?:^|[/_.-])fable(?:$|[/\d_.-])/i;
const SONNET = /(?:^|[/_.-])sonnet(?:$|[/\d_.-])/i;
const OPUS = /(?:^|[/_.-])opus(?:$|[/\d_.-])/i;

export function bareAntlModel(model) {
  return String(model || '').toLowerCase().split('/').at(-1) || '';
}

/** True when the id names a Claude/Anthropic model. */
export function isAntlModel(model) {
  return ANTHROPIC_FAMILIES.test(bareAntlModel(model));
}

/**
 * Family of a Claude model id, for capability lookups that legitimately need
 * one. Unknown ids return 'unknown' and are never denied parameters on the
 * strength of the guess alone.
 */
export function antlFamily(model) {
  const bare = bareAntlModel(model);
  if (!isAntlModel(bare)) return 'unknown';
  if (FABLE.test(bare)) return 'fable';
  if (SONNET.test(bare)) return 'sonnet';
  if (OPUS.test(bare)) return 'opus';
  if (/haiku/.test(bare)) return 'haiku';
  return 'unknown';
}

// Deterministic object key order, array order preserved. Two structurally equal
// tool definitions must serialize byte-identically or the cache prefix shifts
// for reasons the model can never see. This is the same guarantee the Chat
// adapters get from stableToolBody, restated for the Messages tool shape.
function orderedKeys(value) {
  if (Array.isArray(value)) return value.map(orderedKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, orderedKeys(value[key])]));
}

/**
 * Sort tool definitions by name and normalize their key order.
 *
 * Parallel MCP discovery can deliver the same tool set in a different order on
 * consecutive turns. Anthropic caches the prefix through the tool block, so an
 * unstable order is a cache miss that looks like a provider problem. Sorting is
 * keyed on the tool name only, so a genuine tool-set change still invalidates
 * the prefix — which is correct, since the tools are part of the prompt.
 */
export function stabilizeAntlTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return tools;
  // Key order is normalized before anything is added, so the cache_control this
  // module attaches lands in the same position on every pass. Marking first and
  // sorting second would make a re-shaped body differ from a once-shaped one by
  // key order alone — invisible in a diff, a cache miss on the wire.
  return tools.map(orderedKeys).sort((a, b) => {
    const x = a?.name ?? '', y = b?.name ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

// Mark the last cacheable block of a message list. Tool results and the newest
// user turn are excluded: the newest turn changes on every request by
// definition, so a breakpoint there is consumed without ever being reused.
function lastStableBlockIndex(blocks) {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (!isBlock(block)) continue;
    if (block.type === 'text' || block.type === 'tool_use') return index;
  }
  return -1;
}

// Attach a breakpoint to one block. The result is normalized, so an attached
// key lands in its sorted position instead of at the end — otherwise a body
// shaped twice would serialize differently from one shaped once, and the cached
// prefix would move for a reason nothing in the conversation explains.
function markBlockAtIndex(blocks, index, control) {
  const next = [...blocks];
  next[index] = orderedKeys({ ...next[index], cache_control: control });
  return next;
}

/**
 * Place cache breakpoints across a native Messages body.
 *
 * Ordering matters: breakpoints are allocated longest-lived prefix first, so
 * the tools and system prompt — the two regions that are stable for the whole
 * session — always get one, while the conversation gets only what remains.
 * Anthropic matches the longest cached prefix, so a hit on an early breakpoint
 * also covers everything before it, which makes early allocation strictly more
 * valuable than late.
 *
 * The volatile tail (the newest user turn) is deliberately left unmarked. It
 * could not be reused anyway, and spending the fourth breakpoint on it would
 * evict the conversation breakpoint that does get reused.
 */
export function placeAntlCacheBreakpoints(body, { ttl, maxBreakpoints = MAX_CACHE_BREAKPOINTS } = {}) {  if (!isObject(body)) return body;
  const limit = Math.max(0, Math.min(MAX_CACHE_BREAKPOINTS, Number(maxBreakpoints) || 0));
  if (limit === 0) return body;
  const control = cacheControl(ttl);

  // A caller who has already placed breakpoints keeps full control; inferring
  // over an explicit choice would fight the user's own cache plan.
  const alreadyPlaced = (Array.isArray(body.tools) && body.tools.some(hasCacheControl))
    || (Array.isArray(body.system) && body.system.some(hasCacheControl))
    || (Array.isArray(body.messages) && body.messages.some(message =>
      Array.isArray(message?.content) && message.content.some(hasCacheControl)));
  if (alreadyPlaced) return body;

  const shaped = { ...body };
  let used = 0;

  // 1. Tools — the largest stable region and the first thing a session reuses.
  if (Array.isArray(body.tools) && body.tools.length && used < limit) {
    // normalize order -> attach the breakpoint -> normalize again, so the
    // attached key lands in its sorted position rather than at the end. The
    // second pass is what makes the output independent of how many times it has
    // been shaped, which is what keeps the cached prefix byte-stable.
    const ordered = stabilizeAntlTools(body.tools) || [...body.tools];
    const marked = [...ordered];
    // `used` is deliberately advanced here rather than relying on the loop
    // below, because a tool-level breakpoint caches the whole tool array.
    marked[marked.length - 1] = { ...marked[marked.length - 1], cache_control: control };
    shaped.tools = stabilizeAntlTools(marked) || marked;
    used++;
  }

  // 2. System prompt — stable for the session, and the region where a change
  //    (rules version, injected context) must invalidate everything after it.
  if (Array.isArray(body.system) && body.system.length && used < limit) {
    const system = [...body.system];
    let index = -1;
    for (let cursor = system.length - 1; cursor >= 0; cursor--) {
      if (isBlock(system[cursor]) && system[cursor].type === 'text') { index = cursor; break; }
    }
    if (index >= 0) {
      shaped.system = markBlockAtIndex(system, index, control);
      used++;
    }
  }

  // 3. Conversation — exactly one breakpoint, on the newest message that can no
  //    longer change. A cached prefix covers everything before it, so marking an
  //    earlier message as well would add no reuse while writing a second cache
  //    entry for the same tokens on every turn.
  if (Array.isArray(body.messages) && body.messages.length && used < limit) {
    const messages = [...body.messages];
    // The final message is the current user turn (or a resumed assistant turn
    // awaiting continuation); neither can be reused by this request.
    for (let index = messages.length - 2; index >= 0; index--) {
      const message = messages[index];
      if (!Array.isArray(message?.content) || !message.content.length) continue;
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const blockIndex = lastStableBlockIndex(message.content);
      if (blockIndex < 0) continue;
      messages[index] = { ...message, content: markBlockAtIndex(message.content, blockIndex, control) };
      used++;
      break;
    }
    shaped.messages = messages;
  }

  return shaped;
}

// Yan carries its own bookkeeping on the request object; it must never reach
// the wire. `reasoningEffortAdjusted` is a UI-only receipt and the sibling
// adapters strip it for the same reason.
function prepare(body) {
  const shaped = { ...body };
  delete shaped.reasoningEffortAdjusted;
  return shaped;
}

const effortOf = body => body.reasoningEffort ?? body.reasoning_effort;
const disabled = value => ['none', 'off', 'disabled', 'false'].includes(String(value).toLowerCase());

// output_config.effort is a closed enum. Yan's own tiers and Anthropic's are
// both words but not the same vocabulary, and an unrecognized value is a 400 —
// not a silent downgrade — so an unknown tier is mapped to the neutral middle
// rather than forwarded. 'none' is not a level here: it means "do not send the
// field", which the caller handles.
const ANTL_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const ANTL_EFFORT_DEFAULT = 'medium';

// 'minimal' is a Yan tier with no Anthropic counterpart; the nearest level that
// still preserves the user's intent of "cheapest that works" is low.
const ANTL_EFFORT_ALIASES = Object.freeze({ minimal: 'low', fastest: 'low' });

function antlEffort(value) {
  const effort = String(value).trim().toLowerCase();
  if (ANTL_EFFORTS.has(effort)) return effort;
  return ANTL_EFFORT_ALIASES[effort] || ANTL_EFFORT_DEFAULT;
}

/**
 * Shape the outbound Messages body for the antl preset.
 *
 * The Messages API is the wire protocol for every current Claude family, so
 * there is no per-version branching to do — model ids differ but the request
 * shape does not. What is adapted here is Yan's vocabulary onto Anthropic's:
 * reasoning effort becomes `output_config.effort`, and the explicit cache
 * breakpoints are placed.
 */
export function shapeAntlRequestBody(body, options = {}) {
  if (!isObject(body)) return body;
  const shaped = prepare(body);

  // Yan expresses reasoning aggressiveness as an effort word. Anthropic exposes
  // the same axis as output_config.effort, and thinking itself is adaptive on
  // current models, so the old-style `thinking` block is not synthesized.
  const requested = effortOf(shaped);
  if (requested !== undefined) {
    delete shaped.reasoningEffort;
    delete shaped.reasoning_effort;
    if (!disabled(requested)) {
      shaped.output_config = { ...shaped.output_config, effort: antlEffort(requested) };
    }
  }

  if (Array.isArray(shaped.tools)) shaped.tools = stabilizeAntlTools(shaped.tools);

  // A caller asking for a TTL must get one. Accepting only `cacheTtl` (a name
  // that exists only in this file) and quietly letting `ttl` fall through to the
  // 5m default would look identical to caching working until a longer session
  // expired mid-conversation. Unrecognized values still fall back safely, but
  // they are not silent about being unrecognized.
  const requestedTtl = options.cacheTtl ?? options.cache_ttl ?? options.ttl;
  if (requestedTtl != null && !VALID_TTLS.has(String(requestedTtl))) {
    throw new Error(`ANTL: unsupported cache TTL ${requestedTtl}`);
  }

  return placeAntlCacheBreakpoints(shaped, {
    ttl: requestedTtl ?? CACHE_TTL_DEFAULT,
    maxBreakpoints: options.cacheBreakpoints ?? MAX_CACHE_BREAKPOINTS
  });
}

/**
 * Reshape a non-streaming Messages response into the Chat-completions envelope
 * the rest of Yan consumes. Only needed when a relay answers a streaming
 * request with a buffered JSON body.
 */
export function normalizeAntlPayload(payload) {
  if (!isObject(payload)) return payload;
  if (!Array.isArray(payload.content)) return payload;
  const text = payload.content.filter(part => part?.type === 'text')
    .map(part => part.text).filter(value => typeof value === 'string').join('');
  const toolCalls = payload.content.filter(part => part?.type === 'tool_use').map(part => ({
    id: part.id, type: 'function',
    function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) }
  }));
  const usage = payload.usage ? {
    prompt_tokens: (payload.usage.input_tokens || 0)
      + (payload.usage.cache_creation_input_tokens || 0)
      + (payload.usage.cache_read_input_tokens || 0),
    completion_tokens: payload.usage.output_tokens || 0,
    prompt_tokens_details: { cached_tokens: payload.usage.cache_read_input_tokens || 0 }
  } : undefined;
  return { ...payload,
    choices: [{ index: 0,
      message: { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: payload.stop_reason === 'tool_use' ? 'tool_calls'
        : payload.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
    ...(usage ? { usage } : {}) };
}

export async function shapeAntlRequest(input, init, options = {}) {
  const body = init?.body;
  if (typeof body !== 'string' || !body.trimStart().startsWith('{')) return null;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return null; }
  const shaped = shapeAntlRequestBody(parsed, options);
  if (shaped === parsed) return null;
  return JSON.stringify(shaped);
}
