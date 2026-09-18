// Only verified 5.3 variants receive model-specific parameter constraints.
// Future model ids still use GLMM, but retain their own parameter contract.
export function isGlm53(model) {
  return /(?:^|[/\s])glm-5\.3(?:[-:[\s]|$)/i.test(String(model || ''));
}

export function shapeGlmmRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const shaped = { ...body };
  if (isGlm53(body.model)) {
    const effort = body.reasoning_effort;
    shaped.thinking = { clear_thinking: false, ...body.thinking, type: 'enabled' };
    if (body.stream === true && body.tools?.length && body.tool_choice !== 'none' && body.tool_stream == null) {
      shaped.tool_stream = true;
    }
    if (effort === 'medium') shaped.reasoning_effort = 'high';
    else if (effort === 'xhigh') shaped.reasoning_effort = 'max';
    else if (effort == null && body.thinking?.type === 'disabled') shaped.reasoning_effort = 'low';
  }
  // The SDK already serializes reasoning parts as reasoning_content. Preserve
  // their exact bytes. Never fabricate an empty history as a substitute.
  if (Array.isArray(body.messages)) {
    shaped.messages = body.messages.map(message => {
      if (message?.role !== 'assistant' || typeof message.reasoning_content === 'string'
        || typeof message.reasoning !== 'string') return message;
      const { reasoning, ...rest } = message;
      return { ...rest, reasoning_content: reasoning };
    });
  }
  // Yan's mapping receipt is UI metadata, not a GLM API parameter.
  delete shaped.reasoningEffortAdjusted;
  if (body.tool_choice === 'none') {
    delete shaped.tools;
    delete shaped.tool_choice;
  }
  return shaped;
}
