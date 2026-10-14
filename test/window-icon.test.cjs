'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createImageViewer } = require('../lib/main/windows/image-viewer');
const { registerTray } = require('../lib/main/windows/tray');
const { DESKTOP_APP_ID, DEVELOPMENT_APP_ID, getWindowsAppId } = require('../lib/main/windows/app-identity');

test('Windows separates installed, development and test application registrations', () => {
  assert.equal(getWindowsAppId({ isPackaged: true }), DESKTOP_APP_ID);
  assert.equal(getWindowsAppId({ isPackaged: false }), DEVELOPMENT_APP_ID);
  const testIds = [true, false].map(isPackaged => getWindowsAppId({ isPackaged, isE2EMode: true }));
  assert.equal(new Set([DESKTOP_APP_ID, DEVELOPMENT_APP_ID, ...testIds, 'com.yan.agent']).size, 5);
  const installer = fs.readFileSync(path.join(__dirname, '../build/installer.nsh'), 'utf8');
  assert.ok(installer.includes(`!define YAN_DESKTOP_APP_ID "${DESKTOP_APP_ID}"`));
  for (const link of ['newStartMenuLink', 'newDesktopLink']) assert.ok(installer.includes(`WinShell::SetLnkAUMI "$${link}" "` + '${YAN_DESKTOP_APP_ID}"'));
  assert.equal(require('../package.json').build.appId, 'com.yan.agent', 'Preserve the installer upgrade identity');
});

test('window and tray icons follow Shell colors on startup and after theme changes', () => {
  const assets = path.resolve(__dirname, '../renderer/assets');
  const nativeTheme = { shouldUseDarkColors: false, shouldUseDarkColorsForSystemIntegratedUI: true };
  const nativeImage = {
    createFromBuffer: bytes => ({ bytes, isEmpty: () => false, resize() { return this; } })
  };
  const factory = createImageViewer({
    appRoot: path.resolve(__dirname, '..'), nativeImage, nativeTheme,
    lightWindowIconPngPath: path.join(assets, 'logo-light.png'),
    lightWindowIconIcoPath: path.join(assets, 'logo-light.ico'),
    darkWindowIconPngPath: path.join(assets, 'logo-dark.png'),
    darkWindowIconIcoPath: path.join(assets, 'logo-dark.ico'),
    generatedImageViewers: new Map(), windowsAppId: DEVELOPMENT_APP_ID
  });
  let instance, windowIcon, shellDetails;
  const win = {
    isDestroyed: () => false,
    setIcon: icon => { windowIcon = icon; },
    setAppDetails: details => { shellDetails = details; }
  };
  const tray = registerTray({
    Tray: class {
      constructor(icon) { this.icon = icon; }
      setImage(icon) { this.icon = icon; }
      setToolTip() {} setContextMenu() {} on() {}
    },
    Menu: { buildFromTemplate: items => items }, nativeImage, app: {},
    state: {
      tray: { get: () => instance, set: value => { instance = value; } },
      mainWindow: { get: () => win }, isQuiting: { set() {} }
    }
  }, { loadAppIcon: factory.loadAppIcon });
  tray.createTray();
  for (const [darkSystem, darkApps, name] of [
    [true, false, 'light'], [false, true, 'dark'], [true, true, 'light']
  ]) {
    nativeTheme.shouldUseDarkColorsForSystemIntegratedUI = darkSystem;
    nativeTheme.shouldUseDarkColors = darkApps;
    factory.applyWindowIcon(win);
    tray.refreshTrayIcon();
    const png = path.join(assets, `logo-${name}.png`);
    assert.equal(factory.windowIconPngPath(), png);
    assert.deepEqual(windowIcon.bytes, fs.readFileSync(png));
    assert.deepEqual(instance.icon.bytes, windowIcon.bytes);
    if (process.platform === 'win32') assert.equal(shellDetails.appIconPath, path.join(assets, `logo-${name}.ico`));
  }
});

test('taskbar identity points to an unpacked ICO and the actual relaunch executable', { skip: process.platform !== 'win32' }, () => {
  const icons = [], details = [];
  const icon = { isEmpty: () => false };
  const appRoot = 'C:\\Program Files\\Yan Agent\\resources\\app.asar';
  const factory = createImageViewer({
    appRoot,
    windowsAppId: DESKTOP_APP_ID,
    nativeTheme: { shouldUseDarkColors: false, shouldUseDarkColorsForSystemIntegratedUI: true },
    lightWindowIconPngPath: path.resolve('renderer/assets/logo-light.png'),
    lightWindowIconIcoPath: path.join(appRoot, 'renderer/assets/logo-light.ico'),
    nativeImage: { createFromBuffer(bytes) { assert.ok(bytes.length > 0); return icon; } },
    generatedImageViewers: new Map()
  });
  factory.applyWindowIcon({ isDestroyed: () => false, setIcon: value => icons.push(value), setAppDetails: value => details.push(value) });
  assert.deepEqual(icons, [icon]);
  assert.equal(details[0].appId, DESKTOP_APP_ID);
  assert.equal(details[0].appIconPath, 'C:\\Program Files\\Yan Agent\\resources\\app.asar.unpacked\\renderer\\assets\\logo-light.ico');
  assert.equal(details[0].relaunchCommand, `"${process.execPath}"`);
  assert.equal(details[0].relaunchDisplayName, 'Yan Agent');
  factory.applyWindowIcon({ isDestroyed: () => true });
  assert.equal(details.length, 1);
});
