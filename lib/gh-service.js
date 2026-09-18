'use strict';

// GitHub CLI (gh) wrapper for PR workflow: list/view/diff/create. Modeled on
// git-service's spawn pattern. gh is optional — every entry point degrades to
// a clear error when the binary is missing, and pure helpers (URL parsing,
// arg building, JSON normalization) are exported separately so the UI and
// tests can use them without the CLI.

const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 45_000;
const GH_PATH = String(process.env.YAN_GH_BIN || 'gh').trim() || 'gh';

class GhError extends Error {
  constructor(message, { code = 'GH_FAILED', details } = {}) {
    super(message);
    this.name = 'GhError';
    this.code = code;
    this.details = details;
  }
}

function runGh(ghPath, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (args[0] !== '--version' && !String(cwd || '').trim()) {
    return Promise.reject(new GhError('请先选择工作区', { code: 'GH_BAD_INPUT' }));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(ghPath || GH_PATH, args, { cwd: cwd || process.cwd(), windowsHide: true,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new GhError(`gh ${args[0] || ''} timed out after ${timeoutMs}ms.`, { code: 'GH_TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new GhError(`gh could not be executed (${error.message}). Install the GitHub CLI or set YAN_GH_BIN.`, { code: 'GH_MISSING' }));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new GhError(`gh ${args.slice(0, 2).join(' ')} failed (${code}): ${stderr.trim() || 'unknown error'}`, { code: 'GH_COMMAND_FAILED' }));
    });
  });
}

async function detectGh({ ghPath } = {}) {
  try {
    await runGh(ghPath, ['--version'], { timeoutMs: 10_000 });
    return ghPath || GH_PATH;
  } catch {
    return null;
  }
}

// owner/repo from an https or ssh remote URL; '' when unrecognized.
function resolveRepoSlug(remoteUrl) {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return '';
  const https = raw.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  if (https) return `${https[1]}/${https[2]}`;
  const ssh = raw.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return `${ssh[2]}/${ssh[3]}`;
  const sshAlt = raw.match(/^ssh:\/\/git@[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshAlt) return `${sshAlt[1]}/${sshAlt[2]}`;
  return '';
}

function buildPrListArgs({ limit = 20, state = 'open', base } = {}) {
  const args = ['pr', 'list', '--json', 'number,title,state,headRefName,baseRefName,url,updatedAt,author', '--limit', String(Math.max(1, Math.min(100, Number(limit) || 20)))];
  const normalizedState = ['open', 'closed', 'merged', 'all'].includes(String(state)) ? String(state) : 'open';
  args.push('--state', normalizedState);
  if (base) args.push('--base', String(base));
  return args;
}

function parsePrList(stdout) {
  let rows;
  try { rows = JSON.parse(String(stdout)); } catch { throw new GhError('PR 列表响应无效', { code: 'GH_INVALID_RESPONSE' }); }
  if (!Array.isArray(rows)) throw new GhError('PR 列表响应无效', { code: 'GH_INVALID_RESPONSE' });
  return rows.filter(row => row && typeof row === 'object').map(row => ({
    number: Number(row.number) || 0,
    title: String(row.title || ''),
    state: String(row.state || '').toLowerCase(),
    headRefName: String(row.headRefName || ''),
    baseRefName: String(row.baseRefName || ''),
    url: String(row.url || ''),
    updatedAt: String(row.updatedAt || ''),
    author: String(row.author?.login || '')
  })).filter(row => row.number > 0);
}

function buildPrCreateArgs({ title, body, bodyFile, base, head, draft = false } = {}) {
  if (!String(title || '').trim()) throw new GhError('A PR title is required.', { code: 'GH_BAD_INPUT' });
  const args = ['pr', 'create', '--title', String(title)];
  if (bodyFile) args.push('--body-file', bodyFile);
  else if (String(body || '').trim()) args.push('--body', String(body));
  else args.push('--fill');
  if (base) args.push('--base', String(base));
  if (draft) args.push('--draft');
  if (head) args.push('--head', String(head));
  return args;
}

function parsePrUrl(stdout) {
  const match = String(stdout || '').match(/https:\/\/[^\s/"']+\/[^\s/"']+\/[^\s/"']+\/pull\/\d+\b/);
  return match ? match[0].replace(/[).,]+$/, '') : '';
}

async function requireAuthedRepo({ cwd, ghPath } = {}) {
  const { stdout } = await runGh(ghPath, ['repo', 'view', '--json', 'nameWithOwner'], { cwd });
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { /* handled below */ }
  if (!parsed?.nameWithOwner) throw new GhError('无法确认当前 GitHub 仓库，请检查 gh 登录与远端配置', { code: 'GH_INVALID_RESPONSE' });
  return String(parsed.nameWithOwner);
}

async function prList({ cwd, ghPath, limit, state, base } = {}) {
  const { stdout } = await runGh(ghPath, buildPrListArgs({ limit, state, base }), { cwd });
  return parsePrList(stdout);
}

async function prView({ cwd, ghPath, number } = {}) {
  const numeric = Number(number);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new GhError('A valid PR number is required.', { code: 'GH_BAD_INPUT' });
  const { stdout } = await runGh(ghPath, ['pr', 'view', String(numeric), '--json', 'number,title,state,headRefName,baseRefName,url,body,author,updatedAt'], { cwd });
  try {
    const row = JSON.parse(stdout);
    const pr = parsePrList(JSON.stringify([row]))[0];
    if (!pr) throw new Error('Missing PR');
    return { ...pr, body: String(row.body || '') };
  } catch {
    throw new GhError('PR 详情响应无效', { code: 'GH_INVALID_RESPONSE' });
  }
}

async function prDiff({ cwd, ghPath, number } = {}) {
  const numeric = Number(number);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new GhError('A valid PR number is required.', { code: 'GH_BAD_INPUT' });
  const { stdout } = await runGh(ghPath, ['pr', 'diff', String(numeric)], { cwd });
  return stdout;
}

async function prCreate({ cwd, ghPath, title, body, base, draft } = {}) {
  if (!cwd) throw new GhError('请先选择工作区', { code: 'GH_BAD_INPUT' });
  buildPrCreateArgs({ title, body, base, draft });
  const { promisify } = require('node:util');
  const git = async args => (await promisify(require('node:child_process').execFile)('git', args, { cwd, windowsHide: true, timeout: 10000 })).stdout.trim();
  const head = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '');
  if (!head) throw new GhError('请先切换到待提交 PR 的分支', { code: 'GH_BAD_INPUT' });
  await requireAuthedRepo({ cwd, ghPath });
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-pr-'));
  try {
    const bodyFile = path.join(dir, 'body.md');
    await fs.writeFile(bodyFile, String(body || ''), 'utf8');
    // Explicit head prevents an interactive branch push/fork prompt.
    const { stdout } = await runGh(ghPath, buildPrCreateArgs({ title, bodyFile, base, head, draft }), { cwd });
    return { url: parsePrUrl(stdout), created: true };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

module.exports = {
  GhError,
  GH_PATH,
  detectGh,
  resolveRepoSlug,
  buildPrListArgs,
  parsePrList,
  buildPrCreateArgs,
  parsePrUrl,
  prList,
  prView,
  prDiff,
  prCreate
};
