'use strict';
const SHORTCUTS = ['Alt+Alt', 'Shift+Shift'];
function normalize(value = {}) {
  return {
    shortcut: SHORTCUTS.includes(value?.shortcut) ? value.shortcut : 'Alt+Alt',
    destination: ['auto', 'current', 'new'].includes(value?.destination) ? value.destination : 'auto',
    sound: value?.sound !== false,
    soundId: 'ding',
    soundVolume: Math.max(0, Math.min(100, Number.isFinite(Number(value?.soundVolume)) ? Number(value.soundVolume) : 60)),
    customSound: typeof value?.customSound === 'string' ? value.customSound : '',
    customSoundName: typeof value?.customSoundName === 'string' ? value.customSoundName : ''
  };
}
module.exports = { normalize, SHORTCUTS };
