const TOKEN_BOUNDARIES = new Set([' ', '\t', '\r', '\n']);
const SHELL_OPERATORS = new Set([';', '|', '&', '>', '<', '(', ')']);
const COMMAND_SEPARATORS = new Set([';', '|', '||', '&', '&&', '(', ')']);
const COMMAND_WRAPPERS = new Set(['env', 'command', 'cmd', 'powershell', 'pwsh', 'bash', 'sh', 'wsl']);

function tokenizeShellCommand(command) {
  const tokens = [];
  let current = '';
  let quote = '';
  let escaped = false;

  const pushCurrent = () => {
    if (!current) return;
    tokens.push(current);
    current = '';
  };

  const input = String(command || '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '`') escaped = true;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '`') {
      escaped = true;
      continue;
    }
    if (TOKEN_BOUNDARIES.has(character)) {
      pushCurrent();
      if (character === '\n' || character === '\r') tokens.push(';');
      continue;
    }
    if (SHELL_OPERATORS.has(character)) {
      pushCurrent();
      const canPair = character === '|' || character === '&' || character === '>' || character === '<';
      if (canPair && input[index + 1] === character) {
        tokens.push(character + character);
        index += 1;
      } else {
        tokens.push(character);
      }
      continue;
    }
    current += character;
  }
  pushCurrent();
  return tokens;
}

function normalizeToken(token) {
  return String(token || '').trim().toLowerCase();
}

function commandName(token) {
  const normalized = normalizeToken(token);
  const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  let name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  for (const suffix of ['.exe', '.cmd', '.bat', '.ps1']) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return name;
}

function expandWrappedCommands(tokens) {
  const expanded = [...tokens];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = normalizeToken(tokens[index]);
    if (token !== '-c' && token !== '/c' && token !== '-command') continue;
    let segmentStart = index - 1;
    while (segmentStart > 0 && !COMMAND_SEPARATORS.has(normalizeToken(tokens[segmentStart - 1]))) {
      segmentStart -= 1;
    }
    const wrapper = commandName(tokens[segmentStart]);
    if (!COMMAND_WRAPPERS.has(wrapper)) continue;
    let segmentEnd = index + 1;
    while (segmentEnd < tokens.length && !COMMAND_SEPARATORS.has(normalizeToken(tokens[segmentEnd]))) {
      segmentEnd += 1;
    }
    const nested = tokenizeShellCommand(tokens.slice(index + 1, segmentEnd).join(' '));
    if (nested.length > 0) expanded.push(';', ...nested);
  }
  return expanded;
}

function commandEntries(tokens) {
  const entries = [];
  let expectCommand = true;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = normalizeToken(tokens[index]);
    if (!token) continue;
    if (COMMAND_SEPARATORS.has(token)) {
      expectCommand = true;
      continue;
    }
    if (!expectCommand) continue;
    const name = commandName(token);
    if (!name) continue;
    entries.push({ name, index });
    if (name === 'sudo' || name === 'doas' || name === 'command' || name === 'env' || name === 'wsl') {
      expectCommand = true;
      continue;
    }
    expectCommand = false;
  }
  return entries;
}

function commandArguments(tokens, index) {
  const args = [];
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = normalizeToken(tokens[cursor]);
    if (COMMAND_SEPARATORS.has(token)) break;
    if (token) args.push(token);
  }
  return args;
}

function includesAny(values, expected) {
  return values.some(value => expected.has(value));
}

function highRisk(category, reason) {
  return { level: 'high', requiresApproval: true, category, reason };
}

