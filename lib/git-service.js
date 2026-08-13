'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_CHARS = 600_000;
const INTERNAL_PATHSPECS = [':(exclude).yanagent', ':(exclude).yanagent/**'];

let gitAvailabilityPromise = null;

function clip(value, max = 4_000) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1***:***@')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi, '$1***@')
    .replace(/\b(?:gh[opsu]|github_pat|glpat|sk)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]');
}

function publicRemoteUrl(value) {
  const raw = String(value || '').trim();
  if (!/^(?:https?|ssh):\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    return parsed.href;
  } catch {
    return redactSecrets(raw);
  }
}

function gitError(message, code = 'GIT_ERROR', details = {}) {
  const error = new Error(redactSecrets(message));
  error.code = code;
  Object.assign(error, details);
  return error;
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || MAX_OUTPUT_BYTES,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: options.allowCredentialPrompt ? '1' : '0',
        GIT_OPTIONAL_LOCKS: options.readOnly ? '0' : '1',
        ...(options.env || {})
      }
    }, (error, stdout = '', stderr = '') => {
      if (!error) {
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
        return;
      }
      reject(gitError(
        clip(stderr || stdout || error.message || 'Git command failed.'),
        error.killed ? 'GIT_TIMEOUT' : (error.code === 'ENOENT' ? 'GIT_NOT_FOUND' : 'GIT_COMMAND_FAILED'),
        { exitCode: Number.isInteger(error.code) ? error.code : null }
      ));
    });
  });
}

async function runGit(args, options = {}) {
  return runFile('git', args, options);
}

async function tryGit(args, options = {}) {
  try {
    const result = await runGit(args, options);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code, exitCode: error.exitCode };
  }
}

async function detectGit({ refresh = false } = {}) {
  if (!gitAvailabilityPromise || refresh) {
    gitAvailabilityPromise = tryGit(['--version'], { readOnly: true })
      .then(result => result.ok
        ? { available: true, version: result.stdout.trim().replace(/^git version\s+/i, '') }
        : { available: false, version: '', error: result.error || '未找到 Git。' });
  }
  return gitAvailabilityPromise;
}

async function resolveDirectory(value, label = '工作区') {
  const resolved = path.resolve(String(value || '').trim());
  if (!String(value || '').trim()) throw gitError(`${label}路径为空。`, 'WORKSPACE_REQUIRED');
  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw gitError(`${label}不存在：${resolved}`, 'DIRECTORY_NOT_FOUND');
  }
  if (!stat.isDirectory()) throw gitError(`${label}不是文件夹：${resolved}`, 'NOT_A_DIRECTORY');
  return resolved;
}

async function resolveRepository(workspace, { required = true } = {}) {
  const directory = await resolveDirectory(workspace);
  const result = await tryGit(['-C', directory, 'rev-parse', '--show-toplevel'], { readOnly: true });
  if (!result.ok) {
    if (!required) return null;
    throw gitError('当前工作区不是 Git 仓库。', 'NOT_A_REPOSITORY');
  }
  return path.resolve(result.stdout.trim());
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRepoPaths(root, values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const normalized = [];
  for (const value of source) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
    if (!pathInside(root, absolute)) throw gitError(`文件不在仓库内：${raw}`, 'PATH_OUTSIDE_REPOSITORY');
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (!relative || relative === '.git' || relative.startsWith('.git/')
        || relative === '.yanagent' || relative.startsWith('.yanagent/')) {
      throw gitError('不能直接操作 Git 或 Yan Agent 内部数据目录。', 'INVALID_REPOSITORY_PATH');
    }
    if (!seen.has(relative)) {
      seen.add(relative);
      normalized.push(relative);
    }
  }
  if (!normalized.length) throw gitError('没有可操作的文件。', 'PATH_REQUIRED');
  return normalized;
}

