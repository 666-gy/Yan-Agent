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
  { id: 'game-studio', name: 'Game Studio', category: 'developer-tools', description: '设计、开发和测试浏览器游戏，涵盖 2D、3D、素材制作与试玩。', entry: 'game-studio', website: 'https://openai.com/', requirements: '提供游戏规划、Phaser、Three.js、React Three Fiber 与试玩工作流。项目依赖、浏览器、Blender 或素材生成工具按具体任务准备。', runtimeInstructions: 'Start with game-studio, then read web-game-foundations and the selected engine skill. Use available Yan browser, shell and file tools. Image generation, Blender and browser automation are optional capabilities: check availability before promising them.' },
  { id: 'circleci', name: 'CircleCI', logoDark: 'assets/skill-logos/circleci-dark.png', category: 'developer-tools', description: '优化持续集成配置，诊断构建失败，并使用 CircleCI CLI 和 Chunk 工作流。', entry: 'config', website: 'https://circleci.com/', requirements: '配置审阅可直接使用。操作云端构建需 CircleCI 账号和对应 CLI；使用前检查已安装 CLI 的帮助，再通过其官方浏览器登录流程授权。Chunk CLI 目前需要 macOS 或 Linux。', runtimeInstructions: 'Route config optimization to skill:config, build failures to skill:builds, CircleCI CLI work to skill:cli, and Chunk work to skill:chunk. Installing these workflows does not require login. For cloud operations, check the installed CLI help and account state first. Follow the installed CLI help and the bundled official references for browser-based login or signup. Use an available system-browser opener for the official authorization URL when required; never invent CLI commands. Opening the website alone does not authenticate the CLI. Never request account passwords or log tokens. Chunk CLI is macOS/Linux only.' },
  { id: 'build-ios-apps', name: 'Build iOS Apps', category: 'developer-tools', description: '构建和调试 iOS 应用，包含 SwiftUI、App Intents、模拟器和性能分析。', entry: 'ios-debugger-agent', website: 'https://developer.apple.com/xcode/', platforms: ['darwin'], requiredCommands: ['xcodebuild', 'xcrun', 'node'], requirements: '运行需要 macOS、完整 Xcode、模拟器与 Node.js。首次激活通过 npx 获取固定版本 XcodeBuildMCP 2.7.0；Windows 上仅可安装和查看内容。签名与发布按任务连接 Apple 开发者账号。', runtimeInstructions: 'This package runs on macOS with Xcode. Confirm the active Xcode developer directory, SDK and simulator availability before building. Yan connects the pinned XcodeBuildMCP service for simulator, UI automation, debugging and logging. Match its actual tool descriptions and schemas; do not copy Codex tool prefixes. Simulator browser mirroring is optional and requires an available host browser integration. Do not claim Xcode builds or simulator execution succeeded on Windows.', mcpServers: [{ id: 'xcodebuildmcp', type: 'local', command: 'npx', args: ['-y', 'xcodebuildmcp@2.7.0', 'mcp'], env: { XCODEBUILDMCP_ENABLED_WORKFLOWS: 'simulator,ui-automation,debugging,logging' }, timeoutMs: 120000 }] },
  { id: 'build-macos-apps', name: 'Build macOS Apps', category: 'developer-tools', description: '构建、调试和优化 macOS 应用，覆盖 SwiftUI、AppKit、签名与发布准备。', entry: 'build-run-debug', website: 'https://developer.apple.com/xcode/', platforms: ['darwin'], requiredCommands: ['xcodebuild', 'xcrun', 'swift'], requirements: '运行需要 macOS 与完整 Xcode / Swift 工具链；Windows 上仅可安装和查看内容。构建、日志和调试通过现有终端工具执行，签名及公证按任务准备开发者账号。', runtimeInstructions: 'This package runs on macOS. Start with build-run-debug and route to the other skills as needed. Use Yan shell tools for xcodebuild, swift, lldb, codesign, spctl and log commands after checking availability. Codex-specific Run buttons and environment metadata are not Yan features; preserve project scripts and use available tools. Signing and notarization credentials are only needed for the requested distribution task. Never claim macOS native execution on Windows.' }
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
