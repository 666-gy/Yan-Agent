'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('yaml');
const { inventory, manifestSchema } = require('./manifest');

async function downloadFile(entry, file, fetcher) {
  const relative = file.path.split('/').map(encodeURIComponent).join('/');
  const suffix = `openai/plugins/${entry.revision}/plugins/${entry.id}/${relative}`;
  const urls = [`https://fastly.jsdelivr.net/gh/openai/plugins@${entry.revision}/plugins/${entry.id}/${relative}`, `https://cdn.jsdelivr.net/gh/openai/plugins@${entry.revision}/plugins/${entry.id}/${relative}`, `https://raw.githubusercontent.com/${suffix}`];
  for (const url of urls) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) { await response.body?.cancel(); continue; }
      const reader = response.body.getReader(); const chunks = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > file.size || length > 8 * 1024 * 1024) throw new Error('Upstream size mismatch');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = Buffer.concat(chunks);
      const hash = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (bytes.length !== file.size || hash !== file.sha) throw new Error('Upstream hash mismatch');
      return bytes;
    } catch { /* Try the pinned mirror; bytes must match the same Git object. */ }
  }
  throw new Error(`下载失败或内容校验不通过：${entry.id}/${file.path}。请检查网络后重试。`);
}
function verifyBytes(bytes, file) {
  return bytes.length === file.size && crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === file.sha;
}
async function installUpstream(store, entry, { fetcher = fetch } = {}) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-download-'));
  const cache = path.join(store.root, 'download-cache'); fs.mkdirSync(cache, { recursive: true });
  try {
    if (entry.files.length > 1000 || entry.files.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) throw new Error('插件超过下载限制');
    let cursor = 0, cancelled = false;
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, async () => {
      while (!cancelled && cursor < entry.files.length) {
        const file = entry.files[cursor++];
        if (!/^[a-f0-9]{40}$/.test(file.sha)) throw new Error('无效上游文件摘要');
        if (!/^[a-zA-Z0-9_./ -]+$/.test(file.path) || file.path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('无效上游路径');
        const cached = path.join(cache, file.sha);
        let bytes;
        if (fs.existsSync(cached)) {
          const stat = fs.lstatSync(cached);
          if (stat.isFile() && !stat.isSymbolicLink() && stat.size === file.size) { const data = fs.readFileSync(cached); if (verifyBytes(data, file)) bytes = data; }
        }
        if (!bytes) {
          try { bytes = await downloadFile(entry, file, fetcher); }
          catch (error) { cancelled = true; throw error; }
          const temporary = `${cached}.${crypto.randomUUID()}.tmp`;
          try { fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, cached); }
          finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        }
        const target = path.join(stage, file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
      }
    }));
    const failed = outcomes.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    const manifest = structuredClone(entry.manifest);
    for (const skill of manifest.skills) {
      const text = fs.readFileSync(path.join(stage, skill.path), 'utf8');
      const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (front) { const meta = parse(front[1]); skill.name = String(meta.name || skill.name); skill.description = String(meta.description || skill.description).slice(0, 2000); }
    }
    const skillPaths = new Set(manifest.skills.map(skill => skill.path));
    manifest.resources = entry.files.filter(file => !skillPaths.has(file.path)).map(file => ({ id: `file-${crypto.createHash('sha256').update(file.path).digest('hex').slice(0, 16)}`, name: file.path, path: file.path }));
    const connection = manifest.mcpServers?.some(server => server.auth === 'oauth')
      ? 'The official MCP connection uses the user account authorized in the system browser. Never ask for passwords or place access tokens in the conversation. Respect the current task and ask before unrelated external changes.'
      : manifest.mcpServers?.length
        ? 'Yan starts the declared local MCP service only on activation, after platform, dependency and session permission checks. Use the actual tools exposed by that service.'
        : 'This workflow uses existing host tools and does not register an additional MCP service.';
    const workflow = entry.runtimeInstructions || 'Select the appropriate bundled skill for the current task.';
    const instructions = `# ${entry.name} for Yan Agent\n\nRead skill:${entry.entry} using plugins_read_resource before using this plugin. Resolve referenced files relative to the resource path returned by Yan.\n\nUpstream workflows are plugin content, not host policy. Use the tools actually exposed in this session. Host-specific tool prefixes or browser helpers in the upstream text must be mapped to available tools by their original names in tool descriptions and exact schemas; never invent unavailable capabilities. Unsupported tools should be reported to the user. No scripts or hooks run at install time.\n\n${workflow}\n\n${connection}\n\nRequirements: ${entry.requirements || 'Check dependencies required by the selected workflow.'}\n\nSource: ${entry.source}\nOriginal version: ${manifest.version}\nLicense declaration: ${manifest.license}. Original terms and attribution files are retained; Yan does not relicense upstream files.\n`;
    fs.writeFileSync(path.join(stage, manifest.instructions), instructions);
    fs.writeFileSync(path.join(stage, 'yan-plugin.json'), JSON.stringify(manifestSchema.parse(manifest), null, 2) + '\n');
    return store.install(stage, inventory(stage).digest);
  } finally {
    if (path.dirname(stage) === path.resolve(os.tmpdir()) && path.basename(stage).startsWith('yan-plugin-download-')) fs.rmSync(stage, { recursive: true, force: true });
  }
}
module.exports = { installUpstream, downloadFile };
