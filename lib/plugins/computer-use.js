'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { inventory } = require('./manifest');
const { atomicJson, createPluginStore } = require('./store');
const { resolveDriver } = require('../cua-driver-runtime');

const PLUGIN_ID = 'yan-computer-use';
const appRoot = path.resolve(__dirname, '../..');
function trusted(binding) {
  const entry = require('./catalog/index.json').find(item => item.id === PLUGIN_ID);
  return binding?.id === PLUGIN_ID && binding.digest === entry?.digest;
}
function ensureInstalled(store, root = appRoot) {
  if (!resolveDriver(root).available) return;
  const marker = path.join(store.root, 'computer-use-bootstrap.json');
  const current = store.get(PLUGIN_ID);
  // An explicit uninstall stays uninstalled on subsequent launches.
  if (!current && fs.existsSync(marker)) return;
  const source = path.join(__dirname, 'catalog', PLUGIN_ID);
  const entry = require('./catalog/index.json').find(item => item.id === PLUGIN_ID);
  if (inventory(source).digest !== entry.digest) throw new Error('Yan Computer Use 插件完整性检查失败');
  if (!current || current.digest !== entry.digest) {
    store.install(source, entry.digest);
    if (!current) store.update(PLUGIN_ID, { enabled: true });
  }
  if (!fs.existsSync(marker)) atomicJson(marker, { schemaVersion: 1, installed: true });
}
function resolveConfig(binding, config, { dataDir, imageInput = false } = {}) {
  if (!trusted(binding)) return config;
  if (!resolveDriver(appRoot).available) throw new Error('Yan Computer Use 需要 Windows x64 和内置 Cua Driver');
  return { ...config, killTree: false, maxResponseBytes: 32 * 1024 * 1024,
    env: { ...config.env, YAN_COMPUTER_DATA_DIR: dataDir,
      YAN_COMPUTER_OWNER: /^yanp_([a-f0-9]{16})_/.exec(binding.name || '')?.[1] || '',
      YAN_COMPUTER_IMAGE_INPUT: imageInput === true ? 'true' : 'false' } };
}
function skillInventory(dataDir) {
  if (!dataDir) return { fingerprint: '', skills: [] };
  const store = createPluginStore(dataDir);
  const record = store.get(PLUGIN_ID);
  if (!record) return { fingerprint: '', skills: [] };
  const fingerprint = JSON.stringify([record.digest, record.epoch, record.enabled, record.disabledSkills]);
  const root = store.packageRoot(record);
  const ready = store.prepare(record).ready;
  return { fingerprint, skills: store.manifest(record).skills.map(skill => ({
    id: 'yan-computer-use', name: skill.name, desc: skill.description,
    pluginId: PLUGIN_ID, pluginSkillId: skill.id,
    pluginEnabled: record.enabled && ready && !(record.disabledSkills || []).includes(skill.id),
    source: 'plugin', origin: 'Yan Computer Use', installed: true,
    version: record.version, logo: 'assets/skill-logos/computer-use.png',
    tags: ['agent-rules'], aliases: ['电脑操控', 'Windows computer use'],
    triggers: ['操作 Windows 应用', '电脑操控', '桌面操作'],
    runtimeDirectory: path.dirname(path.join(root, skill.path)),
    prompt: fs.readFileSync(path.join(root, skill.path), 'utf8')
  })) };
}
module.exports = { PLUGIN_ID, appRoot, trusted, ensureInstalled, resolveConfig, skillInventory };
