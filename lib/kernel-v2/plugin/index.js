import { installDelegation } from './delegation.js';
import { installCoding } from './coding.js';
import { installMedia } from './media.js';
import { installTodos } from './todos.js';
import { installContextUsage } from './context-usage.js';
import { installLazyMcp } from './lazy-mcp.js';
import { createRequire } from 'node:module';
const { connectionToolAllowed } = createRequire(import.meta.url)('../mcp-capabilities');

const normalizedToolName = name => String(name || '').replace(/^opencode[._]/, '').replace(/\./g, '_');

function customAgentToolSet(session) {
  const rules = session.permissions || [];
  if (!rules.some(rule => rule.action === 'yan_custom_agent_mode' && rule.effect === 'allow')) return null;
  return new Set(rules.filter(rule => rule.action.startsWith('yan_custom_tool.') && rule.effect === 'allow')
    .map(rule => normalizedToolName(rule.action.slice('yan_custom_tool.'.length))));
}

function isAgentCreationEnabled(session) {
  return (session.permissions || []).some(rule =>
    ['yan_agent_creation', 'yan_creative_mode'].includes(rule.action) && rule.effect === 'allow');
}
export default {
  id: 'yan.v2.desktop-bridge',
  async setup(ctx) {
    const cleanupMcp = await installLazyMcp(ctx);
    await installCoding(ctx);
    await installTodos(ctx);
    await installDelegation(ctx);
    await installMedia(ctx);
    // Reuse Yan's existing protocol adapters through V2's supported AISDK seam.
    await ctx.aisdk.hook('sdk', async event => {
      if (!event.package.startsWith('file:')) return;
      const module = await import(event.package);
      const factory = Object.entries(module).find(([name, value]) => name.startsWith('create') && typeof value === 'function')?.[1];
      if (!factory) throw new Error('Yan provider module has no create factory');
      event.sdk = factory({ ...event.options, name: event.model.providerID });
    });
    await ctx.tool.transform(editor => {
      for (const tool of editor.list()) {
        if (/^(?:opencode[._])?(session_|worktree_|task$|subagent$|webfetch$)/.test(tool.id)) {
          editor.remove(tool.id);
          continue;
        }
        // Keep native/MCP capabilities reachable without the Code Mode interpreter.
        // Registry transforms also run when dynamic tools are reloaded.
        editor.update(tool.id, current => {
          current.options = { ...current.options, codemode: false };
        });
      }
    });
    await ctx.session.hook('context', async event => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const selectedTools = customAgentToolSet(session);
      const agentCreationEnabled = isAgentCreationEnabled(session);
      for (const name of Object.keys(event.tools)) {
        if (/^yan_skills_(?:create_agent|list_agents|create_plugin)$/.test(normalizedToolName(name)) && !agentCreationEnabled) {
          delete event.tools[name];
          continue;
        }
        if (selectedTools && !connectionToolAllowed(normalizedToolName(name), tool => selectedTools.has(tool))) {
          delete event.tools[name];
          continue;
        }
        if (/^(?:opencode[._])?(session_|worktree_|task$|subagent$|webfetch$)/.test(name)) delete event.tools[name];
      }
      // Connection readiness and registry refresh are separate in V2. Check
      // the actual provider-facing catalog, not just the MCP connected flag.
      const configured = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}').mcp?.servers || {};
      for (const [name, config] of Object.entries(configured)) {
        if (config.disabled || !['yan_browser', 'yan_skills', 'yan_mcp'].includes(name)) continue;
        const rule = session.permissions?.findLast(rule => rule.action === '*' || rule.action === `${name}_*`);
        // No-tools reviewers and deliberately restricted sessions are valid.
        if (!rule || rule.effect === 'deny') continue;
        if (!Object.keys(event.tools).some(tool => tool.startsWith(`${name}_`))) {
          throw new Error(`MCP ${name} 已配置但工具尚未进入模型工具列表，请重试；本轮不会静默降级到其他工具。`);
        }
      }
    });
    await ctx.tool.hook('execute.before', async event => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const selectedTools = customAgentToolSet(session);
      if (/^yan_skills_(?:create_agent|list_agents|create_plugin)$/.test(normalizedToolName(event.tool))
          && !isAgentCreationEnabled(session)) {
        throw new Error('当前模式不支持创建自定义 Agent 或插件。');
      }
      if (selectedTools && !connectionToolAllowed(normalizedToolName(event.tool), tool => selectedTools.has(tool))) {
        throw new Error('此工具未包含在当前自定义 Agent 的工具白名单中。');
      }
    });
    await installContextUsage(ctx);
    return cleanupMcp;
  }
};
