// main.js hands each register* module a hand-written forwarding object, because
// the runtime configs are built further down the file. A method the module calls
// but the forwarder omits is only found when a user hits that code path --
// 2026-09-30: `mcpRuntimeConfig.unmetSkillRequirements is not a function` the
// moment a Skill with an MCP requirement was selected. This checks the wiring
// statically instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');

// The forwarding objects main.js writes for the modules that read them, and the
// module whose call sites define what must be forwarded. `after` is the call
// the literal is passed to, since a property name can appear more than once.
const FORWARDERS = [
  { src: 'main.js', after: 'registerSkillsRuntime(', property: 'mcpRuntimeConfig', module: 'lib/main/skills-runtime.js' },
  { src: 'main.js', after: 'createModelState(', property: 'configStore', module: 'lib/main/model-state.js' },
  { src: 'main.js', after: 'registerBridges(', property: 'sessionStore', module: 'lib/main/bridges.js' },
  { src: 'main.js', after: 'registerBridges(', property: 'configStore', module: 'lib/main/bridges.js' },
  { src: 'main.js', after: 'registerBridges(', property: 'modelState', module: 'lib/main/bridges.js' },
  { src: 'main.js', after: 'registerBridges(', property: 'visionRelay', module: 'lib/main/bridges.js' }
];

// Comments and strings can mention a method the code does not call; only count
// real `config.method(` call sites in the module.
function calledMethods(source, property) {
  const pattern = new RegExp(`\\b${property}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
  return [...new Set([...source.matchAll(pattern)].map(match => match[1]))];
}

// Reads the keys of the `{ a: ..., b: ... }` literal main.js passes for
// `property` in the first call to `after`. Braces are matched so one-line and
// multi-line literals both work.
function forwardedMethods(source, after, property) {
  const callAt = source.indexOf(after);
  if (callAt < 0) return new Set();
  const keyAt = source.slice(callAt).search(new RegExp(`\\n\\s*${property}:\\s*\\{`));
  if (keyAt < 0) return new Set();
  const open = source.indexOf('{', callAt + keyAt);
  let depth = 0;
  let close = open;
  for (; close < source.length; close += 1) {
    if (source[close] === '{') depth += 1;
    else if (source[close] === '}' && --depth === 0) break;
  }
  const body = source.slice(open, close + 1);
  return new Set([...body.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)].map(match => match[1]));
}

for (const { src, after, property, module } of FORWARDERS) {
  test(`main.js forwards every ${property} method that ${module} calls`, () => {
    const moduleSource = fs.readFileSync(path.join(appRoot, module), 'utf8');
    const needed = calledMethods(moduleSource, property);
    assert.ok(needed.length > 0, `${module} calls no ${property} method -- the scan is broken`);

    const forwarded = forwardedMethods(fs.readFileSync(path.join(appRoot, src), 'utf8'), after, property);
    const missing = needed.filter(method => !forwarded.has(method));
    assert.deepEqual(missing, [], `main.js must forward these ${property} methods: ${missing.join(', ')}`);
  });
}

test('every forwarded method exists on the real runtime config', () => {
  const { createMcpRuntimeConfig } = require('../lib/main/mcp-runtime-config');
  // Construction only records its dependencies; nothing is called, so empty
  // stubs are enough to enumerate the methods.
  const stubs = new Proxy({}, { get: () => () => {} });
  const config = createMcpRuntimeConfig({
    mcpServerBuilders: stubs, mcpDefaults: stubs, configStore: stubs, modelState: stubs,
    providerConfig: stubs, workspaceSandbox: stubs, skillsRuntime: stubs, appRoot
  });
  const forwarded = forwardedMethods(fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8'), 'registerSkillsRuntime(', 'mcpRuntimeConfig');
  assert.ok(forwarded.has('unmetSkillRequirements'), 'the forwarder scan found nothing');
  const absent = [...forwarded].filter(method => typeof config[method] !== 'function');
  assert.deepEqual(absent, [], `forwarded but not a function on the runtime config: ${absent.join(', ')}`);
});
