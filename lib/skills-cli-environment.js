'use strict';

const path = require('path');
const { shellEnvironment } = require('./shell-network');

// The official skills CLI deliberately runs with a private HOME so that a
// stale global git config cannot change install behavior. That also hides the
// user's global `http.proxy`, so Git/curl would otherwise try to reach GitHub
// directly even though Yan's shell tools already know the Windows proxy.
// Build the child environment through the same proxy resolver used by Bash.
function officialSkillsCliEnvironment({ runtimeHome, runtimeTemp, inherited = process.env, readProxy } = {}) {
  const home = String(runtimeHome || '');
  const temp = String(runtimeTemp || home);
  return {
    ...shellEnvironment(inherited, readProxy),
    ELECTRON_RUN_AS_NODE: '1',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    TEMP: temp,
    TMP: temp,
    CI: '1',
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0'
  };
}

module.exports = { officialSkillsCliEnvironment };
