'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { diffLines } = require('diff');

function workspaceRelativePath(workspace, filePath) {
  const relative = path.relative(workspace, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return path.basename(filePath);
  return relative.replace(/\\/g, '/');
}

function normalizeLineEndings(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function countLineDiff(before, after) {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(normalizeLineEndings(before), normalizeLineEndings(after))) {
    const count = Number(part.count) || 0;
    if (part.added) additions += count;
    if (part.removed) deletions += count;
  }
  return { additions, deletions };
}

async function summarizeRunChanges(workspace, changes) {
  const files = [];
  for (const change of changes || []) {
    const beforeExists = change.before !== null && change.before !== undefined;
    const afterExists = fs.existsSync(change.path);
    let after = '';
    if (afterExists) {
      try {
        after = await fsp.readFile(change.path, 'utf8');
      } catch (error) {
        files.push({
          path: workspaceRelativePath(workspace, change.path),
          additions: 0,
          deletions: 0,
          status: 'unknown',
          error: error.message
        });
        continue;
      }
    }
    const before = beforeExists ? String(change.before) : '';
    if (before === after && beforeExists === afterExists) continue;
    const stats = countLineDiff(before, after);
    files.push({
      path: workspaceRelativePath(workspace, change.path),
      additions: stats.additions,
      deletions: stats.deletions,
      status: !beforeExists && afterExists ? 'created' : (beforeExists && !afterExists ? 'deleted' : 'modified'),
      op: change.op || 'write'
    });
  }
  return {
    count: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

module.exports = {
  countLineDiff,
  summarizeRunChanges,
  workspaceRelativePath
};
