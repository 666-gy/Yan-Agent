'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const {
  buildOpenCodeConfig,
  stageDeepSeekProviderModule,
  stageGlmmProviderModule,
  stageQwemProviderModule
} = require('../lib/opencode-sidecar');
const { stageOpenCodeRuntime } = require('../lib/opencode-runtime');

const appRoot = path.resolve(__dirname, '..');
const executable = path.resolve(process.env.YAN_OPENCODE_EXECUTABLE || path.join(
  appRoot,
  'node_modules',
  `opencode-windows-${process.arch}`,
  'bin',
  process.platform === 'win32' ? 'opencode.exe' : 'opencode'
));
const providerModule = path.resolve(process.env.YAN_PROVIDER_MODULE_PATH || path.join(
  appRoot,
  'lib',
  'opencode-dsml-provider.mjs'
));
const responsesBundle = path.join(appRoot, 'lib', 'opencode-openai-responses-provider.bundle.mjs');
const providerId = String(process.env.YAN_TEST_PROVIDER_ID || 'deepseek').trim();
const providerName = String(process.env.YAN_TEST_PROVIDER_NAME || providerId).trim();
const modelId = `${providerId}-packaged-test`;

function runProcess(command, args, options, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Provider runtime test timed out. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function stageProviderPackage(runtimeRoot) {
  const packageName = '@yan-agent/deepseek-dsml-provider';
  const packageDir = path.join(runtimeRoot, 'config', 'opencode', 'node_modules', '@yan-agent', 'deepseek-dsml-provider');
  const sourceRoot = path.dirname(providerModule);
  const sourceNodeModules = path.resolve(sourceRoot, '..', 'node_modules');
  const targetNodeModules = path.join(runtimeRoot, 'config', 'opencode', 'node_modules');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.copyFileSync(providerModule, path.join(packageDir, 'index.mjs'));
  fs.copyFileSync(path.join(sourceRoot, 'dsml-tool-call.js'), path.join(packageDir, 'dsml-tool-call.js'));
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    type: 'module',
    exports: './index.mjs'
  }));
  for (const dependency of ['@ai-sdk', '@standard-schema', 'eventsource-parser', 'json-schema', 'zod']) {
    const source = path.join(sourceNodeModules, dependency);
    const target = path.join(targetNodeModules, dependency);
    if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true, force: true });
  }
  return packageName;
}

function stageProviderBundle(runtimeRoot) {
  const targetDir = path.join(runtimeRoot, 'provider');
  const target = path.join(targetDir, 'deepseek-dsml-provider.mjs');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(providerModule, target);
  return pathToFileURL(target).href;
}

