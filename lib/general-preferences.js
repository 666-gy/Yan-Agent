'use strict';

function normalizeGeneralPreferences(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const pick = (key, values, fallback) => values.includes(v[key]) ? v[key] : fallback;
  return {
    compressLocalHistory: v.compressLocalHistory === true,
    blankWorkspace: typeof v.blankWorkspace === 'string' ? v.blankWorkspace : '',
    showContextUsage: v.showContextUsage === true,
    showQuickReview: v.showQuickReview === true,
    promptSuggestions: v.promptSuggestions !== false,
    expandThinking: v.expandThinking !== false,
    expandSubagentPanel: v.expandSubagentPanel !== false,
    followUpMode: pick('followUpMode', ['queue', 'guide'], 'queue'),
    terminalShell: pick('terminalShell', ['git-bash', 'pwsh', 'powershell', 'cmd'], 'git-bash'),
    standaloneQuickChat: v.standaloneQuickChat === true,
    completionNotification: pick('completionNotification', ['always', 'unfocused', 'never'], 'always'),
    permissionNotification: v.permissionNotification !== false,
    questionNotification: v.questionNotification !== false,
    loopNotification: v.loopNotification !== false,
    notificationSound: pick('notificationSound', ['bell', 'chime', 'ding', 'drop', 'pulse', 'arc', 'coin', 'success', 'knock', 'custom', 'none'], 'bell'),
    notificationVolume: Math.max(0, Math.min(100, Number.isFinite(Number(v.notificationVolume)) ? Number(v.notificationVolume) : 60)),
    notificationCustomSound: typeof v.notificationCustomSound === 'string' ? v.notificationCustomSound : '',
    notificationCustomSoundName: typeof v.notificationCustomSoundName === 'string' ? v.notificationCustomSoundName : ''
  };
}

module.exports = { normalizeGeneralPreferences };
