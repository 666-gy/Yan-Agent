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
assert.ok(!mainSrc.includes('visionRelayDisabled'), 'stale config key must be fully removed');
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

const relayOffSystem = combineSystem({
  visionRelayEnabled: false,
  availableMcpServers: [{ id: 'yan_media', name: 'Yan Media' }]
});
assert.equal(relayOffSystem.includes('yan_media_read_image'), false, 'relay-off system prompt must not advertise read_image');

assert.ok(/id="visionRelayEnabledCheck"/.test(fs.readFileSync('renderer/index.html', 'utf8')), 'settings HTML toggle id mismatch');
assert.ok(/\$\('#visionRelayEnabledCheck'\)/.test(fs.readFileSync('renderer/renderer.js', 'utf8')), 'settings renderer toggle id mismatch');

console.log('vision relay toggle checks: all pass');
