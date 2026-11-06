'use strict';
// Public contracts shared by the desktop host and Node kernel.
const constants = require('./kernel-policy/constants');
const memory = require('./kernel-policy/memory');
const errors = require('./kernel-policy/errors');
const config = require('./kernel-policy/config');
const prompts = require('./kernel-policy/prompts');
const { authoritativePolicySystem } = require('./behavior-policy');
const providers = require('./provider-staging');
const { VERSION: OPENCODE_VERSION } = require('./kernel-v2/runtime');
module.exports = {
  DEFAULT_INPUT_TOKENS_PER_SECOND: constants.DEFAULT_INPUT_TOKENS_PER_SECOND,
  OPENCODE_VERSION: OPENCODE_VERSION,
  normalizeInputTokensPerSecond: memory.normalizeInputTokensPerSecond,
  buildOpenCodeConfig: config.buildOpenCodeConfig,
  combineSystem: prompts.combineSystem,
  combineTurnPrompt: prompts.combineTurnPrompt,
  turnContextSystem: prompts.turnContextSystem,
  isSelectedSkillReadOnlyRequest: prompts.isSelectedSkillReadOnlyRequest,
  sessionPermissionForRun: config.sessionPermissionForRun,
  openCodeErrorDetail: errors.openCodeErrorDetail,
  memoryReviewerSystem: memory.memoryReviewerSystem,
  buildMemoryReviewInput: memory.buildMemoryReviewInput,
  MEMORY_REVIEW_SCHEMA: constants.MEMORY_REVIEW_SCHEMA,
  normalizeMemoryReview: memory.normalizeMemoryReview,
  stageDeepSeekProviderModule: providers.stageDeepSeekProviderModule,
  stageGlmmProviderModule: providers.stageGlmmProviderModule,
  stageResponsesProviderModule: providers.stageResponsesProviderModule,
  stageCodingEnvironmentModule: providers.stageCodingEnvironmentModule,
  stageGptlProviderModule: providers.stageGptlProviderModule,
  stageQwemProviderModule: providers.stageQwemProviderModule,
  stageKimlProviderModule: providers.stageKimlProviderModule,
  stageJiyuanProviderModule: providers.stageJiyuanProviderModule,
  stageAgnlProviderModule: providers.stageAgnlProviderModule,
  stageGemlProviderModule: providers.stageGemlProviderModule,
  stageGrolProviderModule: providers.stageGrolProviderModule,
  stageAntlProviderModule: providers.stageAntlProviderModule,
  permissionForRun: config.permissionForRun,
  permissionRulesForRun: config.permissionRulesForRun,
  memorySystem: prompts.memorySystem,
  workspaceSystem: prompts.workspaceSystem,
  repoMapSystem: prompts.repoMapSystem,
  continualHarnessSystem: prompts.continualHarnessSystem,
  contextAnchorSystem: prompts.contextAnchorSystem,
  effectiveInputTokensPerSecond: memory.effectiveInputTokensPerSecond,
  DEFAULT_PROVIDER_TIMEOUT_MS: constants.DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS: constants.DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS,
  authoritativePolicySystem: authoritativePolicySystem,
};
