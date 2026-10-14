'use strict';

function normalizeDataSource(input) {
  if (input == null) return null;
  const url = new URL(String(input.url || ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('宠物数据源需要无内嵌凭据的 HTTPS URL');
  const valuePath = input.value_path;
  if (!Array.isArray(valuePath) || !valuePath.length || valuePath.length > 16
    || valuePath.some(key => typeof key !== 'string' || !key || key.length > 100
      || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('value_path 需要 JSON 字段路径数组');
  const connectionId = input.connection_id == null ? '' : String(input.connection_id);
  if (connectionId.length > 120) throw new Error('连接 ID 过长');
  const multiplier = input.multiplier == null ? 1 : Number(input.multiplier);
  if (!Number.isFinite(multiplier)) throw new Error('multiplier 需要有限数值');
  let subtract = null;
  if (input.subtract_source) {
    if (input.subtract_source.subtract_source) throw new Error('不支持嵌套 subtract_source');
    subtract = normalizeDataSource({ url: input.subtract_source.url, value_path: input.subtract_source.value_path,
      multiplier: input.subtract_source.multiplier });
  }
  return { url: url.href, value_path: valuePath.slice(), connection_id: connectionId,
    multiplier, subtract_source: subtract,
    label: String(input.label || '').slice(0, 60), prefix: String(input.prefix || '').slice(0, 24),
    suffix: String(input.suffix || '').slice(0, 24),
    interval_seconds: Math.max(15, Math.min(86400, Number(input.interval_seconds) || 60)),
    decimals: input.decimals == null ? null : Math.max(0, Math.min(8, Math.round(Number(input.decimals) || 0))) };
}

function connectionHeaders(source, config) {
  if (!source.connection_id) return {};
  const connection = config.api?.connections?.find(item => item.id === source.connection_id && item.enabled !== false);
  const supplier = config.api?.providerSuppliers?.[connection?.providerId]?.find(item => item.id === connection.supplierId);
  const baseUrl = connection?.baseUrl || supplier?.baseUrl;
  const key = connection?.apiKey || supplier?.apiKey;
  if (!baseUrl || !key || supplier?.enabled === false || String(key).startsWith('enc:v1:')) throw new Error('账户连接不可用');
  if (new URL(baseUrl).origin !== new URL(source.url).origin) throw new Error('账户凭据只能用于连接的同源接口');
  return { Authorization: `Bearer ${key}` };
}

async function readScalar(source, { fetch: fetchImpl, config, signal }) {
  const response = await fetchImpl(source.url, { method: 'GET',
    headers: { Accept: 'application/json', ...connectionHeaders(source, config) },
    redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  if (!response.ok) { void response.body?.cancel(); throw new Error(`数据源返回 HTTP ${response.status}`); }
  const reader = response.body.getReader();
  let bytes = 0; const chunks = [];
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 128 * 1024) throw new Error('数据源响应过大');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  for (const key of source.value_path) {
    if (value == null || !Object.hasOwn(Object(value), key)) throw new Error('数据源缺少指定字段');
    value = value[key];
  }
  if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('数据字段必须是文本、数字或布尔值');
  return value;
}

async function readPetData(source, { fetch: fetchImpl = globalThis.fetch, config = {}, signal } = {}) {
  if (config.permissions?.allowNetwork === false) throw new Error('当前用户设置未允许联网');
  const normalized = normalizeDataSource(source);
  const options = { fetch: fetchImpl, config, signal };
  // Validate every authenticated destination before sending any request.
  connectionHeaders(normalized, config);
  const subtract = normalized.subtract_source ? { ...normalized.subtract_source, connection_id: normalized.connection_id } : null;
  if (subtract) connectionHeaders(subtract, config);
  let value = await readScalar(normalized, options);
  if (normalized.multiplier !== 1 || subtract) {
    if (typeof value !== 'number') throw new Error('数值换算需要数字字段');
    value *= normalized.multiplier;
    if (subtract) {
      const used = await readScalar(subtract, options);
      if (typeof used !== 'number') throw new Error('数值换算需要数字字段');
      value -= used * subtract.multiplier;
    }
    if (!Number.isFinite(value)) throw new Error('数值换算结果无效');
  }
  const rendered = typeof value === 'number' && normalized.decimals != null ? value.toFixed(normalized.decimals) : String(value);
  return { value: typeof value === 'string' ? value.slice(0, 160) : value, text: `${normalized.prefix}${rendered.slice(0, 160)}${normalized.suffix}`, label: normalized.label, updatedAt: Date.now(), status: 'ready' };
}

function createPetDataPoller({ emit, loadConfig, fetch: fetchImpl }) {
  let current = null, timer = null, controller = null, generation = 0;
  const stop = () => { generation++; clearTimeout(timer); timer = null; controller?.abort(); controller = null; current = null; };
  async function refresh() {
    if (!current || controller) return;
    clearTimeout(timer); timer = null;
    const version = generation, selected = current;
    controller = new AbortController();
    emit({ petId: selected.id, status: 'loading' });
    try {
      const result = await readPetData(selected.source, { fetch: fetchImpl, config: loadConfig(), signal: controller.signal });
      if (version === generation) emit({ petId: selected.id, ...result });
    } catch {
      // Remote bodies and transport errors can include secrets. Only send a
      // fixed status to the renderer; retain its last successful value.
      if (version === generation) emit({ petId: selected.id, status: 'error', error: '数据暂不可用', updatedAt: Date.now() });
    } finally {
      if (version === generation) {
        controller = null;
        timer = setTimeout(refresh, selected.source.interval_seconds * 1000); timer.unref?.();
      }
    }
  }
  function select(pet) {
    const next = pet?.dataSource ? { id: pet.id, source: normalizeDataSource(pet.dataSource) } : null;
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    stop(); current = next;
    if (current) void refresh();
  }
  return { select, refresh, stop };
}

module.exports = { normalizeDataSource, connectionHeaders, readPetData, createPetDataPoller };
