'use strict';

// Architecture budget guard (plan T0.1): the giant files and the domain-module
// budget are frozen at the audited baseline. The refactor may only shrink them;
// new lib modules must stay within the 800-line domain budget. Raise a budget
// in test/fixtures/architecture-budget.json only with a matching justification
// in the same commit.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures', 'architecture-budget.json');
const budget = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function countLines(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function listJsFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

test('core files stay inside their recorded budgets', () => {
  const violations = [];
  for (const [relative, entry] of Object.entries(budget.coreFiles)) {
    const file = path.join(appRoot, relative);
    assert.ok(fs.existsSync(file), `budgeted file is missing: ${relative}`);
    const lines = countLines(file);
    if (lines > entry.budget) violations.push(`${relative}: ${lines} > ${entry.budget}`);
    if (entry.target !== null && entry.budget < entry.target) {
      violations.push(`${relative}: budget ${entry.budget} is below its phase target ${entry.target}`);
    }
  }
  assert.deepEqual(violations, [], 'core file budget exceeded — refactor instead of growing');
});

test('domain modules stay within the 800-line budget unless recorded as legacy', () => {
  const { maxLines, roots } = budget.moduleBudget;
  const legacy = budget.legacyLargeModules || {};
  const violations = [];
  for (const root of roots) {
    const rootDir = path.join(appRoot, root);
    assert.ok(fs.existsSync(rootDir), `budget root is missing: ${root}`);
    for (const file of listJsFiles(rootDir)) {
      const relative = path.relative(appRoot, file).split(path.sep).join('/');
      const lines = countLines(file);
      if (lines <= maxLines) continue;
      if (Object.prototype.hasOwnProperty.call(legacy, relative)) {
        if (lines > legacy[relative]) violations.push(`${relative}: ${lines} > legacy ceiling ${legacy[relative]}`);
      } else {
        violations.push(`${relative}: ${lines} > ${maxLines} (new module over budget)`);
      }
    }
  }
  assert.deepEqual(violations, [], 'domain module budget exceeded');
});

test('legacy over-budget modules may only shrink and must still exist', () => {
  const violations = [];
  for (const [relative, ceiling] of Object.entries(budget.legacyLargeModules || {})) {
    const file = path.join(appRoot, relative);
    if (!fs.existsSync(file)) {
      violations.push(`${relative}: recorded legacy module is missing`);
      continue;
    }
    const lines = countLines(file);
    if (lines > ceiling) violations.push(`${relative}: ${lines} > legacy ceiling ${ceiling}`);
  }
  assert.deepEqual(violations, [], 'a legacy large module grew');
});
