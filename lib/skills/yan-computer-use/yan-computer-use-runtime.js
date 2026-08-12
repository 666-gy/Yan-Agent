'use strict';

const path = require('path');

// 与 Yan Skills MCP 通信的 stdio JSON-RPC 协议
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Computer Use error') } });
}

// 优先通过 Electron 渲染进程 IPC 将调用转发到主进程；
// Skill 进程可能不是 BrowserWindow，因此 ipcRenderer 不可用时回退到
// 直接 require 主进程暴露的 host 模块（与 MCP 链路复用同一套逻辑）。
let ipcRenderer = null;
try {
  ipcRenderer = require('electron').ipcRenderer;
} catch {
  ipcRenderer = null;
}

let hostModule = null;
function getHost() {
  if (!hostModule) {
    hostModule = require(path.join(__dirname, '..', '..', 'computer-control-host'));
  }
  return hostModule;
}

async function invokeMain(channel, args) {
  if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
    return ipcRenderer.invoke(channel, args);
  }
  const host = getHost();
  switch (channel) {
    case 'computer:start':
      return host.startComputerControl(args || {});
    case 'computer:stop':
      return host.stopComputerControl();
    case 'computer:status':
      return host.getComputerControlStatus();
    case 'computer:click': {
      await host.ensureTargetForeground();
      const bridge = require(path.join(__dirname, '..', '..', 'computer-control-bridge'));
      const status = host.getComputerControlStatus();
      return bridge.sendClick(status.targetHwnd, args.x, args.y);
    }
    case 'computer:type': {
      await host.ensureTargetForeground();
      const bridge = require(path.join(__dirname, '..', '..', 'computer-control-bridge'));
      const status = host.getComputerControlStatus();
      return bridge.sendType(status.targetHwnd, args.text);
    }
    case 'computer:screenshot': {
      await host.ensureTargetForeground();
      const bridge = require(path.join(__dirname, '..', '..', 'computer-control-bridge'));
      const status = host.getComputerControlStatus();
      return bridge.takeScreenshot(status.targetHwnd);
    }
    default:
      throw new Error(`Unknown channel: ${channel}`);
  }
}

async function handleTool(name, args) {
  switch (name) {
    case 'start_computer_use':
      return invokeMain('computer:start', args || {});
    case 'stop_computer_use':
      return invokeMain('computer:stop');
    case 'computer_click':
      return invokeMain('computer:click', args);
    case 'computer_type':
      return invokeMain('computer:type', args);
    case 'computer_screenshot':
      return invokeMain('computer:screenshot', args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const TOOLS = [
  {
    name: 'start_computer_use',
    description: '启动电脑操控，指定目标窗口标题或句柄',
    inputSchema: {
      type: 'object',
      properties: {
        targetTitle: { type: 'string', description: '目标窗口标题' },
        targetHwnd: { type: 'string', description: '目标窗口句柄（可选）' },
        useVisionRelay: { type: 'boolean', description: '是否使用视觉中继' }
      }
    }
  },
  {
    name: 'stop_computer_use',
    description: '停止电脑操控',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'computer_click',
    description: '在目标窗口内点击指定坐标',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_type',
    description: '在目标窗口输入文本',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'computer_screenshot',
    description: '截取目标窗口截图',
    inputSchema: { type: 'object', properties: {} }
  }
];

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  let idx;
  while ((idx = inputBuffer.indexOf('\n')) >= 0) {
    const line = inputBuffer.slice(0, idx).trim();
    inputBuffer = inputBuffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        success(msg.id, {
          protocolVersion: String(msg.params?.protocolVersion || '2024-11-05'),
          capabilities: {},
          serverInfo: { name: 'yan-computer-use' }
        });
      } else if (msg.method === 'tools/list') {
        success(msg.id, { tools: TOOLS });
      } else if (msg.method === 'tools/call') {
        handleTool(msg.params.name, msg.params.arguments || {}).then(
          (result) => success(msg.id, { content: [{ type: 'text', text: JSON.stringify(result) }] }),
          (err) => failure(msg.id, -32603, err.message)
        );
      }
    } catch (err) {
      console.error('[yan-computer-use-runtime] parse error', err);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
