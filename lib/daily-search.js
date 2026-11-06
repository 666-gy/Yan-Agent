'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');

// Fixed executable/script and argument array: the model never supplies a command.
function searchArgs(input) {
  const action = input.action || 'search';
  if (!['search', 'extract'].includes(action)) throw new Error('Unsupported search operation');
  const value = String(input.query || '').trim();
  if (!value || value.length > 8000 || value.startsWith('-')) throw new Error('请输入有效的查询或网址');
  if (action === 'extract' && !/^https?:\/\//i.test(value)) throw new Error('网页地址必须以 http:// 或 https:// 开头');
  return [action, value, ...(action === 'search' ? ['--max_results', String(Math.max(1, Math.min(10, Number(input.max_results) || 5)))] : [])];
}
function runSearch(input, signal) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(__dirname, 'skills/anysearch/scripts/anysearch_cli.js'), ...searchArgs(input)],
      { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024, signal, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
      (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).slice(0, 2000))) : resolve(stdout));
  });
}
module.exports = { searchArgs, runSearch };
