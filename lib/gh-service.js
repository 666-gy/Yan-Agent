'use strict';

// GitHub CLI (gh) wrapper for PR workflow: list/view/diff/create. Modeled on
// git-service's spawn pattern. gh is optional — every entry point degrades to
// a clear error when the binary is missing, and pure helpers (URL parsing,
// arg building, JSON normalization) are exported separately so the UI and
// tests can use them without the CLI.

const { spawn } = require('child_process');
const os = require('node:os');
const nodePath = require('node:path');

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

// gh resolves its config (hosts.yml + keyring entry) from GH_CONFIG_DIR /
// XDG_CONFIG_HOME / HOME / APPDATA. A desktop app can inherit a trimmed
// environment, and then `gh --version` still succeeds while every authenticated
// call reports "run gh auth login". Backfill the config-locating variables from
// the real home directory so the spawned gh matches the user's shell.
// GH_CONFIG_DIR itself is pinned process-wide by main.js (lib/gh-config-dir.js)
// so this process and Yan's kernel agree on where the login lives.
function ghEnv() {
  const env = { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };
  const home = String(env.USERPROFILE || env.HOME || os.homedir() || '').trim();
  if (home) {
    if (!env.HOME) env.HOME = home;
    if (!env.USERPROFILE) env.USERPROFILE = home;
    if (!env.APPDATA) env.APPDATA = nodePath.join(home, 'AppData', 'Roaming');
    if (!env.LOCALAPPDATA) env.LOCALAPPDATA = nodePath.join(home, 'AppData', 'Local');
  }
  return env;
}

