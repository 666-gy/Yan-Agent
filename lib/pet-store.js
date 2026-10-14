'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeDataSource } = require('./pet-data');
const BUILTIN_PETS = Object.freeze([
  { id: 'orb', name: 'Yan Agent Orb', description: '随任务状态变化的粒子伙伴。' },
  { id: 'deepseek', name: '大烧货', description: '为桌面添一点活力。' },
  { id: 'claude', name: 'claude', description: '在桌面上与你作伴。' }
]);
const validId = id => /^custom-[a-z0-9][a-z0-9-]{0,63}$/.test(id);
const petRoot = dataDir => path.join(dataDir, 'pets');
function normalizeFrontend(input) {
  if (!input || typeof input !== 'object' || typeof input.html !== 'string' || !input.html.trim()) throw new Error('web 宠物需要 frontend.html');
  const result = {};
  for (const key of ['html', 'css', 'js']) {
    if (input[key] != null && typeof input[key] !== 'string') throw new Error(`frontend.${key} 必须是文本`);
    result[key] = input[key] || '';
  }
  if (Buffer.byteLength(result.html + result.css + result.js) > 512 * 1024) throw new Error('宠物前端不能超过 512 KiB');
  for (const [key, fallback] of [['width', 280], ['height', 180]]) {
    result[key] = input[key] ?? fallback;
    if (!Number.isInteger(result[key]) || result[key] < 100 || result[key] > 800) throw new Error(`frontend.${key} 必须为 100–800 的整数`);
  }
  return result;
}
function safeFile(file) {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
}
function readPet(dataDir, id, artwork = false) {
  if (!validId(id)) return null;
  const dir = path.join(petRoot(dataDir), id);
  try {
    if (fs.lstatSync(petRoot(dataDir)).isSymbolicLink() || fs.lstatSync(dir).isSymbolicLink()) return null;
    const manifest = path.join(dir, 'pet.json');
    const sprite = path.join(dir, 'sprite.png');
    if (!safeFile(manifest) || fs.statSync(manifest).size > 8192) return null;
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (value.id !== id || !['static', 'sprite', 'widget', 'web'].includes(value.layout) || typeof value.name !== 'string') return null;
    let frontend;
    if (value.layout === 'web') {
      const file = path.join(dir, 'frontend.json');
      if (!safeFile(file) || fs.statSync(file).size > 1024 * 1024) return null;
      frontend = normalizeFrontend(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (value.layout === 'widget' && !value.dataSource) return null;
    if (!['widget', 'web'].includes(value.layout) && (!safeFile(sprite) || fs.statSync(sprite).size > 16 * 1024 * 1024)) return null;
    return { id, name: value.name.slice(0, 80), description: String(value.description || '').slice(0, 240),
      layout: value.layout, version: String(value.version || ''),
      dataSource: normalizeDataSource(value.dataSource),
      ...(frontend ? { viewport: { width: frontend.width, height: frontend.height }, ...(artwork ? { frontend } : {}) } : {}),
      ...(artwork && !['widget', 'web'].includes(value.layout) ? { spriteDataUrl: `data:image/png;base64,${fs.readFileSync(sprite).toString('base64')}` } : {}) };
  } catch { return null; }
}
function listPets(dataDir, artwork = false) {
  let names = [];
  try { names = fs.readdirSync(petRoot(dataDir)); } catch {}
  return [...BUILTIN_PETS, ...names.map(id => readPet(dataDir, id, artwork)).filter(Boolean)];
}
function installPet(dataDir, input = {}) {
  const name = String(input.name || '').trim();
  const layout = input.layout || 'sprite';
  if (!name || name.length > 80) throw new Error('宠物名称必须为 1–80 个字符');
  if (!['sprite', 'static', 'widget', 'web'].includes(layout)) throw new Error('layout 必须为 sprite、static、widget 或 web');
  const frontend = layout === 'web' ? normalizeFrontend(input.frontend) : null;
  const dataSource = normalizeDataSource(input.data_source);
  if (layout === 'widget' && !dataSource) throw new Error('功能宠物需要 data_source');
  let bytes;
  if (!['widget', 'web'].includes(layout)) {
    if (input.source_asset_id) {
      const assetId = String(input.source_asset_id);
      if (!/^[a-f0-9]{32}$/.test(assetId)) throw new Error('媒体资产 id 无效');
      const file = path.join(dataDir, 'generated-images', `${assetId}.png`);
      if (fs.existsSync(path.dirname(file)) && fs.lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error('媒体资产目录不可为链接');
      if (!safeFile(file) || fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('PNG 媒体资产不存在或过大');
      bytes = fs.readFileSync(file);
    } else {
      const encoded = String(input.png_base64 || '');
      if (encoded.length > 23 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('PNG 数据无效或过大');
      bytes = Buffer.from(encoded, 'base64');
    }
    if (bytes.length < 45 || bytes.length > 16 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.toString('ascii', 12, 16) !== 'IHDR' || !bytes.includes(Buffer.from('IEND'))) throw new Error('必须提供完整 PNG 图片');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 8192 || height > 8192 || width * height > 32 * 1024 * 1024) throw new Error('PNG 图片尺寸无效或过大');
    let offset = 8, hasData = false, hasEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset + 12 + length > bytes.length) throw new Error('PNG 图片不完整');
      if (offset === 8 && length !== 13) throw new Error('PNG 图片头无效');
      if (type === 'IDAT' && length > 0) hasData = true;
      offset += length + 12;
      if (type === 'IEND') { hasEnd = length === 0; break; }
    }
    if (!hasData || !hasEnd || offset !== bytes.length) throw new Error('PNG 图片不完整');
    if (layout === 'sprite' && (width < 8 || height < 9)) throw new Error('动画图集至少需要 8 列和 9 行');
  }
  const id = `custom-${crypto.randomUUID()}`;
  const root = petRoot(dataDir);
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('宠物目录不可为链接');
  const staging = path.join(root, `.staging-${crypto.randomUUID()}`);
  fs.mkdirSync(staging);
  try {
    const manifest = { id, name, description: String(input.description || '').slice(0, 240), layout, dataSource, version: crypto.randomUUID() };
    if (bytes) fs.writeFileSync(path.join(staging, 'sprite.png'), bytes);
    if (frontend) fs.writeFileSync(path.join(staging, 'frontend.json'), JSON.stringify(frontend));
    fs.writeFileSync(path.join(staging, 'pet.json'), JSON.stringify(manifest));
    fs.renameSync(staging, path.join(root, id));
    return { ok: true, pet: manifest, message: '宠物已安装，Domml 宠物页会自动刷新。' };
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
function deletePet(dataDir, id) {
  if (typeof id !== 'string' || !validId(id)) throw new Error('只能删除用户创建的宠物');
  const root = path.resolve(petRoot(dataDir));
  const target = path.resolve(root, id);
  if (path.dirname(target) !== root || !readPet(dataDir, id)) throw new Error('宠物不存在或目录无效');
  fs.rmSync(target, { recursive: true });
  return { ok: true };
}
module.exports = { BUILTIN_PETS, petRoot, readPet, listPets, installPet, deletePet };
