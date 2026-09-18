'use strict';

// The vision-relay switch first shipped as `api.visionRelayDisabled`
// (true = relay off). Configurations written by that build still carry the old
// key, and the current `api.visionRelayEnabled` default (true) would silently
// re-enable the relay for an upgraded user who had turned it off. Honor the old
// intent exactly once and drop the stale key so the next save persists the
// migrated state.
function migrateVisionRelaySwitch(api = {}) {
  const target = api && typeof api === 'object' ? api : {};
  if (!Object.prototype.hasOwnProperty.call(target, 'visionRelayDisabled')) return false;
  if (target.visionRelayDisabled === true) target.visionRelayEnabled = false;
  delete target.visionRelayDisabled;
  return true;
}

module.exports = { migrateVisionRelaySwitch };