function classifyDelegatedShellCommand(command) {
  const initialTokens = tokenizeShellCommand(command);
  if (initialTokens.length === 0) return highRisk('invalid', '命令为空或无法解析。');

  const tokens = expandWrappedCommands(initialTokens);
  const entries = commandEntries(tokens);
  const names = new Set(entries.map(entry => entry.name));

  if (names.has('sudo') || names.has('doas') || names.has('runas')) {
    return highRisk('elevation', '命令请求提升系统权限。');
  }

  const destructiveFiles = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'remove-itemproperty']);
  if (includesAny(entries.map(entry => entry.name), destructiveFiles)) {
    return highRisk('file_delete', '命令会删除文件、目录或系统属性。');
  }

  const diskAndSystem = new Set([
    'format', 'diskpart', 'dd', 'clear-disk', 'initialize-disk', 'format-volume',
    'shutdown', 'restart-computer', 'stop-computer', 'set-executionpolicy',
    'bcdedit', 'cipher', 'reg', 'sc'
  ]);
  for (const entry of entries) {
    if (entry.name.startsWith('mkfs')) return highRisk('disk', '命令会修改磁盘或文件系统。');
    if (!diskAndSystem.has(entry.name)) continue;
    const args = commandArguments(tokens, entry.index);
    if (entry.name === 'reg' && args[0] !== 'delete') continue;
    if (entry.name === 'sc' && args[0] !== 'delete' && args[0] !== 'stop') continue;
    return highRisk('system', '命令会修改磁盘、系统配置或电源状态。');
  }

  for (const entry of entries) {
    const args = commandArguments(tokens, entry.index);
    if (entry.name === 'git') {
      const operation = args[0] || '';
      if (operation === 'reset' && args.includes('--hard')) return highRisk('git_destructive', '命令会丢弃本地 Git 修改。');
      if (operation === 'clean' && args.some(arg => arg.startsWith('-') && arg.includes('f'))) return highRisk('git_destructive', '命令会永久删除未跟踪文件。');
      if (operation === 'push' && includesAny(args, new Set(['-f', '--force', '--force-with-lease']))) return highRisk('git_remote', '命令会强制改写远程 Git 历史。');
      if (operation === 'restore' && !args.includes('--staged')) return highRisk('git_destructive', '命令可能丢弃本地文件修改。');
      if (operation === 'branch' && includesAny(args, new Set(['-d', '--delete']))) return highRisk('git_destructive', '命令会删除 Git 分支。');
      // `git checkout -- <path>` discards local edits just like restore.
      if (operation === 'checkout' && (args.includes('--') || args.includes('-f') || args.includes('--force'))) {
        return highRisk('git_destructive', '命令会丢弃本地文件修改。');
      }
      // Dropped stashes are unrecoverable: they hold uncommitted work.
      if (operation === 'stash' && includesAny(args, new Set(['drop', 'clear']))) {
        return highRisk('git_destructive', '命令会永久丢弃暂存（stash）的修改。');
      }
      // Only forced worktree removal deletes in-progress builder work; a plain
      // remove fails safely on dirty worktrees.
      if (operation === 'worktree' && args[1] === 'remove' && includesAny(args, new Set(['-f', '--force']))) {
        return highRisk('git_destructive', '命令会强制删除任务工作树及其未提交修改。');
      }
      if (operation === 'filter-branch' || operation === 'filter-repo') {
        return highRisk('git_destructive', '命令会改写全部 Git 历史。');
      }
    }
    if (entry.name === 'docker') {
      const operation = args[0] || '';
      if (operation === 'system' && args[1] === 'prune') return highRisk('container_delete', '命令会批量删除 Docker 资源。');
      if (operation === 'volume' && (args[1] === 'rm' || args[1] === 'prune')) return highRisk('container_delete', '命令会删除 Docker 数据卷。');
    }
    if (entry.name === 'kubectl' && args[0] === 'delete') return highRisk('cluster_delete', '命令会删除集群资源。');
    if (entry.name === 'terraform' && args[0] === 'destroy') return highRisk('infrastructure_delete', '命令会销毁基础设施资源。');
    if (entry.name === 'start-process' && args.includes('-verb') && args.includes('runas')) {
      return highRisk('elevation', '命令请求提升系统权限。');
    }
  }

  const hasPipe = tokens.some(token => token === '|');
  const downloaders = new Set(['curl', 'wget', 'iwr', 'invoke-webrequest']);
  const interpreters = new Set(['sh', 'bash', 'powershell', 'pwsh', 'iex', 'invoke-expression']);
  if (hasPipe && includesAny(entries.map(entry => entry.name), downloaders)
      && includesAny(entries.map(entry => entry.name), interpreters)) {
    return highRisk('remote_execution', '命令会下载远程内容并直接执行。');
  }
  if (names.has('invoke-expression') || names.has('iex')) {
    return highRisk('dynamic_execution', '命令会动态执行生成的代码。');
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] !== '>' && tokens[index] !== '>>') continue;
    const target = normalizeToken(tokens[index + 1]);
    if (target.startsWith('/dev/sd') || target.startsWith('\\\\.\\physicaldrive')) {
      return highRisk('disk', '命令会直接写入磁盘设备。');
    }
  }

  return { level: 'normal', requiresApproval: false, category: 'normal', reason: '' };
}

