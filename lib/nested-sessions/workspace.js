'use strict';
const { execFileSync } = require('node:child_process');
const worktrees = require('../workspace/worktree');
const { acquireFiles } = require('../workspace/file-locks');
module.exports = {
  repository: worktrees.repository,
  async prepare(directory, id, base) {
    const record = await worktrees.prepare(directory, id, base || {});
    execFileSync('git', ['-C', directory, 'update-ref', `refs/yan/nested-baselines/${id}`, record.commit], { windowsHide: true });
    return record;
  },
  integrate: (record, tree) => worktrees.integrate(record, { expectedTree: tree }),
  async freeze(record, resultId) {
    const release = await acquireFiles([record.directory], { owner: record.childID });
    try {
      const tree = worktrees.snapshot(record.directory);
      if (resultId) execFileSync('git', ['-C', record.directory, 'update-ref', `refs/yan/nested/${resultId}`, tree, ''], { windowsHide: true });
      return tree;
    } finally { release(); }
  }
};
