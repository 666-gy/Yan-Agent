'use strict';

const { inferConnectionPreset, inferPresetFromModel } = require('./connection-presets');
const flags = Object.freeze({ deepseek: 'dsml', glm: 'glmm', qwen: 'qwem', kimi: 'kiml',
  gptl: 'gptl', agnes: 'agnl', gemini: 'geml', grok: 'grol', anthropic: 'antl' });

function resolveProviderAdapter(options, { providerID, providerName, modelID, baseURL }) {
  // An explicit preset must beat a gateway's model alias or vendor hostname.
  const selected = Object.entries(flags).find(([, flag]) => options[flag] === true);
  if (selected) return selected[0];
  if (String(options.apiFormat || '').toLowerCase() === 'gptl') return 'gptl';
  // The selected model identifies the request shape. A relay's name and host
  // are arbitrary, so they are consulted only when the model says nothing —
  // otherwise "DeepSeek 中转" serving a GLM model would send a DSML request.
  // When the model names a family with no dedicated adapter that is still an
  // answer: keep the generic shape instead of letting the connection name pick
  // a vendor adapter for it. Claude now has one — ANTL — so a claude model
  // routed through a relay also gets its cache breakpoints placed.
  const fromModel = inferPresetFromModel(modelID);
  if (fromModel) return flags[fromModel] && options[flags[fromModel]] !== false ? fromModel : '';
  const inferred = inferConnectionPreset(`${providerID} ${providerName}`, baseURL);
  const model = String(modelID || '').split('/').at(-1);
  // Named relays may host other vendors. These adapters are inferred from the
  // name only when the model is consistent with them; explicit presets above
  // still support arbitrary aliases.
  if (inferred === 'qwen' && !/^qwen[-.\d]/i.test(model)) return '';
  if (inferred === 'kimi' && !/^kimi[.\dk-]/i.test(model)) return '';
  return flags[inferred] && options[flags[inferred]] !== false ? inferred : '';
}

module.exports = { resolveProviderAdapter };
