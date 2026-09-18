'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { safePath } = require('./project-instructions');
function fileRevision(file) {
  try {
    const stat = fs.statSync(file, { bigint: true });
    if (stat.size > 2n * 1024n * 1024n) return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  catch { return 'missing'; }
}
// Classify evidence, never execute project commands here.
function classifyCommand(command = '') {
  const text = String(command).trim();
  if (/[;&|\n\r]/.test(text)) return 'unknown';
  if (!text || /(?:^|\s)(?:--version|-v|--help|-h)(?:\s|$)/i.test(text)
    || /\b(?:install|uninstall|update|upgrade|add)\b/i.test(text)) return 'environment';
  // Do not mistake `echo npm test` or arbitrary scripts mentioning checks
  // for an executed test. Complex shell wrappers remain unknown.
  if (!/^(?:npm|npx|pnpm|yarn|node|deno|bun|tsx|ts-node|tsc|eslint|biome|jest|vitest|mocha|playwright|pytest|python3?|cargo|go|dotnet|make|cmake|gradlew?|mvn|ruff|phpunit|mypy|pyright)\b/i.test(text)) return 'unknown';
  if (/\b(?:tsc|typecheck|type-check|mypy|pyright)\b/i.test(text)) return 'types';
  if (/\b(?:eslint|lint|ruff\s+check|biome\s+check)\b/i.test(text)) return 'lint';
  if (/\b(?:node\s+--check|python\S*\s+-m\s+py_compile)\b/i.test(text)) return 'syntax';
  if (/\b(?:test|pytest|vitest|jest|mocha|phpunit|unittest|smoke)\b|(?:^|[/\\])[^\s]*\.(?:test|spec|e2e)\.[cm]?[jt]s\b/i.test(text)) return 'test';
  if (/\b(?:build|compile|check)\b/i.test(text) && /\b(?:npm|pnpm|yarn|bun|cargo|go|dotnet|make|cmake|gradle|mvn)\b/i.test(text)) return 'build';
  return 'unknown';
}
function verificationRecord(part) {
  const command = part?.state?.input?.command || part?.state?.input?.cmd || '';
  const kind = classifyCommand(command);
  if (['environment', 'unknown'].includes(kind)) return null;
  const metadata = part.state?.metadata || {};
  const rawExit = metadata.exit ?? metadata.exitCode;
  const text = String(part.state?.output || '');
  const match = text.match(/(?:exit(?:ed with)? (?:code|status)|Process exited with code)[:\s]+(-?\d+)/i);
  const exit = rawExit == null ? (match ? Number(match[1]) : null) : Number(rawExit);
  const failed = part.state?.status === 'error' || (exit !== null && exit !== 0)
    || /(?:^|\n)(?:FAIL\b|Error:|SyntaxError:|error TS\d+|FAILED\b)/m.test(text);
  return { kind, command, callId: part.callID || part.id, exit,
    status: failed ? 'failed' : part.state?.status === 'completed' && exit === 0 ? 'passed' : 'unknown',
    startedAt: part.state?.time?.start || 0, endedAt: part.state?.time?.end || 0 };
}
function summarizeVerification(messages = [], { workspace } = {}) {
  const records = [];
  let lastMutation = 0;
  let sequence = 0;
  for (const message of messages) for (const part of message.parts || []) {
    sequence++;
    if (part.type !== 'tool') continue;
    if (['write', 'edit', 'apply_patch'].includes(part.tool) && part.state?.status === 'completed') lastMutation = sequence;
    if (['bash', 'shell'].includes(part.tool) && /\b(?:set-content|out-file|add-content|tee|touch|mv|cp|rm)\b|(?:^|\s)(?:echo|printf|cat)\b[^\n]*>/i.test(part.state?.input?.command || '') && part.state?.status === 'completed') lastMutation = sequence;
    if (['bash', 'shell'].includes(part.tool)) {
      const record = verificationRecord(part);
      if (record) {
        const receipt = part.state?.metadata?.yanVerification;
        const files = receipt?.files || {};
        const changed = workspace && Object.entries(files).some(([file, revision]) => {
          try { return fileRevision(safePath(fs.realpathSync(workspace), file)) !== revision; } catch { return true; }
        });
        records.push({ ...record, sequence, files, directory: receipt?.directory || part.state?.input?.workdir || '',
          status: record.status === 'passed' && (changed || receipt?.status === 'stale') ? 'stale' : record.status });
      }
    }
  }
  for (const record of records) if (record.status === 'passed' && record.sequence < lastMutation) record.status = 'stale';
  // A different successful command cannot erase an unresolved failure.
  const latest = new Map();
  for (const record of records) latest.set(`${record.directory || ''}:${record.command.trim()}`, record);
  const outstanding = [...latest.values()].filter(record => record.status !== 'passed');
  return { mutated: lastMutation > 0, records,
    status: outstanding.find(record => record.status === 'failed')?.status || outstanding.at(-1)?.status || records.at(-1)?.status || 'unchecked',
    hasCurrentPass: latest.size > 0 && outstanding.length === 0 };
}
module.exports = { classifyCommand, verificationRecord, summarizeVerification, fileRevision };
