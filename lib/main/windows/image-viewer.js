'use strict';

const path = require('path');
const fs = require('fs');

function createImageViewer({ BrowserWindow, nativeImage, nativeTheme, appRoot, lightWindowIconPngPath, lightWindowIconIcoPath, darkWindowIconPngPath, darkWindowIconIcoPath, generatedImageViewers, windowsAppId }) {
  // The window/taskbar icon follows the OS light/dark theme: the light-colored
  // logo (light-*) on dark systems, the dark-colored logo (dark-*) on light
  // systems. Shell icon paths must resolve to a physical file outside app.asar.
  function themedIconPaths() {
    // Windows lets users choose different colors for apps and the Shell.
    // Taskbar/tray contrast must follow the latter, even when apps are light.
    const darkSystem = nativeTheme?.shouldUseDarkColorsForSystemIntegratedUI
      ?? nativeTheme?.shouldUseDarkColors
      ?? true;
    return darkSystem
      ? { png: lightWindowIconPngPath, ico: lightWindowIconIcoPath }
      : { png: darkWindowIconPngPath, ico: darkWindowIconIcoPath };
  }

  function windowIconPngPath() {
    return themedIconPaths().png;
  }

  function loadAppIcon() {
    // Read through Electron's ASAR-aware fs, then decode pixels. Shell icon
    // paths below must instead point to a physical file outside app.asar.
    const { png, ico } = themedIconPaths();
    let icon = nativeImage.createFromBuffer(fs.readFileSync(png));
    if (icon.isEmpty()) icon = nativeImage.createFromPath(ico);
    return icon;
  }

  function applyWindowIcon(win) {
    if (!win || win.isDestroyed()) return;
    const icon = loadAppIcon();
    if (!icon.isEmpty()) win.setIcon(icon);
    if (process.platform === 'win32') {
      const shellIcon = themedIconPaths().ico.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
      win.setAppDetails({
        appId: windowsAppId,
        appIconPath: shellIcon,
        appIconIndex: 0,
        relaunchCommand: `"${process.execPath}"${appRoot.endsWith('app.asar') ? '' : ` "${appRoot}"`}`,
        relaunchDisplayName: 'Yan Agent'
      });
    }
  }


  function showImageViewerWindow(key, query) {
    const existing = generatedImageViewers.get(key);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return { ok: true };
    }
    const viewer = new BrowserWindow({
      width: 1080,
      height: 760,
      minWidth: 560,
      minHeight: 420,
      title: '图片预览',
      backgroundColor: '#111111',
      show: false,
      autoHideMenuBar: true,
      icon: windowIconPngPath(),
      webPreferences: {
        preload: path.join(appRoot, 'renderer', 'image-viewer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    generatedImageViewers.set(key, viewer);
    viewer.on('page-title-updated', event => {
      event.preventDefault();
      viewer.setTitle('图片预览');
    });
    viewer.loadFile(path.join(appRoot, 'renderer', 'image-viewer', 'index.html'), {
      query
    });
    viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    viewer.once('ready-to-show', () => {
      applyWindowIcon(viewer);
      viewer.show();
    });
    viewer.on('closed', () => generatedImageViewers.delete(key));
    return { ok: true };
  }

  return { loadAppIcon, applyWindowIcon, showImageViewerWindow, windowIconPngPath };
}

module.exports = { createImageViewer };