(async () => {
  assert.equal(fs.existsSync(executable), true, `Missing OpenCode executable: ${executable}`);
  assert.equal(fs.existsSync(providerModule), true, `Missing provider module: ${providerModule}`);
  assert.equal(fs.existsSync(responsesBundle), true, `Missing responses module: ${responsesBundle}`);
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-provider-runtime-'));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body });
      if (request.url?.endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-packaged-test', object: 'model' }] }));
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      const created = Math.floor(Date.now() / 1000);
      response.write(`data: ${JSON.stringify({
        id: 'yan-provider-test',
        object: 'chat.completion.chunk',
        created,
        model: 'deepseek-packaged-test',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'PACKAGED_PROVIDER_OK' }, finish_reason: null }]
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: 'yan-provider-test',
        object: 'chat.completion.chunk',
        created,
        model: 'deepseek-packaged-test',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });

  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const providerModuleSpecifier = providerId === 'glm'
      ? stageGlmmProviderModule({ appRoot: process.env.YAN_PACKAGED_APP_ROOT || appRoot, dataDir: runtimeRoot })
      : providerId === 'qwen'
      ? stageQwemProviderModule({ appRoot: process.env.YAN_PACKAGED_APP_ROOT || appRoot, dataDir: runtimeRoot })
      : process.env.YAN_PACKAGED_APP_ROOT
      ? stageDeepSeekProviderModule({
          appRoot: process.env.YAN_PACKAGED_APP_ROOT,
          dataDir: runtimeRoot
        })
      : String(process.env.YAN_PROVIDER_MODULE_SPECIFIER || pathToFileURL(providerModule).href);
    const config = buildOpenCodeConfig({
      providerId,
      providerName,
      modelId,
      modelName: `${providerName} Packaged Test`,
      apiKey: 'local-test-key',
      baseUrl,
      deepSeekProviderModule: providerModuleSpecifier,
      glmmProviderModule: providerModuleSpecifier,
      qwemProviderModule: providerModuleSpecifier,
      capabilities: { reasoning: true, contextWindow: 32_768, maxOutputTokens: 8_192 },
      accessMode: 'full',
      permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true }
    });
    assert.equal(config.provider[providerId].npm, providerModuleSpecifier);
    const env = {
      ...process.env,
      XDG_DATA_HOME: path.join(runtimeRoot, 'data'),
      XDG_CONFIG_HOME: path.join(runtimeRoot, 'config'),
      XDG_CACHE_HOME: path.join(runtimeRoot, 'cache'),
      XDG_STATE_HOME: path.join(runtimeRoot, 'state'),
      OPENCODE_TEST_HOME: path.join(runtimeRoot, 'home'),
      OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config)
    };
    const runtimeExecutable = await stageOpenCodeRuntime({ executable, dataDir: runtimeRoot });
    const result = await runProcess(runtimeExecutable, [
      'run',
      '--model', `${providerId}/${modelId}`,
      '--print-logs',
      '--log-level', 'INFO',
      'Reply with the supplied test response.'
    ], {
      cwd: runtimeRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.code, 0, combined);
    assert.equal(combined.includes('PACKAGED_PROVIDER_OK'), true, combined);
    assert.equal(combined.includes('Failed to initialize provider'), false, combined);
    assert.ok(requests.length >= 1, combined);
    assert.ok(requests.some(request => {
      const tools = JSON.parse(request.body || '{}').tools || [];
      return ['write', 'edit', 'apply_patch'].every(name => tools.some(tool => tool.function?.name === name));
    }), 'The packaged runtime must expose all three native file tools to the provider');

    // Responses channel: the kernel must load the responses provider factory
    // and route the model call to POST {baseURL}/responses instead of
    // /chat/completions. The mock body is intentionally a chat-shaped stream,
    // so this scenario asserts routing and factory loading, not parsing.
    const responsesRuntimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-responses-runtime-'));
    try {
      const responsesModuleUrl = String(
        process.env.YAN_RESPONSES_PROVIDER_MODULE_SPECIFIER || pathToFileURL(responsesBundle).href
      );
      const responsesConfig = buildOpenCodeConfig({
        providerId: 'conn-responses-test',
        providerName: 'Responses Packaged Test',
        modelId: 'responses-packaged-test',
        modelName: 'Responses Packaged Test',
        apiKey: 'local-test-key',
        baseUrl,
        apiFormat: 'responses',
        responsesProviderModule: responsesModuleUrl,
        capabilities: { reasoning: true, contextWindow: 32_768, maxOutputTokens: 8_192 },
        accessMode: 'full',
        permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true }
      });
      assert.equal(responsesConfig.provider['conn-responses-test'].npm, responsesModuleUrl);
      const responsesEnv = {
        ...env,
        XDG_DATA_HOME: path.join(responsesRuntimeRoot, 'data'),
        XDG_CONFIG_HOME: path.join(responsesRuntimeRoot, 'config'),
        XDG_CACHE_HOME: path.join(responsesRuntimeRoot, 'cache'),
        XDG_STATE_HOME: path.join(responsesRuntimeRoot, 'state'),
        OPENCODE_TEST_HOME: path.join(responsesRuntimeRoot, 'home'),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(responsesConfig)
      };
      const before = requests.length;
      const responsesExecutable = await stageOpenCodeRuntime({ executable, dataDir: responsesRuntimeRoot });
      await runProcess(responsesExecutable, [
        'run',
        '--model', 'conn-responses-test/responses-packaged-test',
        '--print-logs',
        '--log-level', 'INFO',
        'Reply with the supplied test response.'
      ], {
        cwd: responsesRuntimeRoot,
        env: responsesEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const responsesRequests = requests.slice(before);
      assert.ok(
        responsesRequests.some(request => String(request.url).endsWith('/responses')),
        `The responses provider must call /responses. Requests: ${JSON.stringify(responsesRequests)}`
      );
      assert.equal(
        responsesRequests.some(request => String(request.url).includes('/chat/completions')),
        false,
        `The responses provider must not fall back to /chat/completions. Requests: ${JSON.stringify(responsesRequests)}`
      );
    } finally {
      fs.rmSync(responsesRuntimeRoot, { recursive: true, force: true });
    }

    console.log(JSON.stringify({
      ok: true,
      providerModule,
      providerModuleSpecifier,
      runtimeExecutable,
      requestCount: requests.length,
      requestedUrls: requests.map(item => item.url)
    }));
  } finally {
    server.close();
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
