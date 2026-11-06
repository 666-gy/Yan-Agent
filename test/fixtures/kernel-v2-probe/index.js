// Uses the published V2 plugin shape. No V1 entrypoint or runtime dependencies.
export default {
  id: 'yan.v2.lifecycle-probe',
  async setup(ctx) {
    await ctx.session.hook('prompt', event => {
      event.metadata = { ...event.metadata, yanV2PromptHook: 'executed',
        yanRuntime: { node: process.versions.node, bun: process.versions.bun ?? null, executable: process.execPath } };
    });
  }
};
