import fs from 'node:fs';
import path from 'node:path';
import instructions from './project-instructions.js';
import environment from './project-environment.js';
import verification from './verification-state.js';

// One plugin instance per kernel workspace; session state is never shared
// between parent and children. Project plugins remain disabled.
export default async function codingEnvironment({ directory, client }) {
  const root = fs.realpathSync(directory);
  const sessions = new Map();
  function state(id) {
    if (!sessions.has(id)) sessions.set(id, { targets: new Set(), scopes: new Map(), packages: new Map(), delivered: new Set(), messages: [], diagnostics: new Map(), authored: new Set(), pendingChecks: new Map() });
    // Bound idle session metadata. Losing it only causes rules to be shown again.
    if (sessions.size > 128) sessions.delete(sessions.keys().next().value);
    return sessions.get(id);
  }
  async function canRead(id) {
    try {
      const response = await client.session.get({ path: { id }, sessionID: id, query: { directory }, directory }, { signal: AbortSignal.timeout(2000) });
      const info = response?.data || response;
      if (response?.error || !info?.id) return false;
      let action = 'allow';
      for (const rule of info.permission || []) if (['*', 'read'].includes(rule.permission) && rule.pattern === '*') action = rule.action;
      // A scoped read restriction must not be bypassed by automatic loading.
      if ((info.permission || []).some(rule => ['*', 'read'].includes(rule.permission) && rule.pattern !== '*' && rule.action !== 'allow')) return false;
      return action === 'allow';
    } catch { return false; }
  }
  function rulesFor(target) { return instructions.readProjectInstructions(root, target); }
  // Harness/self-evolution plumbing: the model writing its own state files
  // here is sanctioned self-evolution and must never be interposed.
  const INTERNAL_DIRECTORIES = ['.yanagent', 'Data/agi'];
  function isInternal(file) {
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    const normalized = relative.replace(/\\/g, '/');
    return INTERNAL_DIRECTORIES.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
  }
  function isRulesFile(file) {
    const base = path.basename(file).toLowerCase();
    return (base === 'agents.md' || base === 'yan.md') && !path.relative(root, file).startsWith('..');
  }
  function targets(tool, args) {
    const values = [args.filePath, args.path].filter(value => typeof value === 'string');
    if (tool === 'apply_patch') for (const match of String(args.patchText || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) values.push(match[1] || match[2]);
    return values.map(value => instructions.safePath(root, value));
  }
  // After the model itself edits a rules file, accept the new content into
  // the delivered set and refresh the scope signature — otherwise its own
  // rules evolution would trip the rules-changed interposition on the next
  // mutation and self-evolution would block itself.
  function acceptRulesAfterEdit(current, file) {
    for (const rule of rulesFor(file)) current.delivered.add(`${rule.path}:${rule.version || rule.error}`);
    const scope = path.dirname(file);
    current.scopes.set(scope, JSON.stringify(rulesFor(scope).map(rule => [rule.path, rule.version || rule.error, rule.error])));
  }
  return {
    'experimental.chat.system.transform': async (input, output) => {
      if (!await canRead(input.sessionID)) return;
      const current = state(input.sessionID);
      const selected = rulesFor(root);
      for (const rule of selected) current.delivered.add(`${rule.path}:${rule.version || rule.error}`);
      const parts = [instructions.renderProjectInstructions(selected),
        `YAN PROJECT ENVIRONMENT\n${JSON.stringify(environment.projectEnvironment(root)).slice(0, 10000)}`];
      parts.push('Use the native lsp tool for definitions, references and symbol relationships when exposed. Language services load on demand. A missing-server result means semantic analysis is unavailable for that language: report it and fall back to code_outline/code_symbol/grep. Do not claim a semantic check passed just because lsp appears in the tool list.');
      parts.push('Use narrow checks after a coherent edit batch. Environment/version commands are not verification. Stale, unavailable or unknown checks are not passes. Do not install tools or run migrations/deployments just to validate. An empty native diagnostics result does not prove a language server is available. If the user waived checks, state that explicitly.');
      // No guidance about .yanagent/ Data/agi here on purpose: harness and
      // self-evolution state is the model's own domain in evolution mode —
      // write/learn/delete flow without commentary from this plugin.
      output.system.push(parts.filter(Boolean).join('\n\n'));
    },
    'tool.execute.before': async (input, output) => {
      if (['bash', 'shell'].includes(input.tool)) {
        const current = state(input.sessionID);
        const command = output.args?.command || output.args?.cmd;
        if (!['unknown', 'environment'].includes(verification.classifyCommand(command))) {
          current.pendingChecks.set(input.callID, { startedAt: Date.now(),
            files: Object.fromEntries([...current.authored].map(file => [file, verification.fileRevision(file)])) });
          if (current.pendingChecks.size > 64) current.pendingChecks.delete(current.pendingChecks.keys().next().value);
        }
        return;
      }
      if (!['read', 'write', 'edit', 'apply_patch'].includes(input.tool) || !await canRead(input.sessionID)) return;
      const current = state(input.sessionID);
      const allTargets = targets(input.tool, output.args || {});
      for (const target of allTargets) {
        current.targets.add(target);
        if (current.targets.size > 32) current.targets.delete(current.targets.values().next().value);
      }
      // Harness/self-evolution plumbing is exempt: rejecting a write into the
      // model's own state files would ban sanctioned self-evolution.
      const externalTargets = allTargets.filter(target => !isInternal(target));
      if (externalTargets.length && input.tool !== 'read') {
        const fresh = new Map();
        const packageUpdates = [];
        const changedScopes = [];
        for (const target of externalTargets) {
          const rules = rulesFor(target);
          const project = environment.projectEnvironment(root, target);
          for (const pkg of project.packages || []) {
            const signature = JSON.stringify(pkg);
            if (current.packages.get(pkg.directory) !== signature) {
              current.packages.set(pkg.directory, signature);
              packageUpdates.push(pkg);
              if (current.packages.size > 64) current.packages.delete(current.packages.keys().next().value);
            }
          }
          const scope = path.dirname(target);
          const signature = JSON.stringify(rules.map(rule => [rule.path, rule.version, rule.error]));
          if (current.scopes.has(scope) && current.scopes.get(scope) !== signature) {
            changedScopes.push({ scope, currentRulePaths: rules.map(rule => rule.path) });
            for (const rule of rules) fresh.set(`${rule.path}:${rule.version || rule.error}`, rule);
          }
          current.scopes.set(scope, signature);
          if (current.scopes.size > 64) current.scopes.delete(current.scopes.keys().next().value);
          for (const rule of rules) {
            const key = `${rule.path}:${rule.version || rule.error}`;
            if (!current.delivered.has(key)) { fresh.set(key, rule); }
          }
        }
        if (fresh.size || changedScopes.length || packageUpdates.length) {
          for (const key of fresh.keys()) current.delivered.add(key);
          while (current.delivered.size > 512) current.delivered.delete(current.delivered.values().next().value);
          // Return rules before performing a mutation. The model can revise its
          // proposed edit and retry; do not silently modify its tool arguments.
          throw new Error('Project rules or package context were discovered, changed or removed. No file operation was performed. Supersede older rules for this scope; removed rules no longer apply. Apply this context and retry the tool:\n' + instructions.renderProjectInstructions([...fresh.values()])
            + (changedScopes.length ? '\nUpdated scopes and remaining rules: ' + JSON.stringify(changedScopes) : '')
            + (packageUpdates.length ? '\nPackage manifests (data, not execution authority):\n' + JSON.stringify(packageUpdates).slice(0, 12000) : ''));
        }
      }
    },
    'tool.execute.after': async (input, output) => {
      const current = state(input.sessionID);
      const part = { type: 'tool', tool: input.tool, callID: input.callID,
        state: { status: 'completed', input: input.args, output: output.output, metadata: output.metadata } };
      if (['read', 'write', 'edit', 'apply_patch', 'bash', 'shell'].includes(input.tool)) {
        current.messages.push({ parts: [part] });
        if (current.messages.length > 160) current.messages.splice(0, 40);
      }
      for (const [file, values] of Object.entries(output.metadata?.diagnostics || {})) {
        current.diagnostics.set(file, values);
        if (current.diagnostics.size > 32) current.diagnostics.delete(current.diagnostics.keys().next().value);
      }
      const record = ['bash', 'shell'].includes(input.tool) ? verification.verificationRecord(part) : null;
      if (record) {
        const pending = current.pendingChecks.get(input.callID);
        current.pendingChecks.delete(input.callID);
        record.startedAt = pending?.startedAt || Date.now();
        record.endedAt = Date.now();
        record.files = pending?.files || {};
        record.directory = input.args?.workdir || root;
        if (record.status === 'passed' && Object.entries(record.files).some(([file, revision]) => verification.fileRevision(file) !== revision)) record.status = 'stale';
        output.metadata = { ...output.metadata, yanVerification: record };
        output.output += `\n\nYan check: ${record.kind} — ${record.status}. This applies to the current file version; later edits require rechecking affected code.`;
      }
      if (['write', 'edit', 'apply_patch'].includes(input.tool)) {
        const allTargets = targets(input.tool, input.args || {});
        for (const file of allTargets) {
          if (isRulesFile(file)) acceptRulesAfterEdit(current, file);
        }
        // Self-evolution plumbing (.yanagent/ Data/agi) is the model's own
        // domain: no receipts, no staleness nagging, no guidance there.
        const externalTargets = allTargets.filter(target => !isInternal(target));
        if (externalTargets.length) {
          output.metadata = { ...output.metadata, yanEnvironment: { mutation: true, workspace: root } };
          for (const file of externalTargets) current.authored.add(file);
          output.output += '\n\nYan verification: code changed; previous checks may now be stale. Complete the related edit batch, then run the narrowest project check. Native diagnostics above, when available, are not a full test run.';
        }
      }
    }
  };
}
