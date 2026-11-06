'use strict';

const system = 'You are a helpful software engineer assistant.';
const isMinimal = request => request.agentPreset === 'minimal' && !request.utility;
function toolAllowed(name) {
  const tool = String(name).replace(/^opencode[._]/, '').replace(/\./g, '_');
  return ['bash', 'read', 'read_image'].includes(tool);
}
module.exports = { system, isMinimal, toolAllowed };
