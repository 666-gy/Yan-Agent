'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const nuphusCli = path.resolve(__dirname, '..', 'node_modules', '@nuphus', 'nuphus-mcp', 'bin', 'cli.js');
const child = spawn(process.execPath, [nuphusCli], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
});

const toolListRequestIds = new Set();
let inputBuffer = '';
let outputBuffer = '';
let shuttingDown = false;

function requestKey(id) {
  return `${typeof id}:${String(id)}`;
}

function inspectClientLine(line) {
  try {
    const message = JSON.parse(line);
    if (message?.method === 'tools/list' && Object.hasOwn(message, 'id')) {
      toolListRequestIds.add(requestKey(message.id));
    }
  } catch {
    // Nuphus remains authoritative for malformed protocol input and errors.
  }
}

function filterServerLine(line) {
  try {
    const message = JSON.parse(line);
    const key = Object.hasOwn(message || {}, 'id') ? requestKey(message.id) : '';
    if (!key || !toolListRequestIds.delete(key) || !Array.isArray(message?.result?.tools)) return line;
    return JSON.stringify({
      ...message,
      result: {
        ...message.result,
        tools: message.result.tools.filter(tool => String(tool?.name || '').startsWith('desktop_'))
      }
    });
  } catch {
    return line;
  }
}

function consumeLines(buffer, onLine) {
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const rawLine = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line) onLine(line);
    newline = buffer.indexOf('\n');
  }
  return buffer;
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  inputBuffer = consumeLines(inputBuffer, inspectClientLine);
  if (!child.stdin.destroyed) child.stdin.write(chunk);
});
process.stdin.on('end', () => child.stdin.end());

child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  outputBuffer += chunk;
  outputBuffer = consumeLines(outputBuffer, line => {
    process.stdout.write(`${filterServerLine(line)}\n`);
  });
});
child.stdout.on('end', () => {
  if (outputBuffer) process.stdout.write(filterServerLine(outputBuffer));
});
child.stderr.pipe(process.stderr);

function stopChild(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.killed) child.kill(signal);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopChild(signal));
}

child.on('error', error => {
  process.stderr.write(`[nuphus-desktop] failed to start Nuphus MCP: ${error.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal && !shuttingDown) process.stderr.write(`[nuphus-desktop] Nuphus exited on ${signal}\n`);
  process.exit(code == null ? (signal ? 1 : 0) : code);
});
