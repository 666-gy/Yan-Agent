'use strict';

const host = require('./computer-control-host');
const bridge = require('./computer-control-bridge');

const TOOLS = [
  {
    name: 'computer_start_control',
    description: '启动电脑操控模式，指定目标窗口标题或句柄，询问用户视觉中继开关。',
    inputSchema: {
      type: 'object',
      properties: {
        targetTitle: { type: 'string', description: '目标窗口标题' },
        targetHwnd: { type: 'string', description: '目标窗口句柄（可选）' }
      },
      required: ['targetTitle']
    }
  },
  {
    name: 'computer_stop_control',
    description: '停止电脑操控模式并清理覆盖层与热键。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'computer_click',
    description: '在目标窗口内点击指定坐标。',
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
    description: '在目标窗口输入文本。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'computer_screenshot',
    description: '截取目标窗口或全屏并返回 base64 图片。',
    inputSchema: {
      type: 'object',
      properties: { fullScreen: { type: 'boolean' } }
    }
  }
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleToolCall(name, args) {
  const status = host.getComputerControlStatus();
  switch (name) {
    case 'computer_start_control': {
      return {
        ok: false,
        needsUserConfirmation: true,
        confirmationType: 'vision-relay',
        targetTitle: args.targetTitle,
        targetHwnd: args.targetHwnd
      };
    }
    case 'computer_stop_control': {
      await host.stopComputerControl();
      return { ok: true };
    }
    case 'computer_click': {
      await host.ensureTargetForeground();
      return bridge.sendClick(status.targetHwnd, args.x, args.y);
    }
    case 'computer_type': {
      await host.ensureTargetForeground();
      return bridge.sendType(status.targetHwnd, args.text);
    }
    case 'computer_screenshot': {
      await host.ensureTargetForeground();
      return bridge.takeScreenshot(args.fullScreen ? null : status.targetHwnd);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'yan-computer-control' }
          }
        });
      } else if (msg.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      } else if (msg.method === 'tools/call') {
        handleToolCall(msg.params.name, msg.params.arguments || {})
          .then((result) => {
            send({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(result) }]
              }
            });
          })
          .catch((err) => {
            send({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(err && err.message || err) }) }]
              }
            });
          });
      }
    } catch (err) {
      console.error('[mcp-computer-control] parse error', err);
    }
  }
});

process.stdin.on('end', () => process.exit(0));

module.exports = { TOOLS, handleToolCall };
