// Verified against DeepSeek's thinking-mode guide on 2026-10-17.
// Only known V4 models use this policy; custom gateway aliases retain their controls.
export function shapeDeepSeekRequestBody(body) {
  const id = String(body?.model || '').split('/').pop().toLowerCase();
  const flash = /^(?:deepseek-flash|deepseek-v4-flash(?:-vision-exp)?|deepseek-v4\.1-flash(?:-1017)?)$/.test(id);
  if (!flash && id !== 'deepseek-v4-pro') return body;
  const shaped = { ...body };
  const effort = body.reasoning_effort ?? body.reasoningEffort;
  const mapping = { minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'high', max: 'max', ultra: 'max' };
  if (mapping[effort]) shaped.reasoning_effort = mapping[effort];
  delete shaped.reasoningEffort;
  delete shaped.reasoningEffortAdjusted;
  if (body.thinking?.type !== 'disabled') {
    // These controls are ignored in thinking mode. Preserve the caller's effort;
    // choosing max is independent of choosing sampling parameters.
    delete shaped.temperature;
    delete shaped.presence_penalty;
    delete shaped.frequency_penalty;
    if (flash) {
      if (typeof body.top_p === 'number' && Number.isFinite(body.top_p)) {
        shaped.top_p = Math.min(1, Math.max(0.95, body.top_p));
      } else if (body.top_p == null && body.tools?.length) {
        shaped.top_p = 0.95;
      }
    } else delete shaped.top_p;
  } else if (flash) delete shaped.top_p;
  return shaped;
}
