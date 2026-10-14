'use strict';
function normalizeBrowserPreferences(value = {}) {
  return {
    enabled: value?.enabled !== false,
    webTarget: value?.webTarget === 'builtin' ? 'builtin' : 'external',
    localTarget: value?.localTarget === 'external' ? 'external' : 'builtin',
    agentExposure: value?.agentExposure === 'manual' ? 'manual' : 'always',
    showFullUrl: value?.showFullUrl === true,
    downloadDirectory: typeof value?.downloadDirectory === 'string' && require('path').isAbsolute(value.downloadDirectory) ? value.downloadDirectory : '',
    askDownloadLocation: value?.askDownloadLocation === true,
    historyPolicy: ['ask', 'allow', 'deny'].includes(value?.historyPolicy) ? value.historyPolicy : 'ask',
    siteToolsEnabled: value?.siteToolsEnabled !== false
  };
}
module.exports = { normalizeBrowserPreferences };