function statusLabel(indexStatus, worktreeStatus) {
  if (indexStatus === '?' && worktreeStatus === '?') return 'untracked';
  if (indexStatus === '!' && worktreeStatus === '!') return 'ignored';
  if ([indexStatus, worktreeStatus].some(code => code === 'U')
      || ['AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(`${indexStatus}${worktreeStatus}`)) return 'conflicted';
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed';
  if (indexStatus === 'C' || worktreeStatus === 'C') return 'copied';
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added';
  if (indexStatus === 'T' || worktreeStatus === 'T') return 'typechanged';
  return 'modified';
}

function parsePorcelainStatus(raw) {
  const records = String(raw || '').split('\0');
  const changes = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.startsWith('## ')) continue;
    const indexStatus = record[0] || ' ';
    const worktreeStatus = record[1] || ' ';
    const filePath = record.length > 3 ? record.slice(3) : '';
    let originalPath = '';
    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      originalPath = records[++index] || '';
    }
    const staged = indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!';
    const unstaged = worktreeStatus !== ' ' && worktreeStatus !== '!';
    changes.push({
      path: filePath.replace(/\\/g, '/'),
      originalPath: originalPath.replace(/\\/g, '/'),
      indexStatus,
      worktreeStatus,
      status: statusLabel(indexStatus, worktreeStatus),
      staged,
      unstaged,
      conflicted: statusLabel(indexStatus, worktreeStatus) === 'conflicted'
    });
  }
  return changes;
}

function parseRefList(raw, remote = false) {
  return String(raw || '').split(/\r?\n/).filter(Boolean).map(line => {
    const [name = '', upstream = '', hash = '', head = '', ...subjectParts] = line.split('\0');
    return {
      name,
      upstream,
      hash,
      current: head.trim() === '*',
      subject: subjectParts.join('\0'),
      remote
    };
  }).filter(item => item.name && (!remote || !item.name.endsWith('/HEAD')));
}

async function listBranches(root) {
  const format = '%(refname:short)%00%(upstream:short)%00%(objectname:short)%00%(HEAD)%00%(subject)';
  const [local, remote] = await Promise.all([
    runGit(['-C', root, 'for-each-ref', `--format=${format}`, '--sort=refname', 'refs/heads/'], { readOnly: true }),
    runGit(['-C', root, 'for-each-ref', `--format=${format}`, '--sort=refname', 'refs/remotes/'], { readOnly: true })
  ]);
  return {
    local: parseRefList(local.stdout),
    remote: parseRefList(remote.stdout, true)
  };
}

async function listRemotes(root) {
  const names = (await runGit(['-C', root, 'remote'], { readOnly: true })).stdout
    .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  return Promise.all(names.map(async name => {
    const [fetchUrl, pushUrl] = await Promise.all([
      tryGit(['-C', root, 'remote', 'get-url', name], { readOnly: true }),
      tryGit(['-C', root, 'remote', 'get-url', '--push', name], { readOnly: true })
    ]);
    const rawFetchUrl = fetchUrl.ok ? fetchUrl.stdout.trim() : '';
    const rawPushUrl = pushUrl.ok ? pushUrl.stdout.trim() : '';
    const safeFetchUrl = publicRemoteUrl(rawFetchUrl);
    const safePushUrl = publicRemoteUrl(rawPushUrl);
    return {
      name,
      fetchUrl: safeFetchUrl,
      pushUrl: safePushUrl,
      webUrl: remoteWebUrl(rawFetchUrl),
      credentialsHidden: safeFetchUrl !== rawFetchUrl || safePushUrl !== rawPushUrl
    };
  }));
}

async function readConfig(root, key) {
  const result = await tryGit(['-C', root, 'config', '--get', key], { readOnly: true });
  return result.ok ? result.stdout.trim() : '';
}

async function operationState(root) {
  const result = await tryGit(['-C', root, 'rev-parse', '--git-dir'], { readOnly: true });
  if (!result.ok) return '';
  const gitDir = path.resolve(root, result.stdout.trim());
  const states = [
    ['rebase', ['rebase-merge', 'rebase-apply']],
    ['merge', ['MERGE_HEAD']],
    ['cherry-pick', ['CHERRY_PICK_HEAD']],
    ['revert', ['REVERT_HEAD']]
  ];
  for (const [name, markers] of states) {
    if (markers.some(marker => fs.existsSync(path.join(gitDir, marker)))) return name;
  }
  return '';
}

