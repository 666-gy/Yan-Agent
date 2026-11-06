import { z } from 'zod';
import { createRequire } from 'node:module';
import { createLocalProfile } from './minimal.js';
import { installMedia } from './media.js';
const require = createRequire(import.meta.url);
const creative = require('../../creative-agent');
const { runSearch } = require('../../daily-search');

export default createLocalProfile({ id: 'yan.creative', ...creative, configuredSystem: true,
  async install(ctx) {
    await installMedia(ctx);
    await ctx.tool.transform(editor => {
      editor.add({ name: 'anysearch', description: 'Search the web or extract a public URL for documentation and creative references.',
        input: z.object({ action: z.enum(['search', 'extract']).default('search'), query: z.string(), max_results: z.number().int().min(1).max(10).optional() }),
        options: { codemode: false, permission: 'anysearch' },
        execute: async (input, context) => ({ content: await runSearch(input, context.signal) }) });
    });
  }
});
