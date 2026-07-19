const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const YANXI_WORKSPACE_HANDOFF_FILE = 'yan-agent-yanxi-code-workspace.json';

function fileExists(candidate) {
  try {
    return !!candidate && fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function getYanxiCodeCandidates(appRoot, env = process.env, platform = process.platform) {
  const siblingRoot = path.join(path.dirname(appRoot), 'Yanxi Code');
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || '';
    const programFiles = env.PROGRAMFILES || 'C:\\Program Files';
    const systemDrive = env.SystemDrive || 'C:';
    return [
      path.join(siblingRoot, 'release', 'win-unpacked', 'Yanxi.exe'),
      path.join(siblingRoot, 'release', 'win-unpacked', 'Yanxi Code.exe'),
      path.join(localAppData, 'Programs', 'Yanxi', 'Yanxi.exe'),
      path.join(localAppData, 'Programs', 'yanxi-code', 'Yanxi.exe'),
      path.join(localAppData, 'Programs', 'Yanxi Code', 'Yanxi Code.exe'),
      path.join(programFiles, 'Yanxi', 'Yanxi.exe'),
      path.join(programFiles, 'Yanxi Code', 'Yanxi Code.exe'),
      path.join(systemDrive, 'yanxi', 'Yanxi Code', 'Yanxi Code.exe'),
      'D:\\yanxi\\Yanxi Code\\Yanxi Code.exe',
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Yanxi.app/Contents/MacOS/Yanxi',
      path.join(siblingRoot, 'release', 'mac', 'Yanxi.app', 'Contents', 'MacOS', 'Yanxi'),
    ];
  }
  return [
    path.join(siblingRoot, 'release', 'linux-unpacked', 'yanxi-code'),
    '/usr/bin/yanxi-code',
  ];
}

function resolveYanxiCodeLaunch(appRoot, config = {}) {
  const configured = config?.yanxiCode?.executable;
  if (fileExists(configured)) {
    return { exe: configured, args: [], mode: 'installed' };
  }

  const siblingRoot = path.join(path.dirname(appRoot), 'Yanxi Code');
  const candidates = getYanxiCodeCandidates(appRoot);

  for (const exe of candidates) {
    if (fileExists(exe)) return { exe, args: [], mode: 'installed', root: siblingRoot };
  }

  const electronExe = process.platform === 'win32'
    ? path.join(siblingRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(siblingRoot, 'node_modules', 'electron', 'dist', 'electron');
  if (fileExists(electronExe) && fileExists(path.join(siblingRoot, 'package.json'))) {
    return { exe: electronExe, args: ['.'], cwd: siblingRoot, mode: 'dev', root: siblingRoot };
  }

  return null;
}

function quoteWindowsArg(value) {
  const input = String(value || '');
  if (input && !/[\s"]/u.test(input)) return input;
  return `"${input.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function writeYanxiWorkspaceHandoff(workspace) {
  const syncPath = path.join(os.tmpdir(), YANXI_WORKSPACE_HANDOFF_FILE);
  const requestId = `yan_agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = {
    source: 'yan-agent',
    requestId,
    workspace,
    consumed: false,
    at: Date.now(),
  };
  const stagedPath = `${syncPath}.${process.pid}.tmp`;
  fs.writeFileSync(stagedPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(stagedPath, syncPath);
  return { syncPath, requestId };
}

function launchWindowsExecutable(exe, args, cwd) {
  const script = [
    '$process = Start-Process',
    '-FilePath $env:YANXI_CODE_EXE',
    '-WorkingDirectory $env:YANXI_CODE_CWD',
    '-ArgumentList $env:YANXI_CODE_ARGUMENTS',
    '-PassThru',
    '-ErrorAction Stop;',
    '[Console]::Out.Write($process.Id)',
  ].join(' ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const env = {
    ...process.env,
    YANXI_CODE_EXE: exe,
    YANXI_CODE_CWD: cwd,
    YANXI_CODE_ARGUMENTS: args.map(quoteWindowsArg).join(' '),
  };
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      cwd,
      env,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: String(stderr || error.message || '启动 Yanxi Code 失败').trim() });
        return;
      }
      resolve({ ok: true, pid: Number.parseInt(String(stdout).trim(), 10) || null });
    });
  });
}

function launchPortableExecutable(exe, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(exe, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', error => resolve({ error: error.message || '启动 Yanxi Code 失败' }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, pid: child.pid });
    });
  });
}

async function launchYanxiCode(appRoot, config, workspace, mode = 'workspace') {
  const ws = workspace ? path.resolve(String(workspace)) : '';
  if (!ws || !fileExists(ws)) {
    return { error: '工作区路径无效，请先在 Agent 中选择工作区' };
  }

  const launch = resolveYanxiCodeLaunch(appRoot, config);
  if (!launch) {
    return {
      error: '未检测到 Yanxi Code。请先安装 Yanxi Code，或在设置中配置 yanxiCode.executable 路径。',
    };
  }

  const launchArgs = [...(launch.args || [])];
  if (launch.mode === 'dev') launchArgs.push('--dev');
  const handoff = writeYanxiWorkspaceHandoff(ws);
  launchArgs.push('--open-workspace', ws, '--source', 'yan-agent', '--yan-agent-request-id', handoff.requestId);
  if (mode === 'board') launchArgs.push('--yan-board');

  const cwd = launch.cwd || (launch.mode === 'installed' ? path.dirname(launch.exe) : launch.root);
  const result = process.platform === 'win32'
    ? await launchWindowsExecutable(launch.exe, launchArgs, cwd)
    : await launchPortableExecutable(launch.exe, launchArgs, cwd);
  if (result.error) return result;
  return { ...result, executable: launch.exe, mode: launch.mode, workspace: ws, requestId: handoff.requestId };
}

module.exports = {
  YANXI_WORKSPACE_HANDOFF_FILE,
  getYanxiCodeCandidates,
  launchYanxiCode,
  quoteWindowsArg,
  resolveYanxiCodeLaunch,
  writeYanxiWorkspaceHandoff,
};
