'use strict';
const path = require('node:path');
const { childReadablePath } = require('../provider-staging');

// These descriptions advertise capabilities, not the full tools/list schemas.
// The live MCP handshake remains the authority for executable tool definitions.
const capabilities = {
  yan_browser: 'Operate the Yan built-in browser: open tabs, inspect pages, click, fill forms, scroll, take screenshots and verify web interfaces.',
  yan_skills: 'Find, read, install and create skills; create custom agents and plugins; list and install desktop pets.',
  yan_session: 'Work with Yan conversations and external-agent tasks, create handoffs and interactive UI, and use session presentation features.',
  yan_harness: 'Inspect and manage learned harness entries, schedule refinement and rollback, and check refinement progress.',
  yan_analysis: 'Analyze source code: repository maps, outlines, symbols, call trees, code search, history search and source slices.',
  yan_workspace: 'Manage Git worktrees, inspect their status, merge or remove them, and inspect code impact.',
  yan_web: 'Fetch web pages, download files and list page assets.',
  yan_mcp: 'List, verify, install, remove and activate external MCP servers.',
  yan_plugin: 'List, install and remove Yan plugins.',
  yan_provider: 'Configure an API provider from natural language: probe a Base URL catalog, write the connection, classify models and bind text/image/video roles.'
};
const connectionName = name => `${name}_connect`;
const connectionServer = tool => Object.keys(capabilities).find(name => connectionName(name) === tool);
const toolNames = name => (require('./mcp-catalogs.json')[name]?.tools || []).map(tool => `${name}_${tool.name}`);

function isBundledServer(name, server) {
  if (!capabilities[name] || server?.type !== 'local' || !Array.isArray(server.command) || server.command.length !== 2) return false;
  const expected = path.join(__dirname, '..', `yan-${name.slice(4)}-mcp.js`);
  return childReadablePath(server.command[1]) === childReadablePath(expected);
}
function deferredServers(config) {
  return Object.fromEntries(Object.entries(config.mcp?.servers || {})
    .filter(([name, server]) => !server.disabled && isBundledServer(name, server)));
}
function deferredConfig(config) {
  const deferred = deferredServers(config);
  return { ...config, mcp: { ...config.mcp, servers: Object.fromEntries(Object.entries(config.mcp?.servers || {})
    .map(([name, server]) => [name, deferred[name] ? { ...server, disabled: true } : server])) } };
}
function connectionToolAllowed(tool, allowed) {
  const server = connectionServer(tool);
  return server ? toolNames(server).some(allowed) : allowed(tool);
}
module.exports = { capabilities, connectionName, connectionServer, toolNames, isBundledServer,
  deferredServers, deferredConfig, connectionToolAllowed };
