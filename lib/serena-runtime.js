'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SERENA_VERSION = '1.6.1';
const SERENA_TOOLS = Object.freeze([
  'find_declaration',
  'find_implementations',
  'find_referencing_symbols',
  'find_symbol',
  'get_diagnostics_for_file',
  'get_symbols_overview',
  'insert_after_symbol',
  'insert_before_symbol',
  'rename_symbol',
  'replace_symbol_body',
  'safe_delete_symbol'
]);

const SERENA_SERVER_ARGS = Object.freeze([
  'start-mcp-server',
  '--context=codex',
  '--add-mode=no-memories',
  '--add-mode=no-onboarding',
  '--enable-web-dashboard=False',
  '--open-web-dashboard=False',
  '--enable-gui-log-window=False'
]);

function resolveSerenaCommand() {
  const home = String(process.env.USERPROFILE || process.env.HOME || '').trim();
  const candidate = home ? path.join(home, '.local', 'bin', process.platform === 'win32' ? 'serena.exe' : 'serena') : '';
  if (candidate && fs.existsSync(candidate)) {
    return { command: candidate, prefixArgs: [] };
  }
  return {
    command: 'uvx',
    prefixArgs: ['--quiet', '--from', `serena-agent==${SERENA_VERSION}`, 'serena']
  };
}

function workspaceKey(workspace) {
  return crypto.createHash('sha256').update(path.resolve(String(workspace || ''))).digest('hex').slice(0, 24);
}

function writeRuntimeConfig(home) {
  const projectData = path.join(home, 'project-data');
  const configPath = path.join(home, 'serena_config.yml');
  fs.mkdirSync(projectData, { recursive: true });
  const projectLocation = path.join(projectData, '.serena').replaceAll('\\', '/');
  const config = [
    'language_backend: LSP',
    'line_ending: native',
    'gui_log_window: false',
    'web_dashboard: false',
    'web_dashboard_open_on_launch: false',
    'log_level: 30',
    'trace_lsp_communication: false',
    'tool_timeout: 240',
    'base_modes:',
    '  - editing',
    'default_modes: []',
    'ignored_paths: []',
    'read_only_memory_patterns: []',
    'ignored_memory_patterns: []',
    `project_serena_folder_location: ${JSON.stringify(projectLocation)}`,
    'trusted_project_path_patterns: []',
    'fixed_tools:',
    ...SERENA_TOOLS.map(tool => `  - ${tool}`),
    'projects: []',
    ''
  ].join('\n');
  if (fs.existsSync(configPath) && fs.readFileSync(configPath, 'utf8') === config) return;
  fs.writeFileSync(configPath, config, 'utf8');
}

function createSerenaServer(dataDir, options = {}) {
  const workspace = String(options.workspace || '').trim();
  const key = workspace ? workspaceKey(workspace) : 'catalog';
  const home = path.join(path.resolve(String(dataDir || '.')), 'serena', 'workspaces', key);
  writeRuntimeConfig(home);
  const executable = resolveSerenaCommand();
  const args = [
    ...executable.prefixArgs,
    ...SERENA_SERVER_ARGS,
    ...(workspace ? ['--project', path.resolve(workspace)] : [])
  ];
  return {
    id: 'mcp_default_serena',
    name: 'Serena',
    description: '以 LSP 符号、引用、诊断和符号级编辑完成精确的代码定位与修改。',
    command: executable.command,
    args,
    env: { SERENA_HOME: home },
    enabled: true,
    builtin: true,
    runtime: 'serena',
    sourceVersion: `official-${SERENA_VERSION}`,
    timeout: 240_000,
    workspaceKey: key
  };
}

module.exports = {
  SERENA_VERSION,
  SERENA_TOOLS,
  createSerenaServer,
  resolveSerenaCommand,
  workspaceKey
};
