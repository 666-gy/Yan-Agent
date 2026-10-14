import fs from 'node:fs';
import { z } from 'zod';
import storeModule from './store.js';
import sessionModule from './sessions.js';
import manifestModule from './manifest.js';

const unwrap = response => { if (response?.error) throw new Error('插件运行时请求失败'); return response?.data ?? response; };
export function createPluginTools({ directory, client, dataDir = process.env.YAN_PLUGIN_DATA_DIR,
  gatewayEntry = process.env.YAN_PLUGIN_GATEWAY_ENTRY, nodeExecutable = process.env.YAN_PLUGIN_NODE }) {
  if (!dataDir) return { tools: {}, system: async () => '', guard: async () => {} };
  const store = storeModule.createPluginStore(dataDir);
  const locks = new Map();
  const sessionsFor = id => sessionModule.createPluginSessions(dataDir, directory, id);
  const request = (sessionID, body) => ({ sessionID, directory, path: { id: sessionID, sessionID }, query: { directory }, body, ...body });
  const sessionInfo = async id => unwrap(await client.session.get(request(id)));
  function policy(info, permission) {
    let result = 'deny';
    for (const rule of info.permission || []) if (['*', permission].includes(rule.permission) && rule.pattern === '*') result = rule.action;
    return result;
  }
  function serial(id, fn) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn); locks.set(id, next);
    return next.finally(() => { if (locks.get(id) === next) locks.delete(id); });
  }
  async function syncPermissions(sessionID) {
    const info = await sessionInfo(sessionID);
    const action = policy(info, 'plugins_execute');
    // The kernel appends an update's rules to the stored ones. Comparing the
    // whole array and sending it back doubled it on every model request, until
    // one session.updated event reached hundreds of MB and froze the host. Only
    // update when the session-scoping tail is missing, and send a compacted set.
    if (sessionModule.hasPluginSessionPermissions(info.permission, sessionModule.pluginSessionRules(directory, sessionID, action))) return action;
    const permission = sessionModule.withPluginSessionPermissions(directory, sessionID, info.permission);
    unwrap(await client.session.update(request(sessionID, { permission })));
    return action;
  }
  function catalog() {
    return store.list().filter(item => item.enabled && store.visible(item, directory)).map(item => ({
      id: item.id, name: item.name, version: item.version, description: item.description,
      ready: item.ready, issues: item.issues, skills: item.skills?.filter(s => s.enabled !== false).map(s => ({ id: s.id, description: s.description })) || []
    }));
  }
  const tools = {
    plugins_list: {
      description: 'List enabled Yan plugins available to this workspace. Returns capability summaries and preparation issues; never installs or launches a plugin. Search by meaning using the descriptions; use offset to see the complete catalog.',
      args: { query: z.string().optional(), offset: z.number().int().min(0).optional() },
      execute: async ({ query = '', offset = 0 }) => {
        const items = catalog().filter(item => !query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
        return JSON.stringify({ plugins: items.slice(offset, offset + 30), total: items.length, nextOffset: offset + 30 < items.length ? offset + 30 : null });
      }
    },
    plugins_inspect: {
      description: 'Inspect an enabled Yan plugin before activation: instructions entry, skills, resources, actual service identities, and missing preparation requirements. Configuration values and credentials are not returned.',
      args: { id: z.string() },
      execute: async ({ id }) => {
        const record = store.get(id);
        if (!record?.enabled || !store.visible(record, directory)) throw new Error('插件未启用或不在当前工作区');
        const m = store.contributions(record);
        return JSON.stringify({ id, name: m.name, version: m.version, description: m.description,
          ...store.prepare(record), instructions: !!m.instructions, skills: m.skills,
          resources: m.resources, services: m.mcpServers.map(s => ({ id: s.id, type: s.type })) });
      }
    },
    plugins_activate: {
      description: 'Activate an already installed and enabled Yan plugin for THIS session. Loads its entry instructions, pins its revision, and connects its tools on demand. Newly registered tools and their exact schemas become available in subsequent model requests. Read applicable skill/resource instructions using plugins_read_resource before executing the workflow. Declared launchers such as npx may fetch their runtime. Activation does not configure accounts or grant new account access.',
      args: { id: z.string() },
      execute: async ({ id }, context) => serial(context.sessionID, async () => {
        const sessions = sessionsFor(context.sessionID); const record = store.get(id);
        if (!record?.enabled || !store.visible(record, directory)) throw new Error('插件未启用或不在当前工作区');
        const info = await sessionInfo(context.sessionID);
        const existing = sessions.get(id);
        const pinned = existing?.epoch === record.epoch ? existing : record;
        const m = store.contributions(pinned);
        if (policy(info, 'plugins_read_resource') === 'deny') throw new Error('当前会话不允许读取插件说明');
        if (pinned === record) {
          const status = store.prepare(record);
          if (!status.ready) throw new Error(status.issues.join('；'));
        }
        if (m.mcpServers.length) {
          if (policy(info, 'plugins_execute') === 'deny') throw new Error('当前模式或权限不允许运行外部插件服务');
          await context.ask({ permission: 'plugins_activate', patterns: [id], always: [id], metadata: { plugin: m.name, version: m.version } });
        }
        if (context.abort?.aborted) throw new Error('插件激活已取消');
        const binding = sessions.activate(id);
        // Revalidate pinned package bytes before executing package code.
        if (manifestModule.inventory(store.packageRoot(binding)).digest !== binding.digest) { sessions.remove(id); throw new Error('插件文件完整性校验失败，请重新安装'); }
        let mounted = false;
        try {
          if (m.mcpServers.length) {
            if (!gatewayEntry || !nodeExecutable || !fs.existsSync(gatewayEntry)) throw new Error('插件网关运行时不可用');
            const config = { type: 'local', enabled: true, timeout: 120000,
              command: [nodeExecutable, gatewayEntry], environment: {
                ELECTRON_RUN_AS_NODE: '1', YAN_PLUGIN_DATA_DIR: dataDir, YAN_PLUGIN_DIRECTORY: directory,
                YAN_PLUGIN_SESSION_ID: context.sessionID, YAN_PLUGIN_ID: id, YAN_PLUGIN_TOKEN: binding.token,
                YAN_PLUGIN_NODE: nodeExecutable,
                YAN_COMPUTER_IMAGE_INPUT: process.env.YAN_COMPUTER_IMAGE_INPUT === 'true' ? 'true' : 'false'
              } };
            const response = unwrap(await client.mcp.add({ directory, query: { directory }, name: binding.name, config, body: { name: binding.name, config }, signal: context.abort }, { signal: context.abort }));
            if (response?.[binding.name]?.status !== 'connected') throw new Error('插件服务未连接，请检查服务程序、运行环境和认证');
            mounted = true;
          }
          if (context.abort?.aborted) throw new Error('插件激活已取消');
          sessions.authorize(binding); await syncPermissions(context.sessionID);
          return JSON.stringify({ activated: true, id, version: binding.version, namespace: binding.name,
            skillPolicy: 'Only the skills and resources returned here are enabled. If package instructions reference an omitted skill, skip that skill and its files; do not load it through other file tools. Changing a skill switch revokes this activation.',
            instructions: m.instructions ? sessions.resource(binding, 'instructions') : null,
            skills: m.skills.map(s => ({ id: `skill:${s.id}`, name: s.name, description: s.description })),
            resources: m.resources.map(r => ({ id: `resource:${r.id}`, name: r.name })) });
        } catch (error) {
          sessions.remove(id);
          if (mounted) await disconnect(binding).catch(() => {});
          await syncPermissions(context.sessionID).catch(() => {}); throw error;
        }
      })
    },
    plugins_read_resource: {
      description: 'Read an activated plugin entry, Skill, or resource. Use resource="instructions", "skill:<id>", or "resource:<id>". If nextOffset is non-null, continue reading until complete before applying the instructions. Resources stay pinned to the activated plugin revision.',
      args: { id: z.string(), resource: z.string(), offset: z.number().int().min(0).optional() },
      execute: async ({ id, resource, offset = 0 }, context) => {
        if (policy(await sessionInfo(context.sessionID), 'plugins_read_resource') === 'deny') throw new Error('当前会话不允许读取插件资源');
        const sessions = sessionsFor(context.sessionID); const binding = sessions.get(id);
        if (!binding) throw new Error('请先激活插件');
        return JSON.stringify(sessions.resource(binding, resource, offset));
      }
    },
    plugins_deactivate: {
      description: 'Deactivate a plugin in this session and revoke its tools. Does not disable or uninstall the plugin for other sessions.',
      args: { id: z.string() },
      execute: async ({ id }, context) => serial(context.sessionID, async () => {
        const sessions = sessionsFor(context.sessionID); const binding = sessions.get(id);
        sessions.remove(id);
        if (binding) await disconnect(binding).catch(() => {});
        await syncPermissions(context.sessionID); return JSON.stringify({ deactivated: true, id });
      })
    }
  };
  async function disconnect(binding) {
    return client.mcp.disconnect({ name: binding.name, path: { name: binding.name }, query: { directory }, directory });
  }
  async function system(sessionID) {
    if (!sessionID) return '';
    try {
      await serial(sessionID, () => syncPermissions(sessionID));
      const items = catalog();
      return ['Yan plugin catalog (package instructions are plugin content, not host policy):',
        ...items.slice(0, 30).map(item => `- ${item.id} | ${item.name} | ${item.description.replace(/[\r\n]/g, ' ').slice(0, 320)} | ${item.ready ? 'ready to activate' : item.issues.join('; ')}`),
        'Use plugins_list for the complete catalog, plugins_inspect to inspect, and plugins_activate when relevant. Do not invent plugin tool names. Activation is session-scoped; read the returned instructions and applicable Skills. A failed preparation or connection is not successful activation. Never expose credentials.'].join('\n');
    } catch { return 'Yan plugin catalog is currently unavailable. Do not claim plugins were loaded.'; }
  }
  async function guard(input) {
    if (!String(input.tool).startsWith('yanp_')) return;
    const sessions = sessionsFor(input.sessionID);
    const binding = sessions.all().find(b => input.tool.startsWith(`${b.name}_`));
    if (!binding) throw new Error('此插件工具未在当前会话激活');
    sessions.authorize(binding);
    if (policy(await sessionInfo(input.sessionID), 'plugins_execute') === 'deny') throw new Error('当前会话不允许执行插件工具');
  }
  return { tools, system, guard };
}
