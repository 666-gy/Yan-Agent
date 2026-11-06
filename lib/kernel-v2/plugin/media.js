import { z } from 'zod';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMediaRuntime } = require('../../media-tools-runtime');
export async function installMedia(ctx) {
  if (!process.env.YAN_MEDIA_RUNTIME) return;
  const runtime = createMediaRuntime();
  await ctx.tool.transform(editor => {
    for (const definition of runtime.toolDefinitions()) {
      const required = new Set(definition.inputSchema.required || []);
      const shape = Object.fromEntries(Object.entries(definition.inputSchema.properties).map(([key, field]) => {
        let schema = field.enum ? z.union(field.enum.map(value => z.literal(value))) : ['number', 'integer'].includes(field.type) ? z.number() : z.string();
        if (field.type === 'integer' && !field.enum) schema = schema.int();
        if (field.minimum !== undefined) schema = schema.min(field.minimum);
        if (field.maximum !== undefined) schema = schema.max(field.maximum);
        if (field.description) schema = schema.describe(field.description);
        return [key, required.has(key) ? schema : schema.optional()];
      }));
      const name = `yan_media_${definition.name}`;
      editor.add({ name, description: definition.description, input: z.object(shape).strict(),
        options: { codemode: false, permission: name },
        execute: async (input, context) => {
          const session = await ctx.session.get({ sessionID: context.sessionID });
          const rules = session.permissions || [];
          const fileRule = rules.findLast(rule => ['*', 'read'].includes(rule.action));
          if ((definition.name === 'read_image' || input.source_path || input.source_asset_id) && fileRule?.effect === 'deny') throw new Error('当前任务未授权读取图片');
          const result = await runtime.execute(definition.name, { ...input, workspace: ctx.location.directory }, context.signal);
          return { content: JSON.stringify(result), metadata: result.metadata || {} };
        }
      });
    }
  });
}
