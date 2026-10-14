'use strict';
const LANGUAGES = Object.freeze(['auto', 'zh', 'en', 'yue', 'ja', 'ko']);
const SOURCES = Object.freeze({ auto: undefined, huggingface: 'https://huggingface.co', mirror: 'https://hf-mirror.com' });
function normalize(value = {}) {
  return { enabled: value?.enabled === true,
    shortcut: /^(?:(?:Ctrl|Alt|Shift|Meta)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(value?.shortcut || '') ? value.shortcut : 'Ctrl+Shift+1',
    language: LANGUAGES.includes(value?.language) ? value.language : 'auto',
    downloadSource: Object.hasOwn(SOURCES, value?.downloadSource) ? value.downloadSource : 'auto' };
}
module.exports = { normalize, LANGUAGES, SOURCES };
