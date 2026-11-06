'use strict';

const BUILTIN_AGENT_PRESETS = ['standard', 'daily', 'minimal', 'creative', 'uncensored'];
const normalizeId = value => String(value || '').trim().toLowerCase();

function normalizeAgentPreset(value, customAgents = []) {
  const id = normalizeId(value);
  return BUILTIN_AGENT_PRESETS.includes(id) || customAgents.some(agent => agent?.id === id)
    ? id : 'standard';
}

function normalizeCustomAgent(input = {}) {
  const id = normalizeId(input.id);
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const systemPrompt = String(input.systemPrompt || '').trim();
  const tools = [...new Set((Array.isArray(input.tools) ? input.tools : []).map(tool => String(tool).trim()).filter(Boolean))];
  if (!/^custom-[a-z0-9][a-z0-9-]{0,55}$/.test(id)) throw new Error('Agent ID 必须以 custom- 开头，并只包含小写字母、数字和短横线。');
  if (!name || name.length > 64) throw new Error('Agent 名称不能为空且不能超过 64 个字符。');
  if (!description || description.length > 240) throw new Error('Agent 描述不能为空且不能超过 240 个字符。');
  if (!systemPrompt || systemPrompt.length > 40_000) throw new Error('系统提示词不能为空且不能超过 40000 个字符。');
  if (tools.length > 200 || tools.some(tool => !/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(tool))) {
    throw new Error('工具列表无效，最多可选择 200 个工具 ID。');
  }
  if (tools.some(tool => /^(?:yan_session_|session_|worktree_|task$|subagent$)/i.test(tool))) {
    throw new Error('自定义 Agent 不能开放 Session MCP、任务委派或 worktree 管理工具。');
  }
  return { id, name, description, systemPrompt, tools };
}

module.exports = { BUILTIN_AGENT_PRESETS, normalizeAgentPreset, normalizeCustomAgent };
