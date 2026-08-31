'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const providers = Object.freeze([
  ['conn-packaged-test', 'Custom Connection'],
  ['openai', 'OpenAI'],
  ['grok', 'Grok'],
  ['agnes', 'Agnes'],
  ['deepseek', 'DeepSeek'],
  ['qwen', 'Qwen'],
  ['glm', 'GLM'],
  ['doubao', 'Doubao'],
  ['moonshot', 'Moonshot'],
  ['stepfun', 'StepFun'],
  ['minimax', 'MiniMax'],
  ['baichuan', 'Baichuan'],
  ['yi', 'Yi'],
  ['hunyuan', 'Hunyuan'],
  ['siliconflow', 'SiliconFlow']
]);
const executable = path.resolve(process.env.YAN_OPENCODE_EXECUTABLE || path.join(
  appRoot,
  'dist',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
  'node_modules',
  `opencode-windows-${process.arch}`,
  'bin',
  process.platform === 'win32' ? 'opencode.exe' : 'opencode'
));
const providerModule = path.resolve(process.env.YAN_PROVIDER_MODULE_PATH || path.join(
  appRoot,
  'dist',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
  'lib',
  'opencode-dsml-provider.mjs'
));
const packagedAppRoot = path.resolve(process.env.YAN_PACKAGED_APP_ROOT || path.join(
  appRoot,
  'dist',
  'win-unpacked',
  'resources',
  'app.asar'
));
const packagedNodeModules = path.resolve(path.dirname(providerModule), '..', 'node_modules');
const providerDependencies = Object.freeze([
  '@ai-sdk/openai-compatible',
  '@ai-sdk/provider',
  '@ai-sdk/provider-utils',
  '@standard-schema/spec',
  'eventsource-parser',
  'json-schema',
  'zod'
]);

for (const dependency of providerDependencies) {
  const manifest = path.join(packagedNodeModules, ...dependency.split('/'), 'package.json');
  assert.equal(fs.existsSync(manifest), true, `Packaged provider dependency is missing: ${dependency} (${manifest})`);
}

const results = [];
for (const [providerId, providerName] of providers) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'provider-runtime.e2e.cjs')], {
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_OPENCODE_EXECUTABLE: executable,
      YAN_PROVIDER_MODULE_PATH: providerModule,
      YAN_PACKAGED_APP_ROOT: packagedAppRoot,
      YAN_TEST_PROVIDER_ID: providerId,
      YAN_TEST_PROVIDER_NAME: providerName
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 90_000
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  assert.equal(result.status, 0, `${providerName} provider failed:\n${output}`);
  results.push({ providerId, providerName, ok: true });
}

console.log(JSON.stringify({
  ok: true,
  executable,
  providerModule,
  packagedAppRoot,
  providers: results
}, null, 2));
