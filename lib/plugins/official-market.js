'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { manifestSchema } = require('./manifest');
const safePath = z.string().max(240).regex(/^[a-zA-Z0-9_. /-]+$/).refine(p => p.split('/').every(s => s && s !== '.' && s !== '..' && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)));
const entrySchema = z.object({
 id:z.string().regex(/^YanPlugin-[a-z0-9-]{1,39}$/), name:z.string().min(1).max(100), description:z.string().max(2000),
 category:z.enum(['productivity','creativity','developer-tools']).default('productivity'),
 repository:z.string().regex(/^[a-zA-Z0-9_.-]+\/YanPlugin-[a-z0-9-]+$/), revision:z.string().regex(/^[a-f0-9]{40}$/),
 digest:z.string().regex(/^[a-f0-9]{64}$/), download:z.literal(true), manifest:manifestSchema,
 files:z.array(z.object({path:safePath,bytes:z.number().int().min(0).max(8*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(1000)
}).strict();

const DEFAULT_URL = 'https://raw.githubusercontent.com/666-gy/yan-agent-plugin-market/master/catalog.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cachePath(dataDir) { return path.join(dataDir, 'plugins', 'official-market-cache.json'); }
function validateEntries(value) {
  const plugins = Array.isArray(value) ? value : value?.plugins;
  if (!Array.isArray(plugins)) throw new Error('官方市场清单缺少 plugins 数组。');
  const seen = new Set();
  return plugins.map(item => {
    item = entrySchema.parse(item);
    const id = item.id;
    if (item.manifest.id !== id || item.repository.split('/')[1] !== id) throw new Error('市场清单与插件 ID 不一致');
    const paths = item.files.map(f => f.path.toLowerCase());
    if (new Set(paths).size !== paths.length || !paths.includes('yan-plugin.json') || item.files.reduce((n,f)=>n+f.bytes,0)>64*1024*1024) throw new Error('插件文件清单无效或超限');
    if (!/^YanPlugin-[a-z0-9-]+$/.test(id)) throw new Error(`官方市场插件 ID 不符合 YanPlugin-xxx：${id || '(empty)'}`);
    if (seen.has(id)) throw new Error(`官方市场包含重复插件：${id}`);
    seen.add(id);
    return item;
  });
}
function readCache(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(cachePath(dataDir), 'utf8'));
    return { fetchedAt: Number(value.fetchedAt) || 0, plugins: validateEntries(value.plugins || []) };
  } catch { return { fetchedAt: 0, plugins: [] }; }
}
function writeCache(dataDir, plugins) {
  const file = cachePath(dataDir); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, fetchedAt: Date.now(), plugins }, null, 2) + '\n');
  fs.renameSync(temporary, file);
  return { fetchedAt: Date.now(), plugins };
}
async function refresh(dataDir, fetcher = fetch, url = DEFAULT_URL) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`官方插件市场刷新失败：HTTP ${response.status}`);
  const { readLimited } = require('./native-download');
  const plugins = validateEntries(JSON.parse((await readLimited(response, 4 * 1024 * 1024)).toString('utf8')));
  return writeCache(dataDir, plugins);
}
function status(dataDir) {
  const cache = readCache(dataDir);
  return { cached: cache.plugins.length > 0, fetchedAt: cache.fetchedAt, stale: !cache.fetchedAt || Date.now() - cache.fetchedAt > CACHE_TTL_MS, count: cache.plugins.length };
}
module.exports = { DEFAULT_URL, CACHE_TTL_MS, readCache, refresh, status, validateEntries };
