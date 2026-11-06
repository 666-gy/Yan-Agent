import { installMedia } from './media.js';
import { installContextUsage } from './context-usage.js';
import { createRequire } from 'node:module';
import { installCoding } from './coding.js';
const require = createRequire(import.meta.url);
const { system, toolAllowed } = require('../../voice-call-agent.js');
export default {
  id: 'yan.voice-call',
  async setup(ctx) {
    await installMedia(ctx);
    await installCoding(ctx, { voiceCall: true });
    await ctx.aisdk.hook('sdk', async event => {
      if (!event.package.startsWith('file:')) return;
      const module = await import(event.package);
      const factory = Object.entries(module).find(([name, value]) => name.startsWith('create') && typeof value === 'function')?.[1];
      if (!factory) throw new Error('Yan provider module has no create factory');
      event.sdk = factory({ ...event.options, name: event.model.providerID });
    });
    await ctx.tool.transform(editor => {
      for (const tool of editor.list()) if (!toolAllowed(tool.id)) editor.remove(tool.id);
    });
    await ctx.session.hook('context', event => {
      event.system.splice(0, event.system.length, { type: 'text', text: system });
      for (const name of Object.keys(event.tools)) if (!toolAllowed(name)) delete event.tools[name];
    });
    await ctx.tool.hook('execute.before', event => {
      if (!toolAllowed(event.tool)) throw new Error('妍宝仅支持 Bash、读图和搜索');
    });
    await installContextUsage(ctx);
  }
};