function runGh(ghPath, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (args[0] !== '--version' && !String(cwd || '').trim()) {
    return Promise.reject(new GhError('请先选择工作区', { code: 'GH_BAD_INPUT' }));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(ghPath || GH_PATH, args, { cwd: cwd || process.cwd(), windowsHide: true,
      env: ghEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (code === 0) { resolve({ stdout, stderr }); return; }
      const detail = stderr.trim() || 'unknown error';
      const authLike = code === 4 && /gh auth login|GH_TOKEN|authentication/i.test(detail);
      reject(new GhError(
        authLike
          ? `GitHub CLI 未登录或读不到登录信息：请在终端运行 gh auth login（或设置 GH_TOKEN）后重试。（gh ${args.slice(0, 2).join(' ')} 退出码 ${code}）`
          : `gh ${args.slice(0, 2).join(' ')} failed (${code}): ${detail}`,
        { code: authLike ? 'GH_AUTH' : 'GH_COMMAND_FAILED', details: { exitCode: code, stderr: detail } }
      ));
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

function parseConnectionStatus(raw) {
  const hosts = raw?.hosts && typeof raw.hosts === 'object' ? raw.hosts : {};
  const accounts = Object.entries(hosts).flatMap(([host, entries]) => (Array.isArray(entries) ? entries : [])
    .map(account => ({ host, login: String(account.login || ''), active: account.active === true,
      connected: account.state === 'success' })));
  return { installed: true, connected: accounts.some(account => account.active && account.connected), accounts };
}

async function connectionStatus({ ghPath } = {}) {
  if (!await detectGh({ ghPath })) return { installed: false, connected: false, accounts: [] };
  try {
    const { stdout } = await runGh(ghPath, ['auth', 'status', '--json', 'hosts'], { cwd: os.homedir(), timeoutMs: 20_000 });
    return parseConnectionStatus(JSON.parse(stdout));
  } catch (error) {
    return { installed: true, connected: false, accounts: [], checkFailed: true,
      error: '无法确认 GitHub 登录状态。请运行 gh auth status 检查登录或网络后刷新。' };
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

// `gh issue list` caps a single call (and cannot be offset), so the full list
// is read through the same cursor-paginated GraphQL path as pull requests.
// `repository.issues` also returns pull requests; they are identified by
// `__typename` and filtered out so only real issues remain.
const ISSUE_LIST_QUERY = 'query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){issues(first:100,after:$cursor,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{__typename number title url state author{login} updatedAt labels(first:10){nodes{name}}}}}}';

function parseIssueNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter(node => node && typeof node === 'object' && node.__typename !== 'PullRequest')
    .map(node => ({
      number: Number(node.number) || 0,
      title: String(node.title || ''),
      state: String(node.state || '').toLowerCase(),
      url: String(node.url || ''),
      updatedAt: String(node.updatedAt || ''),
      author: String(node.author?.login || ''),
      labels: Array.isArray(node.labels?.nodes) ? node.labels.nodes.map(label => String(label?.name || '')).filter(Boolean) : []
    }))
    .filter(row => row.number > 0);
}

function buildIssueCreateArgs({ title, body, bodyFile } = {}) {
  if (!String(title || '').trim()) throw new GhError('An issue title is required.', { code: 'GH_BAD_INPUT' });
  const args = ['issue', 'create', '--title', String(title)];
  if (bodyFile) args.push('--body-file', bodyFile);
  else args.push('--body', String(body || ''));
  return args;
}

function parseIssueUrl(stdout) {
  const match = String(stdout || '').match(/https:\/\/[^\s/"']+\/[^\s/"']+\/[^\s/"']+\/issues\/\d+\b/);
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

async function issueList({ cwd, ghPath } = {}) {
  const { stdout } = await runGh(ghPath, ['repo', 'view', '--json', 'name,owner,url'], { cwd });
  const repo = JSON.parse(stdout);
  const issues = [];
  let cursor = '';
  do {
    const args = ['api', 'graphql', '--hostname', new URL(repo.url).hostname, '-f', `query=${ISSUE_LIST_QUERY}`, '-F', `owner=${repo.owner.login}`, '-F', `name=${repo.name}`];
    if (cursor) args.push('-F', `cursor=${cursor}`);
    const result = await runGh(ghPath, args, { cwd });
    const parsed = JSON.parse(result.stdout);
    if (parsed.errors?.length || !parsed.data?.repository) throw new GhError('无法读取仓库 Issue 信息', { code: 'GH_INVALID_RESPONSE' });
    const connection = parsed.data.repository.issues;
    if (!connection) throw new GhError('无法读取仓库 Issue 列表', { code: 'GH_INVALID_RESPONSE' });
    issues.push(...parseIssueNodes(connection.nodes));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : '';
  } while (cursor);
  return issues;
}

async function issueCreate({ cwd, ghPath, title, body } = {}) {
  if (!cwd) throw new GhError('请先选择工作区', { code: 'GH_BAD_INPUT' });
  buildIssueCreateArgs({ title, body });
  await requireAuthedRepo({ cwd, ghPath });
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-issue-'));
  try {
    const bodyFile = path.join(dir, 'body.md');
    await fs.writeFile(bodyFile, String(body || ''), 'utf8');
    const { stdout } = await runGh(ghPath, buildIssueCreateArgs({ title, bodyFile }), { cwd });
    return { url: parseIssueUrl(stdout), created: true };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

async function reviewProject({ cwd, ghPath } = {}) {
  const { stdout } = await runGh(ghPath, ['repo', 'view', '--json', 'name,owner,url'], { cwd });
  const repo = JSON.parse(stdout);
  const query = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){nameWithOwner url owner{login} viewerPermission pullRequests(first:100,after:$cursor,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{number title url headRefName baseRefName headRefOid isDraft mergeable mergeStateStatus author{login} headRepository{viewerPermission}}}}}`;
  const prs = [];
  let repository, cursor = '';
  do {
    const args = ['api', 'graphql', '--hostname', new URL(repo.url).hostname, '-f', `query=${query}`, '-F', `owner=${repo.owner.login}`, '-F', `name=${repo.name}`];
    if (cursor) args.push('-F', `cursor=${cursor}`);
    const result = await runGh(ghPath, args, { cwd });
    const parsed = JSON.parse(result.stdout);
    if (parsed.errors?.length || !parsed.data?.repository) throw new GhError('无法读取仓库权限和 PR 信息', { code: 'GH_INVALID_RESPONSE' });
    repository = parsed.data.repository;
    prs.push(...repository.pullRequests.nodes);
    cursor = repository.pullRequests.pageInfo.hasNextPage ? repository.pullRequests.pageInfo.endCursor : '';
  } while (cursor);
  return { repository: { nameWithOwner: repository.nameWithOwner, url: repository.url, developer: repository.owner.login, permission: repository.viewerPermission }, prs };
}

async function prMerge({ cwd, ghPath, number, method = 'merge', expectedHead = '' } = {}) {
  const numeric = Number(number);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new GhError('A valid PR number is required.', { code: 'GH_BAD_INPUT' });
  const args = ['pr', 'merge', String(numeric), method === 'squash' ? '--squash' : '--merge'];
  if (expectedHead) args.push('--match-head-commit', String(expectedHead));
  const { stdout } = await runGh(ghPath, args, { cwd });
  return { merged: true, number: numeric, output: stdout };
}

module.exports = {
  connectionStatus,
  parseConnectionStatus,
  reviewProject,
  prMerge,
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
  prCreate,
  parseIssueNodes,
  buildIssueCreateArgs,
  parseIssueUrl,
  issueList,
  issueCreate
};
