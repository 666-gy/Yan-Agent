'use strict';

// The installer identity (com.yan.agent) stays unchanged for upgrades. Windows
// previously resolved that shared development/production taskbar ID to
// node_modules/electron/dist/electron.exe. Use a stable desktop identity and
// keep both source runs and packaged smoke tests out of its Shell registration.
const DESKTOP_APP_ID = 'com.yan.agent.desktop';
const DEVELOPMENT_APP_ID = 'com.yan.agent.development';
function getWindowsAppId({ isPackaged, isE2EMode = false }) {
  const appId = isPackaged ? DESKTOP_APP_ID : DEVELOPMENT_APP_ID;
  return isE2EMode ? `${appId}.test` : appId;
}

module.exports = { DESKTOP_APP_ID, DEVELOPMENT_APP_ID, getWindowsAppId };