// ---------------------------------------------------------------------------
// Command-prefix derivation (P0)
// ---------------------------------------------------------------------------
// A remembered shell grant must cover a command *shape* ("pnpm run lint"), not
// a permission name and not one exact argument string. Two things make a prefix
// unsafe to grant, and both refuse instead of guessing:
//   - shell metacharacters: a prefix would authorise a compound command it
//     never described (`npm test && rm -rf /`);
//   - high-risk root commands: granting them turns a narrow memory into a
//     permanent bypass (`rm`, `sudo`, `powershell`, ...).
// Refusal is deliberately over-eager (a quoted `;` also refuses): the caller
// falls back to asking the user, which is the safe direction.
const HIGH_RISK_ROOT_COMMANDS = new Set([
  'bash', 'chgrp', 'chmod', 'chown', 'cmd', 'dd', 'del', 'doas', 'erase',
  'fish', 'format', 'mkfs', 'mount', 'powershell', 'pwsh', 'reg', 'rm',
  'rmdir', 'sc', 'sh', 'shutdown', 'sudo', 'umount', 'wsl', 'zsh'
]);

const SHELL_META_RE = /[;&|<>`$(){}[\]\r\n]/;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/;
const STABLE_ACTION_RE = /^[A-Za-z0-9._:@+-]+$/;
const EXECUTABLE_SUFFIX_RE = /\.(exe|cmd|bat|ps1)$/;
// Script runners need one more token than other commands to reach the reusable
// unit of work: `pnpm run lint` is the thing the user means to remember, not
// `pnpm run`.
const SCRIPT_RUNNERS = new Set(['bun', 'deno', 'npm', 'pnpm', 'yarn']);
const SCRIPT_RUN_ACTIONS = new Set(['run', 'run-script', 'task']);

function executableBasenameOf(token) {
  const normalized = String(token || '').replaceAll('\\', '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  return name.replace(EXECUTABLE_SUFFIX_RE, '');
}

/**
 * Derive the reusable grant prefix for one shell command.
 * @returns {string|undefined} e.g. "pnpm run lint"; undefined when no safe,
 *   reusable prefix exists (high-risk root command, metacharacters, dynamic).
 */
function deriveShellCommandPrefix(command) {
  const raw = String(command || '').trim();
  if (!raw) return undefined;
  if (SHELL_META_RE.test(raw)) return undefined;

  const tokens = raw.split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < tokens.length && ENV_ASSIGNMENT_RE.test(tokens[index])) index += 1;
  const executable = tokens[index];
  if (!executable) return undefined;

  // An explicitly pathed executable is ambiguous as soon as the path contains a
  // space ("C:\Program Files\nodejs\npm.cmd" splits into two tokens), and a
  // grant is never worth that guess. Refuse; the caller confirms per call.
  if (/[\\/:]/.test(executable)) return undefined;

  const name = executableBasenameOf(executable);
  if (!name || HIGH_RISK_ROOT_COMMANDS.has(name)) return undefined;

  const action = tokens[index + 1];
  if (!action) return name;
  // Dropping leading options would widen the grant instead of narrowing it
  // (`node --test` would grant all of `node`), so an option refuses the prefix.
  if (action.startsWith('-')) return undefined;
  if (!STABLE_ACTION_RE.test(action)) return undefined;
  const script = tokens[index + 2];
  if (SCRIPT_RUNNERS.has(name) && SCRIPT_RUN_ACTIONS.has(action)
    && script && !script.startsWith('-') && STABLE_ACTION_RE.test(script)) {
    return `${name} ${action} ${script}`;
  }
  return `${name} ${action}`;
}

module.exports = {
  HIGH_RISK_ROOT_COMMANDS,
  classifyDelegatedShellCommand,
  deriveShellCommandPrefix
};
