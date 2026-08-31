'use strict';

// Compatibility presets for user-defined API connections. The UI form is
// vendor-free; these helpers infer the request shape (DSML, anthropic format,
// media body shapes) from the connection name/URL unless the user picks one
// explicitly. No model or vendor list is required to stay in sync — inference
// is string based and falls back to the generic OpenAI shape.

const CONNECTION_PRESETS = Object.freeze([
  'auto', 'openai', 'anthropic', 'deepseek', 'glm', 'qwen', 'doubao',
  'gemini', 'kimi', 'minimax', 'siliconflow', 'grok', 'agnes', 'stepfun',
  'hunyuan', 'opencode', 'sensenova', 'jiyuan'
]);

function inferConnectionPreset(name, baseUrl) {
  const text = `${name || ''} ${baseUrl || ''}`.toLowerCase();
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('anthropic') || text.includes('claude')) return 'anthropic';
  if (text.includes('gemini') || text.includes('generativelanguage.googleapis.com') || text.includes('google ai')) return 'gemini';
  if (text.includes('kimi') || text.includes('moonshot')) return 'kimi';
  if (text.includes('dashscope') || text.includes('qwen') || text.includes('aliyun')) return 'qwen';
  if (text.includes('bigmodel') || text.includes('zhipu') || /\bglm/.test(text)) return 'glm';
  if (text.includes('doubao') || text.includes('volces') || text.includes('ark.cn')) return 'doubao';
  if (text.includes('minimax')) return 'minimax';
  if (text.includes('siliconflow')) return 'siliconflow';
  if (text.includes('grok') || text.includes('x.ai')) return 'grok';
  if (text.includes('agnes') || text.includes('agnes-ai')) return 'agnes';
  if (text.includes('stepfun') || text.includes('阶跃')) return 'stepfun';
  if (text.includes('hunyuan') || text.includes('混元')) return 'hunyuan';
  if (text.includes('opencode') || text.includes('open code')) return 'opencode';
  if (text.includes('sensenova') || text.includes('sensecore') || text.includes('sensetime') || text.includes('日日新')) return 'sensenova';
  if (text.includes('jiyuan') || text.includes('基元律动') || text.includes('基元')) return 'jiyuan';
  return 'openai';
}

function resolveConnectionPreset(connection, name, baseUrl) {
  const stored = String(connection?.preset || 'auto').trim();
  if (stored && stored !== 'auto' && CONNECTION_PRESETS.includes(stored)) return stored;
  return inferConnectionPreset(name, baseUrl);
}

function apiFormatForPreset(preset) {
  return String(preset || '').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
}

function normalizeConnectionStore(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const providerId = String(item.providerId || '').trim();
    const supplierId = String(item.supplierId || 'official').trim() || 'official';
    if (!id || !providerId || seen.has(id)) continue;
    seen.add(id);
    const preset = CONNECTION_PRESETS.includes(String(item.preset || '')) ? String(item.preset) : 'auto';
    cleaned.push({
      id,
      providerId,
      supplierId,
      preset,
      manualModelId: String(item.manualModelId || '').trim(),
      createdAt: Math.max(0, Number(item.createdAt) || 0)
    });
  }
  return cleaned;
}

module.exports = {
  CONNECTION_PRESETS,
  apiFormatForPreset,
  inferConnectionPreset,
  normalizeConnectionStore,
  resolveConnectionPreset
};
