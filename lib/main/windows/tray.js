'use strict';

// Tray (后台保活) (plan T2.5). Moved verbatim from main.js; the tray handle and
// quit flag stay owned by main.js through state cells.

function registerTray(ctx, deps = {}) {
  const { Tray, Menu, nativeImage, app, state } = ctx;
  const { loadAppIcon, togglePetWindow } = deps;
  const { tray, mainWindow, isQuiting } = state;

  // The tray icon follows the OS light/dark theme through loadAppIcon().
  function trayImage() {
    const icon = loadAppIcon();
    return icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 });
  }

  function refreshTrayIcon() {
    const instance = tray.get();
    if (!instance) return;
    const next = trayImage();
    if (!next.isEmpty()) instance.setImage(next);
  }

  function createTray() {
    const trayIcon = trayImage();
    if (trayIcon.isEmpty()) return;
    const instance = new Tray(trayIcon);
    tray.set(instance);
    instance.setToolTip('Yan Agent');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主界面',
        click: () => {
          const win = mainWindow.get();
          if (win) {
            win.show();
            win.focus();
          }
        }
      },
      {
        label: '打开/关闭桌宠',
        click: () => togglePetWindow()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuiting.set(true);
          app.quit();
        }
      }
    ]);

    instance.setContextMenu(contextMenu);

    // 单击托盘图标：显示/隐藏主窗口
    instance.on('click', () => {
      const win = mainWindow.get();
      if (win) {
        if (win.isVisible()) {
          win.hide();
        } else {
          win.show();
          win.focus();
        }
      }
    });

    // 双击托盘图标：显示主窗口
    instance.on('double-click', () => {
      const win = mainWindow.get();
      if (win) {
        win.show();
        win.focus();
      }
    });
  }

  return { createTray, refreshTrayIcon };
}

module.exports = { registerTray };