async function repositoryStatus(workspace) {
  const git = await detectGit();
  const normalizedWorkspace = await resolveDirectory(workspace);
  if (!git.available) return { ...git, workspace: normalizedWorkspace, isRepository: false };
  const root = await resolveRepository(normalizedWorkspace, { required: false });
  if (!root) return { ...git, workspace: normalizedWorkspace, isRepository: false };

  const [porcelain, currentBranchResult, headResult, upstreamResult, branches, remotes, userName, userEmail, operation] = await Promise.all([
    runGit([
      '-C', root, 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all',
      '--', '.', ...INTERNAL_PATHSPECS
    ], { readOnly: true }),
    tryGit(['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], { readOnly: true }),
    tryGit(['-C', root, 'rev-parse', '--short', 'HEAD'], { readOnly: true }),
    tryGit(['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { readOnly: true }),
    listBranches(root),
    listRemotes(root),
    readConfig(root, 'user.name'),
    readConfig(root, 'user.email'),
    operationState(root)
  ]);

  const changes = parsePorcelainStatus(porcelain.stdout);
  const currentBranch = currentBranchResult.ok ? currentBranchResult.stdout.trim() : '';
  const head = headResult.ok ? headResult.stdout.trim() : '';
  const upstream = upstreamResult.ok ? upstreamResult.stdout.trim() : '';
  let ahead = 0;
  let behind = 0;
  if (upstream && head) {
    const counts = await tryGit(['-C', root, 'rev-list', '--left-right', '--count', `HEAD...${upstream}`], { readOnly: true });
    if (counts.ok) {
      const [left, right] = counts.stdout.trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(left) ? left : 0;
      behind = Number.isFinite(right) ? right : 0;
    }
  }
  const remoteName = upstream.includes('/') ? upstream.slice(0, upstream.indexOf('/')) : (remotes.some(item => item.name === 'origin') ? 'origin' : (remotes[0]?.name || ''));
  return {
    ...git,
    workspace: normalizedWorkspace,
    root,
    isRepository: true,
    name: path.basename(root),
    currentBranch,
    detached: !currentBranch && !!head,
    head,
    upstream,
    remoteName,
    ahead,
    behind,
    clean: changes.length === 0,
    operation,
    changes,
    stagedCount: changes.filter(item => item.staged).length,
    unstagedCount: changes.filter(item => item.unstaged).length,
    conflictedCount: changes.filter(item => item.conflicted).length,
    branches,
    remotes,
    identity: { name: userName, email: userEmail }
  };
}

function validateBranchName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 240 || name.startsWith('-') || /[\u0000-\u001f\u007f~^:?*\\\[\]]/.test(name)
      || name.includes('..') || name.includes('@{') || name.endsWith('.') || name.endsWith('/') || name.includes('//')) {
    throw gitError('分支名称无效。', 'INVALID_BRANCH');
  }
  return name;
}

function validateRemoteName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw gitError('远程仓库名称无效。', 'INVALID_REMOTE');
  return name;
}

function validateRemoteUrl(value) {
  const url = String(value || '').trim();
  if (!url || url.length > 4_096 || url.startsWith('-') || /[\r\n\u0000]/.test(url)) {
    throw gitError('远程仓库地址无效。', 'INVALID_REMOTE_URL');
  }
  const allowed = /^(?:https?|ssh|git|file):\/\//i.test(url)
    || /^[^\s@]+@[^\s:]+:.+/.test(url)
    || path.isAbsolute(url);
  if (!allowed) throw gitError('仅支持 HTTPS、SSH、Git、file URL 或本地绝对路径。', 'INVALID_REMOTE_URL');
  return url;
}

async function initRepository(workspace, initialBranch = 'main') {
  const directory = await resolveDirectory(workspace);
  const existing = await resolveRepository(directory, { required: false });
  if (!existing) await runGit(['-C', directory, 'init', '-b', validateBranchName(initialBranch)]);
  return repositoryStatus(directory);
}

async function stageFiles(workspace, paths = [], all = false) {
  const root = await resolveRepository(workspace);
  if (all) await runGit(['-C', root, 'add', '-A', '--', '.', ...INTERNAL_PATHSPECS]);
  else await runGit(['-C', root, 'add', '--', ...normalizeRepoPaths(root, paths)]);
  return repositoryStatus(root);
}

async function unstageFiles(workspace, paths = [], all = false) {
  const root = await resolveRepository(workspace);
  const hasHead = (await tryGit(['-C', root, 'rev-parse', '--verify', 'HEAD'], { readOnly: true })).ok;
  if (hasHead) {
    await runGit(all
      ? ['-C', root, 'restore', '--staged', '--', '.', ...INTERNAL_PATHSPECS]
      : ['-C', root, 'restore', '--staged', '--', ...normalizeRepoPaths(root, paths)]);
  } else {
    await runGit(all
      ? ['-C', root, 'rm', '--cached', '-r', '--ignore-unmatch', '--', '.', ...INTERNAL_PATHSPECS]
      : ['-C', root, 'rm', '--cached', '-r', '--ignore-unmatch', '--', ...normalizeRepoPaths(root, paths)]);
  }
  return repositoryStatus(root);
}

async function commit(workspace, message, { amend = false } = {}) {
  const root = await resolveRepository(workspace);
  const cleanMessage = String(message || '').replace(/\u0000/g, '').trim();
  if (!cleanMessage) throw gitError('请输入提交说明。', 'COMMIT_MESSAGE_REQUIRED');
  if (cleanMessage.length > 10_000) throw gitError('提交说明过长。', 'COMMIT_MESSAGE_TOO_LONG');
  const args = ['-C', root, 'commit'];
  if (amend) args.push('--amend');
  args.push('-m', cleanMessage);
  await runGit(args, { timeoutMs: 60_000 });
  const info = await runGit(['-C', root, 'log', '-1', '--format=%H%x00%h%x00%s'], { readOnly: true });
  const [hash = '', shortHash = '', subject = ''] = info.stdout.trim().split('\0');
  return { ok: true, commit: { hash, shortHash, subject }, status: await repositoryStatus(root) };
}

async function createBranch(workspace, branchName, { checkout = true } = {}) {
  const root = await resolveRepository(workspace);
  const name = validateBranchName(branchName);
  await runGit(checkout
    ? ['-C', root, 'switch', '-c', name]
    : ['-C', root, 'branch', name]);
  return repositoryStatus(root);
}

async function switchBranch(workspace, branchName, remoteBranch = '') {
  const root = await resolveRepository(workspace);
  const name = validateBranchName(branchName);
  if (remoteBranch) {
    const remote = validateBranchName(remoteBranch);
    await runGit(['-C', root, 'switch', '--track', '-c', name, remote]);
  } else {
    await runGit(['-C', root, 'switch', name]);
  }
  return repositoryStatus(root);
}

async function fetchRemote(workspace, remoteName = '') {
  const root = await resolveRepository(workspace);
  const args = ['-C', root, 'fetch', '--prune'];
  if (remoteName) args.push(validateRemoteName(remoteName));
  await runGit(args, { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  return repositoryStatus(root);
}

async function pull(workspace) {
  const status = await repositoryStatus(workspace);
  if (!status.upstream) throw gitError('当前分支尚未设置上游分支。请先推送。', 'UPSTREAM_REQUIRED');
  await runGit(['-C', status.root, 'pull', '--ff-only'], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  return repositoryStatus(status.root);
}

async function push(workspace, remoteName = '') {
  const status = await repositoryStatus(workspace);
  if (!status.currentBranch) throw gitError('游离 HEAD 状态下不能直接推送。', 'DETACHED_HEAD');
  if (status.upstream) {
    await runGit(['-C', status.root, 'push'], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  } else {
    const remote = validateRemoteName(remoteName || status.remoteName || status.remotes[0]?.name || '');
    await runGit(['-C', status.root, 'push', '-u', remote, status.currentBranch], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  }
  return repositoryStatus(status.root);
}

async function addRemote(workspace, remoteName, remoteUrl) {
  const root = await resolveRepository(workspace);
  await runGit(['-C', root, 'remote', 'add', validateRemoteName(remoteName), validateRemoteUrl(remoteUrl)]);
  return repositoryStatus(root);
}

async function setRemoteUrl(workspace, remoteName, remoteUrl) {
  const root = await resolveRepository(workspace);
  await runGit(['-C', root, 'remote', 'set-url', validateRemoteName(remoteName), validateRemoteUrl(remoteUrl)]);
  return repositoryStatus(root);
}

async function removeRemote(workspace, remoteName) {
  const root = await resolveRepository(workspace);
  await runGit(['-C', root, 'remote', 'remove', validateRemoteName(remoteName)]);
  return repositoryStatus(root);
}

async function setIdentity(workspace, name, email) {
  const root = await resolveRepository(workspace);
  const cleanName = String(name || '').replace(/[\r\n\u0000]/g, ' ').trim().slice(0, 200);
  const cleanEmail = String(email || '').replace(/[\r\n\u0000]/g, '').trim().slice(0, 320);
  if (!cleanName) throw gitError('Git 用户名不能为空。', 'IDENTITY_NAME_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw gitError('Git 邮箱格式无效。', 'IDENTITY_EMAIL_INVALID');
  await runGit(['-C', root, 'config', '--local', 'user.name', cleanName]);
  await runGit(['-C', root, 'config', '--local', 'user.email', cleanEmail]);
  return repositoryStatus(root);
}

async function history(workspace, limit = 40) {
  const root = await resolveRepository(workspace);
  const count = Math.max(1, Math.min(200, Number(limit) || 40));
  const result = await tryGit([
    '-C', root, 'log', `-${count}`,
    '--date=iso-strict',
    '--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D'
  ], { readOnly: true });
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const [hash = '', shortHash = '', author = '', date = '', subject = '', refs = ''] = line.split('\0');
    return { hash, shortHash, author, date, subject, refs };
  });
}

async function diff(workspace, filePath, staged = false) {
  const root = await resolveRepository(workspace);
  const [relative] = normalizeRepoPaths(root, [filePath]);
  const status = await repositoryStatus(root);
  const change = status.changes.find(item => item.path === relative);
  if (!staged && change?.status === 'untracked') {
    const absolute = path.join(root, relative);
    const buffer = await fsp.readFile(absolute);
    const binary = buffer.subarray(0, 8_000).includes(0);
    const content = binary ? '' : buffer.toString('utf8');
    return {
      path: relative,
      staged: false,
      untracked: true,
      binary,
      diff: binary ? '未跟踪的二进制文件' : clip(content, MAX_DIFF_CHARS),
      truncated: content.length > MAX_DIFF_CHARS
    };
  }
  const args = ['-C', root, 'diff', '--no-ext-diff', '--no-color', '--unified=3'];
  if (staged) args.push('--cached');
  args.push('--', relative);
  const result = await runGit(args, { readOnly: true, maxBuffer: MAX_OUTPUT_BYTES });
  return {
    path: relative,
    staged: !!staged,
    untracked: false,
    binary: /Binary files|GIT binary patch/i.test(result.stdout),
    diff: clip(result.stdout, MAX_DIFF_CHARS),
    truncated: result.stdout.length > MAX_DIFF_CHARS
  };
}

async function cloneRepository(remoteUrl, destination) {
  const url = validateRemoteUrl(remoteUrl);
  const target = path.resolve(String(destination || '').trim());
  if (!String(destination || '').trim()) throw gitError('请选择克隆目标文件夹。', 'CLONE_DESTINATION_REQUIRED');
  const parent = path.dirname(target);
  await resolveDirectory(parent, '目标父目录');
  if (fs.existsSync(target)) {
    const stat = await fsp.stat(target);
    if (!stat.isDirectory()) throw gitError('克隆目标已存在且不是文件夹。', 'CLONE_DESTINATION_INVALID');
    const entries = await fsp.readdir(target);
    if (entries.length) throw gitError('克隆目标文件夹必须为空。', 'CLONE_DESTINATION_NOT_EMPTY');
  }
  await runGit(['clone', '--', url, target], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true, cwd: parent });
  return { ok: true, path: target, status: await repositoryStatus(target) };
}

function remoteWebUrl(remoteUrl) {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return '';
  let url = raw;
  const scp = raw.match(/^git@([^:]+):(.+)$/i);
  if (scp) url = `https://${scp[1]}/${scp[2]}`;
  else if (/^ssh:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      url = `https://${parsed.hostname}${parsed.pathname}`;
    } catch { return ''; }
  }
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.href.replace(/\.git\/?$/i, '').replace(/\/$/, '');
  } catch {
    return '';
  }
}

module.exports = {
  addRemote,
  cloneRepository,
  commit,
  createBranch,
  detectGit,
  diff,
  fetchRemote,
  history,
  initRepository,
  parsePorcelainStatus,
  pull,
  push,
  remoteWebUrl,
  removeRemote,
  repositoryStatus,
  setIdentity,
  setRemoteUrl,
  stageFiles,
  switchBranch,
  unstageFiles,
  validateBranchName,
  validateRemoteName,
  validateRemoteUrl
};
