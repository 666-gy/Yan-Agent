'use strict';

// Path-containment and text guards shared by the Skill management tools.
//
// These were private to `yan-skills-mcp.js`; they are pure (no module state) and
// the same containment rule is re-implemented in the other Yan MCP servers, so
// they live here instead of being duplicated per server.

const path = require('path');

// `allowRoot` exists because a few callers legitimately resolve the configured
// root itself (checking "is this inside?" before a mkdir), while the rest must
// land strictly below it.
function assertInside(root, target, allowRoot = false) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if ((allowRoot && resolvedTarget === resolvedRoot) || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedTarget;
  }
  throw new Error('路径超出 Yan Skill 管理器允许的范围。');
}

function assertDirectChild(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (path.dirname(resolvedTarget) !== resolvedRoot) throw new Error('Skill 必须是 Yan Skill 根目录的直接子目录。');
  return resolvedTarget;
}

// Rejects empty, over-long, and control-character-bearing input. Newlines and
// tabs are allowed through: Skill prompts and markdown bodies carry them.
function cleanText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label}不能为空。`);
  if (text.length > maxLength) throw new Error(`${label}过长。`);
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 && character !== '\n' && character !== '\t') throw new Error(`${label}包含无效控制字符。`);
  }
  return text;
}

module.exports = { assertInside, assertDirectChild, cleanText };
