'use strict';
// Refresh pinned metadata only. Third-party workflow content is downloaded by
// the user at installation, retaining the original terms and file hashes.
const fs = require('node:fs');
const path = require('node:path');
const { presentation } = require('../lib/plugins/presentation');
const revision = '1dc195897af4161d039b80d8471ec0a10c9bbc89';
const definitions = [
  { id: 'figma', name: 'Figma', description: '读取和创建设计，连接组件代码，维护设计系统并实现界面。', entry: 'figma-use', url: 'https://mcp.figma.com/mcp', website: 'https://www.figma.com/login' },
  { id: 'canva', name: 'Canva', description: '创建、编辑和审阅设计，适配社交媒体尺寸并检查品牌一致性。', entry: 'canva-edit-design', url: 'https://mcp.canva.com/mcp', website: 'https://www.canva.com/login/' },
];
async function main() {
  const response = await fetch(`https://api.github.com/repos/openai/plugins/git/trees/${revision}?recursive=1`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`GitHub: ${response.status}`);
  const tree = await response.json();
  if (tree.truncated || tree.sha !== revision) throw new Error('Unexpected upstream tree');
  const entries = [];
  for (const definition of definitions) {
    const prefix = `plugins/${definition.id}/`;
    const url = `https://api.github.com/repos/openai/plugins/contents/${prefix}.codex-plugin/plugin.json?ref=${revision}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Manifest: ${response.status}`);
    const json = await response.json();
    const upstream = JSON.parse(Buffer.from(json.content, 'base64').toString());
    const files = tree.tree.filter(file => file.type === 'blob' && file.path.startsWith(prefix)).map(file => {
      if (file.mode !== '100644' && file.mode !== '100755') throw new Error(`Unsupported entry ${file.path}`);
      return { path: file.path.slice(prefix.length), sha: file.sha, size: file.size };
    });
    const skills = files.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file.path)).map(file => ({ id: file.path.split('/')[1], name: file.path.split('/')[1], description: `${definition.name} · ${file.path.split('/')[1]}`, path: file.path }));
    if (!skills.some(skill => skill.id === definition.entry)) throw new Error(`Missing entry skill: ${definition.id}`);
    entries.push({ ...definition, presentation: presentation(upstream), category: definition.category || 'creativity', logo: `assets/skill-logos/${definition.id}.png`, repository: 'openai/plugins', revision, source: `https://github.com/openai/plugins/tree/${revision}/${prefix.slice(0, -1)}`, download: true,
      requirements: definition.requirements || (definition.url ? '安装后自动在系统浏览器打开官方登录授权页面。完成授权后启用；功能可用范围取决于账号套餐与服务权限。' : '安装时从公开上游下载工作流与参考资源。使用已有 Agent 工具，涉及外部服务时另行连接。'),
      manifest: { schemaVersion: 1, id: definition.id, name: definition.name, version: upstream.version, description: definition.description, author: upstream.author?.name || '', license: upstream.license || 'Upstream service terms', instructions: 'yan-instructions.md', skills, resources: [], ...(definition.platforms ? { platforms: definition.platforms } : {}), ...(definition.requiredCommands ? { requiredCommands: definition.requiredCommands } : {}), mcpServers: definition.mcpServers || (definition.url ? [{ id: definition.id, type: 'remote', url: definition.url, auth: 'oauth' }] : []) }, files });
  }
  fs.writeFileSync(path.resolve(__dirname, '../lib/plugins/remote-catalog.json'), JSON.stringify(entries, null, 2) + '\n');
  console.log(entries.map(item => `${item.id}: ${item.files.length} files, ${item.manifest.skills.length} skills`).join('\n'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
