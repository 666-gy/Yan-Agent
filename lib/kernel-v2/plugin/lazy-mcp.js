import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const { capabilities, connectionName, connectionToolAllowed, toolNames } = require('../mcp-capabilities');
const { createMcpLifecycle } = require('../mcp-lifecycle');
const { waitForMcp } = require('../mcp-readiness');

const matches = (name, pattern) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(name);
const disabled = (name, rules) => {
  const rule = rules.findLast(rule => matches(name, rule.action));
  return rule?.resource === '*' && rule.effect === 'deny';
};
const connectDescription = name => `${capabilities[name]} Connect this capability only when needed for the task. `
  + 'After connection, its permitted tools and full parameter schemas become available for direct calls. '
  + 'This call connects tools; it does not perform those actions. Reconnect here if the service was released after inactivity.';

// Capability entrypoints are always cheap. Only a successful explicit connect
// enables this Session's native MCP tools; schemas come from the live server.
export async function installLazyMcp(ctx, { toolAllowed = () => true } = {}) {
  const servers = JSON.parse(process.env.YAN_DEFERRED_MCP_SERVERS || '{}');
  const names = Object.keys(servers).filter(name => capabilities[name]
    && connectionToolAllowed(connectionName(name), toolAllowed));
  if (!names.length) return;
  const activated = new Map(names.map(name => [name, new Set()]));
  const { OpenCode } = await import(process.env.YAN_V2_CLIENT);
  const api = OpenCode.make({ baseUrl: process.env.YAN_V2_URL,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${process.env.YAN_V2_PASSWORD}`).toString('base64')}` } });
  const location = { directory: ctx.location.directory };
  const nativeTools = async name => (await ctx.tool.list()).filter(tool => tool.options?.namespace === name);
  const runtime = createMcpLifecycle({
    idleMs: Number(process.env.YAN_MCP_IDLE_MS) || 300000,
    isBusy: async () => Object.keys(await api.session.active({ signal: AbortSignal.timeout(5000) })).length > 0,
    onDisconnect: name => activated.get(name)?.clear(),
    disconnect: async name => {
      await api.mcp.disconnect({ server: name, location }, { signal: AbortSignal.timeout(10000) });
      await ctx.tool.reload();
    },
    connect: async (name, signal, ownsStartup) => {
      const timeout = AbortSignal.timeout(Math.max(30000, Number(servers[name].timeout?.startup) || 0));
      signal = AbortSignal.any([signal, timeout]);
      const catalog = await api.mcp.list({ location }, { signal });
      if (catalog.data.find(server => (server.name || server.id) === name)?.status.status !== 'connected') {
        ownsStartup();
        await api.mcp.connect({ server: name, location }, { signal });
      } else {
        const tools = await nativeTools(name);
        if (tools.length) return tools.map(tool => tool.id);
      }
      await waitForMcp(api, { mcp: { servers: { [name]: servers[name] } } }, location.directory,
        () => signal.aborted, { signal, forTool: true });
      // Native MCP registration is debounced separately from connection. Do
      // not report success until the next request can use the actual schemas.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        await ctx.tool.reload();
        const tools = await nativeTools(name);
        if (tools.length) return tools.map(tool => tool.id);
        await delay(50, undefined, { signal });
      }
      throw new Error(`MCP ${name} connected but no permitted tools were registered. Retry the connection.`);
    }
  });

  function allowedTools(name, session) {
    const rules = session.permissions || [];
    const custom = rules.some(rule => rule.action === 'yan_custom_agent_mode' && rule.effect === 'allow');
    const selected = new Set(rules.filter(rule => rule.action.startsWith('yan_custom_tool.') && rule.effect === 'allow')
      .map(rule => rule.action.slice('yan_custom_tool.'.length)));
    return toolNames(name).filter(id => toolAllowed(id) && (!custom || selected.has(id)) && !disabled(id, rules));
  }
  await ctx.tool.transform(editor => {
    for (const name of names) {
      editor.add({ name: connectionName(name), description: connectDescription(name),
        input: { type: 'object', properties: {}, additionalProperties: false },
        options: { codemode: false, permission: 'yan_connect' },
        execute: async (_input, context) => {
          if (!allowedTools(name, await ctx.session.get({ sessionID: context.sessionID })).length) throw new Error('This capability is not available in the current session.');
          const tools = await runtime.connect(name, context.signal);
          context.signal.throwIfAborted();
          activated.get(name).add(context.sessionID);
          const allowed = new Set(allowedTools(name, await ctx.session.get({ sessionID: context.sessionID })));
          return { content: JSON.stringify({ connected: true, server: name,
            tools: tools.filter(id => allowed.has(id)),
            message: 'Use the newly available named tools with their parameter schemas on your next step.' }) };
        }
      });
    }
    for (const tool of editor.list()) {
      const name = tool.options?.namespace;
      if (!activated.has(name)) continue;
      const execute = tool.execute;
      editor.update(tool.id, current => {
        current.options = { ...current.options, codemode: false };
        current.execute = async (input, context) => {
          try { return await runtime.use(name, context.signal, () => execute(input, context)); }
          catch (error) {
            context.signal.throwIfAborted();
            // The native promise adapter can reject with an Effect failure.
            // Tool error events must contain an ordinary serializable error.
            throw new Error(error?.message || 'MCP tool execution failed');
          }
        };
      });
    }
  });
  await ctx.session.hook('context', async event => {
    runtime.touch();
    const session = await ctx.session.get({ sessionID: event.sessionID });
    for (const name of names) {
      const allowed = allowedTools(name, session);
      const connector = event.tools[connectionName(name)];
      if (!allowed.length) delete event.tools[connectionName(name)];
      else if (connector && allowed.length !== toolNames(name).length) {
        connector.description = `Connect the permitted ${name} tools: ${allowed.join(', ')}. `
          + 'After connection, call their named tools with the supplied schemas. Connection itself performs no tool action.';
      }
      if (runtime.isConnected(name) && activated.get(name).has(event.sessionID)) continue;
      for (const id of Object.keys(event.tools)) {
        if (id.startsWith(`${name}_`) && id !== connectionName(name)) delete event.tools[id];
      }
    }
  });
  await ctx.tool.hook('execute.before', event => {
    for (const name of names) {
      if (!event.tool.startsWith(`${name}_`) || event.tool === connectionName(name)) continue;
      if (!runtime.isConnected(name) || !activated.get(name).has(event.sessionID)) {
        throw new Error(`Connect ${connectionName(name)} before using this capability.`);
      }
    }
  });
  return () => runtime.close();
}
