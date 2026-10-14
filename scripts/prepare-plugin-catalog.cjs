'use strict';
// Maintainer-only import. Verify local upstream bytes against a pinned public Git
// tree; never read account settings or install from renderer-supplied paths.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('yaml');
const { inventory, readManifest } = require('../lib/plugins/manifest');
const root = path.resolve(__dirname, '..');
const revision = '1dc195897af4161d039b80d8471ec0a10c9bbc89';
const definitions = [
  { id: 'remotion', name: 'Remotion', version: '1.0.7', author: 'Remotion', license: 'MIT', description: '用 React 制作视频，涵盖动画、字幕、音频、地图与渲染。', prefix: 'skills/remotion-best-practices/', entry: 'skills/remotion-best-practices/SKILL.md', requirements: '工作流与参考资源可直接加载；制作和渲染视频时需要 Node.js、项目依赖和浏览器。Remotion 框架及商业使用遵循其独立许可。' },
  { id: 'hyperframes', name: 'HyperFrames by HeyGen', version: '0.1.2', author: 'HeyGen', license: 'Apache-2.0', description: '将 HTML 制作为视频，包含编排、GSAP 动画、CLI 与网站转视频工作流。', prefix: 'skills/', entry: 'skills/hyperframes/SKILL.md', requirements: '工作流与参考资源可直接加载；制作和渲染视频时需要 Node.js、HyperFrames CLI 及其运行依赖。语音等在线功能可能需要独立账号。' }
];
async function main() {
  const cache = process.argv[2];
  if (!cache) throw new Error('Usage: node scripts/prepare-plugin-catalog.cjs <upstream-plugin-cache>');
  const response = await fetch(`https://api.github.com/repos/openai/plugins/git/trees/${revision}?recursive=1`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub tree: ${response.status}`);
  const tree = await response.json();
  if (tree.truncated || tree.sha !== revision) throw new Error('Incomplete or unexpected upstream tree');
  const catalog = [];
  for (const item of definitions) {
    const source = path.resolve(cache, item.id, revision.slice(0, 8));
    const destination = path.join(root, 'lib/plugins/catalog', item.id);
    const upstreamPrefix = `plugins/${item.id}/`;
    const files = tree.tree.filter(file => file.type === 'blob' && file.path.startsWith(upstreamPrefix)
      && (file.path.slice(upstreamPrefix.length).startsWith(item.prefix) || file.path === `${upstreamPrefix}.codex-plugin/plugin.json`));
    const verified = files.map(file => {
      const relative = file.path.slice(upstreamPrefix.length);
      const bytes = fs.readFileSync(path.join(source, relative));
      const sha = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (sha !== file.sha || file.mode !== '100644') throw new Error(`Upstream verification failed: ${file.path}`);
      return { relative, bytes };
    });
    const upstream = JSON.parse(verified.find(file => file.relative === '.codex-plugin/plugin.json').bytes);
    if (upstream.license !== item.license || upstream.version !== item.version) throw new Error('Upstream manifest changed');
    for (const file of verified) {
      const target = path.join(destination, file.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.bytes);
    }
    const skills = [];
    for (const file of verified) {
      const isSkill = item.id === 'remotion'
        ? file.relative === item.entry || /^skills\/remotion-best-practices\/[^/]+\/REFERENCE\.md$/.test(file.relative)
        : /^skills\/[^/]+\/SKILL\.md$/.test(file.relative);
      if (!isSkill) continue;
      const front = file.bytes.toString().match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const meta = front ? parse(front[1]) : {};
      const id = file.relative === item.entry && item.id === 'remotion' ? 'remotion-best-practices' : path.basename(path.dirname(file.relative));
      skills.push({ id, name: meta.name || id, description: meta.description || `${item.name}: ${id}`, path: file.relative });
    }
    const skillPaths = new Set(skills.map(skill => skill.path));
    const resources = verified.filter(file => file.relative.startsWith('skills/') && !skillPaths.has(file.relative)).map(file => ({
      id: `file-${crypto.createHash('sha256').update(file.relative).digest('hex').slice(0, 16)}`,
      name: file.relative, path: file.relative
    }));
    const entryId = skills.find(skill => skill.path === item.entry).id;
    const instructions = `# ${item.name} for Yan Agent\n\nLoad skill:${entryId} through plugins_read_resource before using this workflow.\nRead referenced files from this pinned package, resolving links relative to the returned resource path. Use the resource list to find their resource IDs. Do not copy paths from another host.\n\nThis package provides workflows and reference resources, not an MCP server or a preinstalled video engine. Use the tools actually available in Yan for file editing, shell execution and browser work. Host-specific tools mentioned upstream are optional; do not invent unavailable tools. Follow the user's task and Yan permissions.\n\n${item.requirements}\n\nUpstream: https://github.com/openai/plugins/tree/${revision}/plugins/${item.id}\n`;
    fs.writeFileSync(path.join(destination, 'instructions.md'), instructions);
    const licenseResponse = await fetch(item.license === 'MIT'
      ? 'https://api.github.com/licenses/mit'
      : 'https://api.github.com/repos/heygen-com/hyperframes/contents/LICENSE', { signal: AbortSignal.timeout(30000) });
    if (!licenseResponse.ok) throw new Error(`License source: ${licenseResponse.status}`);
    const licenseData = await licenseResponse.json();
    let license = licenseData.content ? Buffer.from(licenseData.content, 'base64').toString() : licenseData.body;
    if (typeof license !== 'string' || license.length < 1000) throw new Error('Invalid license text');
    if (item.license === 'MIT') license = license.replace('Copyright (c) [year] [fullname]', 'Copyright (c) Remotion');
    fs.writeFileSync(path.join(destination, 'LICENSE.txt'), license);
    fs.writeFileSync(path.join(destination, 'NOTICE.txt'), `${item.name}\nUpstream author: ${item.author}\nSource: openai/plugins @ ${revision}, plugins/${item.id}\nUpstream license declaration: .codex-plugin/plugin.json (${item.license})\nUpstream workflow files are unmodified and verified against Git blob hashes.\nYan supplies yan-plugin.json, instructions.md and the catalog adapter.\nFrameworks, external services and dependencies retain their own licenses.\n`);
    resources.push({ id: 'license', name: 'License', path: 'LICENSE.txt' }, { id: 'notice', name: 'Source and attribution', path: 'NOTICE.txt' });
    const manifest = { schemaVersion: 1, id: item.id, name: item.name, version: item.version, description: item.description, author: item.author, license: item.license, instructions: 'instructions.md', skills, resources, mcpServers: [] };
    fs.writeFileSync(path.join(destination, 'yan-plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
    readManifest(destination);
    catalog.push({ id: item.id, category: 'creativity', logo: `assets/skill-logos/${item.id}.png`, requirements: item.requirements, revision, repository: 'openai/plugins', source: `https://github.com/openai/plugins/tree/${revision}/plugins/${item.id}`, digest: inventory(destination).digest });
    console.log(`${item.id}: ${skills.length} skills, ${resources.length} resources, verified ${verified.length} upstream files`);
  }
  fs.writeFileSync(path.join(root, 'lib/plugins/catalog/index.json'), JSON.stringify(catalog, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
