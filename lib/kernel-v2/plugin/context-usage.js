// Count the final primary-request context after each profile has shaped it.
// These are text estimates, independent of the provider's measured total.
export function estimateContextUsage(event) {
  const estimate = value => Math.ceil((JSON.stringify(value, (_key, item) => {
    if (typeof item === 'string' && /^data:[^,]*;base64,/.test(item)) return '[media]';
    if (item && typeof item === 'object' && ['base64', 'bytes'].includes(item.type)) return '[media]';
    if (item instanceof Uint8Array) return '[media]';
    return item;
  }) || '').length / 3.2);
  return {
    system: Math.ceil(event.system.map(part => part.text || '').join('\n').length / 3.2),
    tools: Object.keys(event.tools).length ? estimate(event.tools) : 0,
    messages: event.messages.length ? estimate(event.messages) : 0
  };
}

export async function installContextUsage(ctx) {
  await ctx.session.hook('context', async event => {
    const url = process.env.YAN_BASH_BRIDGE_URL;
    const token = process.env.YAN_BASH_BRIDGE_TOKEN;
    if (!url || !token) return;
    try {
      await fetch(url + '/context-usage', {
        method: 'POST', signal: AbortSignal.timeout(2500),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: event.sessionID, ...estimateContextUsage(event) })
      });
    } catch {
      // Usage telemetry must never fail the model request.
    }
  });
}
