import { z } from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import codingEnvironment from '../../coding-environment-plugin.mjs';
import { boundShellResult } from './shell-output.js';
const require = createRequire(import.meta.url);
const { acquireFiles } = require('../../workspace/file-locks.js');
const { mutationTargets } = require('../../file-observation-gate.js');

const legacyRules = permissions => (permissions || []).map(rule => ({
  permission: rule.action === 'shell' ? 'bash' : rule.action, pattern: rule.resource, action: rule.effect
}));
const nativeRules = permission => permission.map(rule => ({
  action: rule.permission === 'bash' ? 'shell' : rule.permission, resource: rule.pattern, effect: rule.action
}));
const toolName = name => name.replace(/^opencode[._]/, '');
const argsFor = (name, input = {}) => name === 'patch' ? { ...input, patchText: input.patch || input.patchText } : input;
const legacyName = name => toolName(name) === 'patch' ? 'apply_patch' : toolName(name);

// Only the protocol boundary is adapted. The shared engine owns project rules,
// observation baselines, verification receipts and desktop plugin activation.
export async function installCoding(ctx, { voiceCall = false } = {}) {
  const directory = ctx.location.directory;
  const { OpenCode } = await import(process.env.YAN_V2_CLIENT);
  const api = OpenCode.make({ baseUrl: process.env.YAN_V2_URL,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${process.env.YAN_V2_PASSWORD}`).toString('base64')}` } });
  const location = { directory };
  const client = {
    session: {
      get: async input => {
        const session = await ctx.session.get({ sessionID: input.sessionID });
        return { ...session, permission: legacyRules(session.permissions) };
      },
      update: async input => ctx.session.update({ sessionID: input.sessionID, permissions: nativeRules(input.permission) })
    },
    mcp: {
      add: async ({ name, config }) => {
        const { enabled, timeout, ...rest } = config;
        await api.mcp.add({ location, server: name, config: { ...rest, disabled: enabled === false,
          codemode: false, timeout: { startup: timeout || 120000, execution: timeout || 120000 } } });
        await api.mcp.connect({ location, server: name });
        const result = await api.mcp.list({ location });
        const server = result.data.find(item => item.name === name || item.id === name);
        return { [name]: { status: server?.status?.status } };
      },
      disconnect: async ({ name }) => api.mcp.remove({ location, server: name })
    }
  };
  const sessionSandbox = async id => {
    const session = await ctx.session.get({ sessionID: id });
    if (session.permissions?.some(rule => rule.action === 'yan_sandbox_read-only' && rule.effect === 'deny')) return 'read-only';
    if (session.permissions?.some(rule => rule.action === 'yan_sandbox_workspace-write' && rule.effect === 'deny')) return 'workspace-write';
    return 'full';
  };
  const engine = await codingEnvironment({ directory, client, sessionSandbox });

  async function ask(context, request) {
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, context.signal]);
    const id = `per_${crypto.randomBytes(12).toString('hex')}`;
    let ready;
    const connected = new Promise(resolve => { ready = resolve; });
    // Start listening before admission, so a fast UI reply cannot be missed.
    const replied = (async () => {
      for await (const event of api.event.subscribe({ signal, onActivity: () => ready() })) {
        if (event.type === 'permission.replied' && event.data.requestID === id) return event.data.reply;
      }
      throw new Error('Permission stream closed before a decision');
    })();
    replied.catch(() => {});
    try {
      await Promise.race([connected, replied]);
      const result = await api.permission.create({ sessionID: context.sessionID, id,
        action: request.permission === 'bash' ? 'shell' : request.permission,
        resources: request.patterns || ['*'], save: request.always, metadata: request.metadata,
        source: { type: 'tool', messageID: context.messageID, id: context.id } }, { signal });
      if (result.effect === 'deny') throw new Error('Permission denied');
      if (result.effect === 'ask' && await replied === 'reject') throw new Error('Permission declined');
    } finally { abort.abort(); }
  }

  await ctx.tool.transform(editor => {
    for (const [name, tool] of Object.entries(engine.tool)) {
      // Yan's bash engine replaces V2's built-in shell tool. The model-facing
      // name stays `bash` (what Yan documents and the desktop renders), while
      // the kernel permission action stays `shell`, which is what V2 rules use.
      const permission = name === 'bash' ? 'shell' : name;
      editor.remove(name);
      editor.remove(`opencode.${name}`);
      if (permission !== name) {
        editor.remove(permission);
        editor.remove(`opencode.${permission}`);
      }
      editor.add({ name, description: tool.description, input: z.object(tool.args),
        options: { codemode: false, permission },
        execute: async (input, context) => {
          if (permission !== 'shell') await ask(context, { permission: name, patterns: ['*'] });
          const result = await tool.execute(input, { ...context, directory, callID: context.id,
            abort: context.signal, ask: request => ask(context, request) });
          if (typeof result === 'string') return { content: result };
          const output = result.output ?? result.content ?? '';
          const exit = result.metadata?.exit;
          if (name === 'bash' && Number.isInteger(exit) && exit !== 0) {
            const bounded = await boundShellResult({ content: output, metadata: result.metadata }, { sessionID: context.sessionID });
            throw new Error(bounded.content);
          }
          // Durable V2 events accept JSON only. Optional JS values (especially
          // exit: undefined on a queued shell) used to silently lose the result.
          const metadata = result.metadata == null ? {} : JSON.parse(JSON.stringify(result.metadata));
          if (name === 'bash_status') {
            // The bridge's capture flag lives inside the status payload, not
            // in the tool metadata. Keep its meaning when archiving a preview.
            try { metadata.captureTruncated = JSON.parse(output)?.truncated === true; } catch { /* text-only status */ }
          }
          return { content: output || '(no output)', metadata, title: result.title };
        }
      });
    }
  });
  const installShellOutputBoundary = () => ctx.tool.hook('execute.after', async event => {
    if (event.status !== 'completed' || !['bash', 'bash_status'].includes(toolName(event.tool))) return;
    const content = event.result.content;
    const text = typeof content === 'string' ? content
      : (content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    const bounded = await boundShellResult({ ...event.result, content: text }, { sessionID: event.sessionID });
    event.result.content = Array.isArray(content)
      ? [{ type: 'text', text: bounded.content }, ...content.filter(item => item.type !== 'text')]
      : bounded.content;
    event.result.metadata = bounded.metadata;
  });
  if (voiceCall) { await installShellOutputBoundary(); return; }
  await ctx.tool.transform(editor => {
    for (const tool of editor.list()) {
      const name = legacyName(tool.name || tool.id);
      if (!['write', 'edit', 'apply_patch'].includes(name)) continue;
      editor.update(tool.id, current => {
        const execute = current.execute;
        current.execute = async (input, context) => {
          const args = argsFor(toolName(tool.name || tool.id), input);
          // Native mutations declare exact targets; terminal processes are
          // independent jobs and can opt into declared file leases explicitly.
          const scopes = mutationTargets(name, args).map(file => path.resolve(directory, file));
          const release = await acquireFiles(scopes.length ? scopes : [directory],
            { signal: context.signal, owner: `${context.sessionID}/${context.id}` });
          try {
            // Revalidate observations AFTER waiting, closing the pre-hook TOCTOU gap.
            await engine['tool.execute.before']({ tool: name, sessionID: context.sessionID, callID: context.id }, { args });
            return await execute(input, context);
          } finally { release(); }
        };
      });
    }
  });
  await ctx.session.hook('context', async event => {
    const output = { system: [] };
    await engine['experimental.chat.system.transform']({ sessionID: event.sessionID }, output);
    for (const value of output.system) event.system.push({ type: 'text', text: value });
  });
  await ctx.tool.hook('execute.before', async event => {
    await engine['tool.execute.before']({ tool: legacyName(event.tool), sessionID: event.sessionID, callID: event.id },
      { args: argsFor(toolName(event.tool), event.input) });
  });
  await ctx.tool.hook('execute.after', async event => {
    if (event.status !== 'completed') return;
    const content = event.result.content;
    const text = typeof content === 'string' ? content
      : (content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    const output = { output: text,
      metadata: event.result.metadata || {} };
    await engine['tool.execute.after']({ tool: legacyName(event.tool), sessionID: event.sessionID,
      callID: event.id, args: argsFor(toolName(event.tool), event.input) }, output);
    // The legacy hook only processes text. Keep native image/PDF/file blocks
    // intact instead of replacing the entire multimodal result with that text.
    if (output.output !== text) {
      event.result.content = Array.isArray(content)
        ? [{ type: 'text', text: output.output }, ...content.filter(item => item.type !== 'text')]
        : output.output;
    }
    event.result.metadata = JSON.parse(JSON.stringify(output.metadata || {}));
  });
  // Last, so verification receipts and status wrappers share the same budget.
  await installShellOutputBoundary();
}
