import { z } from 'zod';
import { installLazyMcp } from './lazy-mcp.js';
import crypto from 'node:crypto';
import { installContextUsage } from './context-usage.js';
import { boundShellResult } from './shell-output.js';
import { createRequire } from 'node:module';
(createRequire(import.meta.url));
const minimal = require('../../minimal-agent');

export function createLocalProfile({ id, system, toolAllowed, configuredSystem = false, install = async () => {} }) {
  return {
    id,
    async setup(ctx) {
      const cleanupMcp = await installLazyMcp(ctx, { toolAllowed });
      await install(ctx);
      const { resolveBashShell } = await import('../../kernel-bash-tool.mjs');
      const shell = resolveBashShell();
      const shellLabel = shell.kind === 'powershell' ? 'PowerShell (use PowerShell syntax)' : 'Bash/POSIX (use shell syntax)';
      const { OpenCode } = await import(process.env.YAN_V2_CLIENT);
      const api = OpenCode.make({ baseUrl: process.env.YAN_V2_URL,
        headers: { authorization: `Basic ${Buffer.from(`opencode:${process.env.YAN_V2_PASSWORD}`).toString('base64')}` } });
      async function approve(context, command) {
        const abort = new AbortController();
        const signal = AbortSignal.any([context.signal, abort.signal]);
        const id = `per_${crypto.randomBytes(12).toString('hex')}`;
        let ready;
        const connected = new Promise(resolve => { ready = resolve; });
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
            action: 'shell', resources: [command], save: [command], metadata: { command },
            source: { type: 'tool', messageID: context.messageID, id: context.id } }, { signal });
          if (result.effect === 'deny' || (result.effect === 'ask' && await replied === 'reject')) throw new Error('Permission denied');
        } finally { abort.abort(); }
      }
      await ctx.aisdk.hook('sdk', async event => {
        if (!event.package.startsWith('file:')) return;
        const module = await import(event.package);
        const factory = Object.entries(module).find(([name, value]) => name.startsWith('create') && typeof value === 'function')?.[1];
        if (!factory) throw new Error('Yan provider module has no create factory');
        event.sdk = factory({ ...event.options, name: event.model.providerID });
      });
      await ctx.tool.transform(editor => {
        const read = editor.get('read') || editor.get('opencode.read');
        if (read && !editor.get('read_image')) editor.add({ name: 'read_image',
          description: 'Read a local image and return its image contents.',
          input: z.object({ path: z.string().describe('Absolute image path, or path relative to the workspace.') }),
          output: read.output,
          options: { codemode: false, permission: 'read' },
          execute: async (input, context) => {
            if (!/\.(?:png|jpe?g|webp|gif|bmp|svg)$/i.test(input.path)) throw new Error('Expected an image file.');
            return read.execute({ path: input.path }, context);
          } });
        editor.remove('shell'); editor.remove('opencode.shell'); editor.remove('opencode.bash');
        editor.add({ name: 'bash', description: `Run a command in persistent ${shellLabel}. The working directory, variables and functions persist across calls in this session. Other sessions have separate shells. Cancellation, timeout or shell exit resets its state.`,
          input: z.object({ command: z.string(), timeout: z.number().positive().max(600000).optional().describe('Timeout in milliseconds; default 300000.') }),
          options: { codemode: false, permission: 'shell' },
          execute: async (input, context) => {
            await approve(context, input.command);
            const response = await fetch(process.env.YAN_BASH_BRIDGE_URL + '/persistent', {
              method: 'POST', signal: context.signal,
              headers: { Authorization: `Bearer ${process.env.YAN_BASH_BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionID: context.sessionID, command: input.command, timeout: input.timeout })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Persistent shell failed');
            const output = `${result.output || ''}${result.truncated ? '\n[Output truncated]' : ''}\n[Command finished with exit code ${result.exit}]`;
            const bounded = await boundShellResult({ content: output,
              metadata: { exit: result.exit, captureTruncated: result.truncated === true }, title: input.command.slice(0, 80) },
              { sessionID: context.sessionID });
            if (result.exit !== 0) throw new Error(bounded.content);
            return bounded;
          } });
        for (const tool of editor.list()) {
          if (!toolAllowed(tool.id)) editor.remove(tool.id);
          else editor.update(tool.id, current => { current.options = { ...current.options, codemode: false }; });
        }
      });
      await ctx.session.hook('context', event => {
        const config = configuredSystem ? JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}') : {};
        event.system.splice(0, event.system.length, { type: 'text', text: config.agents?.build?.system || system });
        for (const name of Object.keys(event.tools)) if (!toolAllowed(name)) delete event.tools[name];
      });
      await ctx.tool.hook('execute.before', event => {
        if (!toolAllowed(event.tool)) throw new Error('当前模式不支持此工具。');
      });
      await installContextUsage(ctx);
      return cleanupMcp;
    }
  };
}
export default createLocalProfile({ id: 'yan.minimal', ...minimal });
