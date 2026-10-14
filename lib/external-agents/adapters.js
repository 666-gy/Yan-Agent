'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { PROVIDERS } = require('./preferences');

const GUI_UNAVAILABLE = '桌面桥未安装；请构建或重新安装含桌面桥的 Yan Agent。';

function environment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(YAN_|ELECTRON_|CLAUDECODE$|CODEX_THREAD_ID$|CODEX_TURN_ID$|CODEX_SESSION_ID$)/.test(key)) delete env[key];
  return env;
}

async function desktopMetadata(provider, configured, execute) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // PowerShell cannot read Electron's virtual asar paths. lib/** is unpacked
  // by the existing packaging configuration.
  const detector = path.join(__dirname, 'detect-desktop.ps1').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  return new Promise(resolve => execute(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', detector
  ], { windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024,
    env: { ...environment(), YAN_DESKTOP_PROVIDER: provider, YAN_DESKTOP_EXECUTABLE: configured } },
  (error, stdout) => resolve({ error, stdout: String(stdout || '') })));
}

// Installation is not a connection. Inspect metadata without executing an
// arbitrary selected binary, reading credentials, or invoking a model CLI.
async function probe(provider, configured = '', { execute = execFile, platform = process.platform, dataDir, bridgeReady = () => require('./desktop').ready() } = {}) {
  if (!PROVIDERS.includes(provider)) throw new Error('不支持的 Agent');
  if (provider === 'reasonix') {
    let installed = false, client, version = '';
    try {
      require('./reasonix').installation(configured); installed = true;
      if (platform === 'win32') {
        const metadata = await desktopMetadata(provider, configured, execute);
        if (!metadata.error) {
          try { version = JSON.parse(metadata.stdout.replace(/^\uFEFF/, '').trim()).version || ''; } catch {}
        }
      }
      client = await require('./reasonix').connect(configured, { dataDir });
      return { provider, transport: 'reasonix-desktop', installed, version, available: true, connected: true,
        executable: configured, connection_state: 'connected', error: '', detail: '已配对 RS 桌面；派发到当前工作区已打开的空白会话' };
    } catch (error) { return { provider, transport: 'reasonix-desktop', installed, version, available: false, connected: false, error: error.message }; }
    finally { client?.close(); }
  }

  const base = { provider, transport: 'desktop-gui', available: false, connected: false,
    installed: false, authentication: 'unchecked', error: GUI_UNAVAILABLE };
  if (platform !== 'win32') return { ...base, error: '当前桌面协同仅支持 Windows。' };
  if (configured && (!path.isAbsolute(configured) || !/\.exe$/i.test(configured))) {
    return { ...base, error: '请选择桌面应用的 .exe 绝对路径，不支持 CLI 或脚本。' };
  }
  const result = await desktopMetadata(provider, configured, execute);
  if (result.error) return { ...base, error: '桌面程序检测失败，请检查安装或手动选择桌面应用。' };
  try {
    const detected = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
    const available = detected.installed === true && bridgeReady();
    return { ...base, installed: detected.installed === true, available,
      connection_state: available ? 'ready-to-connect' : 'unavailable',
      executable: typeof detected.executable === 'string' ? detected.executable : '',
      version: typeof detected.version === 'string' ? detected.version : '',
      error: detected.installed === true ? available ? '' : GUI_UNAVAILABLE : detected.reason === 'not-desktop'
        ? '所选程序不是可识别的桌面应用；请重新选择桌面主程序，不能使用 CLI。'
        : '未找到桌面应用；请选择桌面主程序，不能使用 CLI。' };
  } catch { return { ...base, error: '桌面程序检测返回无效数据。' }; }
}

module.exports = { environment, probe, GUI_UNAVAILABLE };
