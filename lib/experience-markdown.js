'use strict';

// A write boundary, not a prompt convention. Repair syntax without inventing
// evidence; refuse reviewer instructions/receipts masquerading as knowledge.
function normalizeExperienceMarkdown(value, { title = '经验', maxLength = 24000 } = {}) {
  if (typeof value !== 'string') throw new Error('经验必须为 Markdown 字符串');
  const original = String(value || '');
  let text = original.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (!text) throw new Error('经验内容不能为空');
  if (text.length > maxLength) throw new Error('经验内容过长，请先精炼；不会截断后写入');
  if (/动作序列：|关键回执：|请基于下面的真实执行轨迹|"invalidated_snapshot_ids"|"computer_control_app"/.test(text)) {
    throw new Error('不能把复盘提示词或原始工具回执写成经验，请提炼适用场景、操作、验证和失败修正');
  }
  if (/^(?:流程已完成并记录|以后优先复用)[。\s]*$/m.test(text)) throw new Error('空泛模板不是可复用经验');
  // Unwrap a model's whole-document Markdown code block.
  const wrapped = text.match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/i);
  if (wrapped) text = wrapped[1].trim();
  let inFence = false;
  const lines = text.split('\n').map(line => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line.trimEnd(); }
    if (inFence) return line;
    return line.trimEnd().replace(/^(#{1,6})([^#\s])/, '$1 $2');
  });
  if (inFence) lines.push('```');
  text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  if (!/^#{1,6} /m.test(text)) text = `## ${String(title).replace(/[\r\n#]/g, ' ').trim()}\n\n${text}`;
  // Deduplicate identical paragraphs; never merge different applications.
  const seen = new Set();
  if (!text.includes('```')) text = text.split(/\n\n/).filter(block => {
    if (seen.has(block)) return false;
    seen.add(block); return true;
  }).join('\n\n');
  if (!/^#{1,6} \S/m.test(text)) throw new Error('经验缺少有效 Markdown 标题');
  return { markdown: `${text}\n`, corrected: text !== original.trim(), format: 'markdown' };
}

module.exports = { normalizeExperienceMarkdown };
