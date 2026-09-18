'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  plansRoot,
  planTitleFromText,
  buildPlanDocumentName,
  sanitizePlanDocumentText,
  writePlanDocument
} = require('../lib/plan-document');

test('plan document naming follows the xxx计划.md convention', () => {
  assert.equal(planTitleFromText('# 实现登录页计划\n\n第一步'), '实现登录页计划');
  assert.equal(planTitleFromText('修复: 登录/注册 bug'), '修复 登录 注册 bug');
  assert.equal(buildPlanDocumentName('实现登录页计划'), '实现登录页计划.md');
  assert.equal(buildPlanDocumentName('首页改版'), '首页改版计划.md');
  assert.equal(buildPlanDocumentName(''), '计划.md');
});

test('writePlanDocument writes into <dataDir>/plans and avoids collisions', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plan-test-'));
  try {
    const first = writePlanDocument({ dataDir, text: '# 实现登录页计划\n\n第一步', now: 1 });
    const second = writePlanDocument({ dataDir, text: '# 实现登录页计划\n\n第一步', now: 2 });
    assert.equal(first.name, '实现登录页计划.md');
    assert.equal(second.name, '实现登录页计划-2.md');
    assert.equal(path.dirname(first.path), plansRoot(dataDir));
    assert.match(fs.readFileSync(first.path, 'utf8'), /第一步/u);
    assert.equal(writePlanDocument({ dataDir, text: '   ' }), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('sanitizes protocol blocks, tagged thinking, and leaked reasoning openers', () => {
  const opener = '已确认：计划对象为「计划模式」本身——编写一份可执行的验收测试计划。工作区已勘察：test/24 为空。';
  const dirty = [
    opener,
    '<yan-delivery-contract>',
    'intent: presentable',
    'scope: leak',
    '</yan-delivery-contract>',
    '<thinking>内部思考不应出现</thinking>',
    '# 计划模式产品性验收测试计划',
    '',
    '正文。'
  ].join('\n');
  const cleaned = sanitizePlanDocumentText(dirty, `${opener}后续思考。`);
  assert.doesNotMatch(cleaned, /yan-delivery-contract|intent:|内部思考不应该出现|内部思考不应出现/u);
  assert.doesNotMatch(cleaned, /已确认/u);
  assert.match(cleaned, /# 计划模式产品性验收测试计划/u);
  // Without matching reasoning the opening paragraph is normal content.
  const kept = sanitizePlanDocumentText(dirty, '完全不同的思考内容');
  assert.match(kept, /^已确认/u);
});

test('writePlanDocument refuses content that sanitizes to nothing', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plan-empty-'));
  try {
    assert.equal(writePlanDocument({
      dataDir,
      text: '<yan-delivery-contract>\nintent: presentable\n</yan-delivery-contract>'
    }), null);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
