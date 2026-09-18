'use strict';
// Behavioral checks for the vision-relay toggle ("启用视觉中继"):
//  - config default on; only an explicit false disables the relay
//  - when disabled, images bypass the relay and the kernel-side model
//    declaration must admit image input (the kernel otherwise replaces file
//    parts with "Cannot read … does not support" error text)
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { buildOpenCodeConfig, combineSystem } = require('../lib/opencode-sidecar');
const { resolveModelCapabilities } = require('../lib/model-capabilities');
const { migrateVisionRelaySwitch } = require('../lib/vision-relay-switch');

const mainSrc = fs.readFileSync('main.js', 'utf8');
const sidecarSrc = fs.readFileSync('lib/opencode-sidecar.js', 'utf8');

// --- relay guard order in relayImagesForTextModel ---------------------------
const guardMatch = mainSrc.match(/async function relayImagesForTextModel[\s\S]*?if \(selection\.capabilities\?\.imageInput \|\| !attachments\.length\) \{\s*return \{ prompt: String\(request\.prompt \|\| ''\), attachments: request\.attachments \|\| \[\], relay: null \};\s*\}/);
assert.ok(guardMatch, 'relayImagesForTextModel guard block shape changed');
assert.ok(guardMatch[0].includes('cfg.api?.visionRelayEnabled === false'), 'explicit relay-off must precede the capability check');
assert.ok(!guardMatch[0].includes('visionRelayDisabled'), 'old config key must be gone');

// Decision table (mirrors the guard):
function shouldRelay(cfg, selection, hasAttachments) {
  if (cfg.api?.visionRelayEnabled === false) return false;
  if (selection.capabilities?.imageInput || !hasAttachments) return false;
  return true;
}
assert.equal(shouldRelay({ api: { visionRelayEnabled: false } }, { capabilities: {} }, true), false, 'relay off -> never relay');
assert.equal(shouldRelay({ api: {} }, { capabilities: { imageInput: true } }, true), false, 'multimodal -> no relay');
assert.equal(shouldRelay({ api: {} }, { capabilities: {} }, true), true, 'text-only + relay on -> relay');
assert.equal(shouldRelay({ api: { visionRelayEnabled: true } }, { capabilities: { imageInput: false } }, true), true, 'explicit on behaves as default');

// --- screenshot relay guard -------------------------------------------------
assert.ok(mainSrc.includes("if (selection.capabilities?.imageInput || cfg.api?.visionRelayEnabled === false) return result;"), 'screenshot relay must honor the toggle');

// --- config default + normalize (default ON) --------------------------------
assert.ok(/visionRelayEnabled: true,/.test(mainSrc), 'config default missing');
assert.ok(/merged\.api\.visionRelayEnabled = merged\.api\.visionRelayEnabled !== false;/.test(mainSrc), 'config normalize missing');
assert.ok(/migrateVisionRelaySwitch\(merged\.api\)/.test(mainSrc), 'legacy relay key migration missing from loadConfig');
assert.match(
  mainSrc.match(/function getOpenCodeRuntimeConfig[\s\S]*?\n}/)?.[0] || '',
  /visionRelayEnabled: cfg\.api\?\.visionRelayEnabled !== false,/,
  'runtime config must forward the relay toggle to buildOpenCodeConfig'
);

// --- sidecar passes the toggle into the run and the kernel declaration ------
assert.ok(/const imageInputDeclared = !!\(capabilities\.imageInput \|\| capabilities\.vision\)\s*\|\| options\.visionRelayEnabled === false;/.test(sidecarSrc), 'sidecar declaration override missing');
assert.ok(sidecarSrc.includes('attachment: imageInputDeclared,'), 'kernel attachment flag must use the declared value');
assert.ok(sidecarSrc.includes("input: imageInputDeclared ? ['text', 'image'] : ['text'],"), 'kernel modalities must use the declared value');

const relayOffConfig = buildOpenCodeConfig({
  providerId: 'unknown-provider',
  modelId: 'unknown-multimodal-model',
  visionRelayEnabled: false
});
const relayOffModel = relayOffConfig.provider['unknown-provider'].models['unknown-multimodal-model'];
assert.equal(relayOffModel.attachment, true, 'relay off must admit image attachments even for an unknown model');
assert.deepEqual(relayOffModel.modalities.input, ['text', 'image']);

const glmCapabilities = resolveModelCapabilities('glm', { id: 'glm-5.3-flash' });
assert.equal(glmCapabilities.imageInput, true, 'glm-5.3-flash must be recognized as natively multimodal');

const deepseekFlashCapabilities = resolveModelCapabilities('deepseek', { id: 'deepseek-flash' });
assert.equal(deepseekFlashCapabilities.imageInput, true, 'deepseek-flash must be recognized as natively multimodal');

const relayOffSystem = combineSystem({
  visionRelayEnabled: false,
  availableMcpServers: [{ id: 'yan_media', name: 'Yan Media' }]
});
assert.equal(relayOffSystem.includes('yan_media_read_image'), false, 'relay-off system prompt must not advertise read_image');

// --- legacy relay key migration ---------------------------------------------
// The old build wrote `visionRelayDisabled` (true = off); upgrading must keep
// the user's off choice instead of silently re-enabling the relay.
const migrated = { visionRelayEnabled: true, visionRelayDisabled: true };
assert.equal(migrateVisionRelaySwitch(migrated), true, 'old key must be detected');
assert.equal(migrated.visionRelayEnabled, false, 'old off state must survive the rename');
assert.ok(!('visionRelayDisabled' in migrated), 'stale key must be dropped');
assert.equal(migrateVisionRelaySwitch({ visionRelayEnabled: false }), false, 'already-migrated configs must stay untouched');
const alreadyOn = { visionRelayEnabled: true, visionRelayDisabled: false };
assert.equal(migrateVisionRelaySwitch(alreadyOn), true);
assert.equal(alreadyOn.visionRelayEnabled, true, 'old key without an off request must not force the relay off');

// --- renderer attachment chip honors the switch ------------------------------
const rendererSrc = fs.readFileSync('renderer/renderer.js', 'utf8');
assert.ok(rendererSrc.includes('state.config?.api?.visionRelayEnabled === false'), 'attachment chip must honor the relay switch');
assert.ok(rendererSrc.includes('const relay = image && !imageInputEnabled && !relayDisabled;'), 'relay chip badge must be suppressed when the relay is off');

// --- every kernel start goes through the full runtime config -----------------
const awaitSidecarStarts = mainSrc.match(/await ensureOpenCodeSidecar\(/g) || [];
const fullConfigStarts = mainSrc.match(/await ensureOpenCodeSidecar\(getOpenCodeRuntimeConfig\(/g) || [];
assert.ok(awaitSidecarStarts.length > 0 && fullConfigStarts.length === awaitSidecarStarts.length, 'every sidecar start must pass the full runtime config (relay switch included)');

assert.ok(/id="visionRelayEnabledCheck"/.test(fs.readFileSync('renderer/index.html', 'utf8')), 'settings HTML toggle id mismatch');
assert.ok(/\$\('#visionRelayEnabledCheck'\)/.test(fs.readFileSync('renderer/renderer.js', 'utf8')), 'settings renderer toggle id mismatch');

console.log('vision relay toggle checks: all pass');
