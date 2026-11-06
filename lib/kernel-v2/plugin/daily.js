import { installMedia } from './media.js';
import { installLazyMcp } from './lazy-mcp.js';
import { installContextUsage } from './context-usage.js';
import { createRequire } from 'node:module';
import { z } from 'zod';
const require = createRequire(import.meta.url);
const { toolAllowed, system } = require('../../daily-agent');
const { runSearch } = require('../../daily-search');

export default {
  id: 'yan.daily',
  async setup(ctx) {
    const cleanupMcp = await installLazyMcp(ctx, { toolAllowed });
    await installMedia(ctx);
    await ctx.aisdk.hook('sdk', async event => {
      if (!event.package.startsWith('file:')) return;
      const module = await import(event.package);
      const factory = Object.entries(module).find(([name, value]) => name.startsWith('create') && typeof value === 'function')?.[1];
      if (!factory) throw new Error('Yan provider module has no create factory');
      event.sdk = factory({ ...event.options, name: event.model.providerID });
    });
    await ctx.tool.transform(editor => {
      editor.add({ name: 'anysearch', description: 'Search the web with AnySearch or extract a public URL. Use action=search with a query, or action=extract with an HTTP(S) URL. Falls back to websearch/yan_web_fetch when unavailable.',
        input: z.object({ action: z.enum(['search', 'extract']).default('search'), query: z.string(), max_results: z.number().int().min(1).max(10).optional() }),
        options: { codemode: false, permission: 'anysearch' },
        execute: async (input, context) => ({ content: await runSearch(input, context.signal) }) });
      for (const tool of editor.list()) if (!toolAllowed(tool.id)) editor.remove(tool.id);
    });
    await ctx.session.hook('context', event => {
      const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}');
      event.system.splice(0, event.system.length, { type: 'text', text: config.agents?.build?.system || system });
      for (const name of Object.keys(event.tools)) if (!toolAllowed(name)) delete event.tools[name];
    });
    await ctx.tool.hook('execute.before', event => {
      if (!toolAllowed(event.tool)) throw new Error('日常模式不支持此工具，请使用标准模式。');
    });
    await installContextUsage(ctx);
    return cleanupMcp;
  }
};
