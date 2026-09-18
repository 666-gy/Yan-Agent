'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { safePath } = require('./project-instructions');
function projectEnvironment(workspace, target = workspace) {
  const root = fs.realpathSync(workspace);
  const result = { workspace: root, manifests: [], checks: [], note: 'Static discovery only. Commands are candidates, not executed or verified. Confirm scope and permissions before running.' };
  for (const name of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'Makefile', 'tsconfig.json', 'pnpm-workspace.yaml']) {
    try {
      const file = safePath(root, name);
      if (!fs.existsSync(file)) continue;
      result.manifests.push(name);
      if (name === 'package.json' && fs.statSync(file).size < 128000) {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        result.packageManager = pkg.packageManager || (fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm');
        result.workspaces = pkg.workspaces;
        result.entry = pkg.main || pkg.exports;
        result.checks = Object.entries(pkg.scripts || {}).filter(([key]) => /^(?:test|check|typecheck|lint|build)(?:$|:)/.test(key))
          .slice(0, 16).map(([name, command]) => ({ name, command: String(command).slice(0, 600), source: 'package.json' }));
      }
    } catch (error) { result.manifests.push(`${name}: unavailable (${error.message})`); }
  }
  if (target !== workspace) {
    const resolved = safePath(root, target);
    let directory = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
    result.packages = [];
    while (directory !== root && result.packages.length < 8) {
      if (fs.existsSync(directory)) {
        const local = projectEnvironment(directory);
        if (local.manifests.length) result.packages.unshift({ directory, ...local });
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return result;
}
module.exports = { projectEnvironment };
