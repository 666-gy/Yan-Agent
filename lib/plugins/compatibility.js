'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inventory, packageFile } = require('./manifest');
const { inspectPackage } = require('./creation');

function installExternal(source, store, { allowCompatibility = false } = {}) {
  source = fs.realpathSync(source);
  if (fs.existsSync(path.join(source, 'yan-plugin.json'))) {
    const report = inspectPackage(source);
    const plugin = store.install(source, report.digest);
    return { ...report, ok: true, installed: true, enabled: plugin.enabled, path: store.packageRoot(plugin), plugin };
  }
  const manifestFile = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']
    .find(file => fs.existsSync(path.join(source, file)));
  if (!manifestFile) return { ok: false, installed: false, compatible: false, reason: '未识别插件格式。可在任务中检查源码并制作 Yan 兼容副本；这不是官方来源限制。' };
  const pack = inventory(source);
  const upstream = JSON.parse(fs.readFileSync(packageFile(source, manifestFile), 'utf8'));
  const warnings = ['该插件未针对 Yan 适配，可以尝试兼容导入 Skill 和 MCP；不保证原插件的全部功能可用。',
    'hooks、命令、Agent 定义、UI 扩展及宿主账号连接不会自动生效；外部依赖和运行效果需单独验证。'];
  if (!allowCompatibility) return { ok: false, installed: false, compatible: false, compatibilityAvailable: true,
    reason: warnings.join('\n'), warnings, name: upstream.name || path.basename(source) };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-compat-'));
  try {
    for (const file of pack.files) {
      const target = path.join(temporary, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(packageFile(source, file.path), target);
    }
    if (inventory(temporary).digest !== pack.digest) throw new Error('插件在复制期间发生变化，请重试');
    require('./official-package-adapter').adaptOfficialPackage(temporary);
    const report = inspectPackage(temporary);
    const plugin = store.install(temporary, report.digest, { originalSource: source });
    return { ...report, ok: true, installed: true, compatible: false, compatibilityMode: true,
      enabled: plugin.enabled, path: store.packageRoot(plugin), plugin, warnings,
      note: `已安装兼容副本，${plugin.enabled ? '保持启用' : '当前关闭，请启用'}并验证。原始源码未修改。` };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { installExternal };
