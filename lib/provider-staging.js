'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

function childReadablePath(value) {
  const resolved = path.resolve(String(value || ''));
  const asarRoot = `${path.sep}app.asar`;
  const normalized = resolved.toLowerCase();
  const normalizedAsarRoot = asarRoot.toLowerCase();
  if (normalized.endsWith(normalizedAsarRoot)) return `${resolved}.unpacked`;

  const marker = `${normalizedAsarRoot}${path.sep}`;
  const markerIndex = normalized.indexOf(marker);
  return markerIndex >= 0
    ? `${resolved.slice(0, markerIndex + asarRoot.length)}.unpacked${resolved.slice(markerIndex + asarRoot.length)}`
    : resolved;
}

function stageProviderModule({ appRoot, dataDir, sourceFile, stagedFile, temporaryPrefix }) {
  const readableRoot = childReadablePath(path.resolve(String(appRoot || '')));
  const source = path.join(readableRoot, 'lib', sourceFile);
  if (!fs.existsSync(source)) throw new Error(`Provider module is missing: ${source}`);
  const content = fs.readFileSync(source);
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const version = contentHash.slice(0, 16);
  const targetDir = path.join(path.resolve(String(dataDir || '')), 'opencode-runtime', 'providers', version);
  const target = path.join(targetDir, stagedFile);
  fs.mkdirSync(targetDir, { recursive: true });
  let targetHash = '';
  if (fs.existsSync(target)) {
    targetHash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  }
  if (targetHash !== contentHash) {
    const temporary = path.join(targetDir, `${temporaryPrefix}-${process.pid}-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, content, { flag: 'wx' });
      try {
        fs.renameSync(temporary, target);
      } catch (error) {
        const concurrentHash = fs.existsSync(target)
          ? crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
          : '';
        if (concurrentHash !== contentHash) {
          fs.rmSync(target, { force: true });
          fs.renameSync(temporary, target);
        }
      }
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch {}
    }
  }
  return pathToFileURL(target).href;
}

function stageDeepSeekProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({
    appRoot,
    dataDir,
    sourceFile: 'opencode-dsml-provider.bundle.mjs',
    stagedFile: 'deepseek-dsml-provider.mjs',
    temporaryPrefix: '.deepseek-dsml-provider'
  });
}

function stageGlmmProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({
    appRoot,
    dataDir,
    sourceFile: 'opencode-glmm-provider.bundle.mjs',
    stagedFile: 'glm-glmm-provider.mjs',
    temporaryPrefix: '.glm-glmm-provider'
  });
}

function stageResponsesProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({
    appRoot,
    dataDir,
    sourceFile: 'opencode-openai-responses-provider.bundle.mjs',
    stagedFile: 'openai-responses-provider.mjs',
    temporaryPrefix: '.openai-responses-provider'
  });
}

function stageCodingEnvironmentModule({ appRoot, dataDir }) {
  return stageProviderModule({ appRoot, dataDir, sourceFile: 'coding-environment-plugin.bundle.mjs',
    stagedFile: 'coding-environment-plugin.mjs', temporaryPrefix: '.coding-environment' });
}

// GPTL — the capability-driven GPT adapter. One module serves both wire
// formats and picks Chat Completions or Responses per request, so a future
// GPT model id needs no new provider file.
function stageGptlProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({
    appRoot,
    dataDir,
    sourceFile: 'opencode-gptl-provider.bundle.mjs',
    stagedFile: 'gptl-provider.mjs',
    temporaryPrefix: '.gptl-provider'
  });
}

// QWEM / KIML — Qwen and Kimi family presets. Chat Completions wire with the
// known family contracts applied at the fetch layer. Unknown model versions
// keep their parameters until their capabilities have been verified.
function stageQwemProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({
    appRoot,
    dataDir,
    sourceFile: 'opencode-qwem-provider.bundle.mjs',
    stagedFile: 'qwem-provider.mjs',
    temporaryPrefix: '.qwem-provider'
  });
}

function stageKimlProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({
    appRoot,
    dataDir,
    sourceFile: 'opencode-kiml-provider.bundle.mjs',
    stagedFile: 'kiml-provider.mjs',
    temporaryPrefix: '.kiml-provider'
  });
}

function stageAgnlProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({ appRoot, dataDir, sourceFile: 'opencode-agnl-provider.bundle.mjs',
    stagedFile: 'agnl-provider.mjs', temporaryPrefix: '.agnl-provider' });
}

function stageGemlProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({ appRoot, dataDir, sourceFile: 'opencode-geml-provider.bundle.mjs',
    stagedFile: 'geml-provider.mjs', temporaryPrefix: '.geml-provider' });
}

function stageGrolProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({ appRoot, dataDir, sourceFile: 'opencode-grol-provider.bundle.mjs',
    stagedFile: 'grol-provider.mjs', temporaryPrefix: '.grol-provider' });
}

// ANTL — the Anthropic Messages native preset. Unlike the Chat Completions
// adapters it does not translate protocols: @ai-sdk/anthropic already speaks
// Messages, so the staged module only places cache breakpoints and stabilizes
// tool ordering on the outbound body.
function stageAntlProviderModule({ appRoot, dataDir }) {
  return stageProviderModule({ appRoot, dataDir, sourceFile: 'opencode-antl-provider.bundle.mjs',
    stagedFile: 'antl-provider.mjs', temporaryPrefix: '.antl-provider' });
}

module.exports = { childReadablePath, stageDeepSeekProviderModule, stageGlmmProviderModule, stageResponsesProviderModule, stageCodingEnvironmentModule, stageGptlProviderModule, stageQwemProviderModule, stageKimlProviderModule, stageAgnlProviderModule, stageGemlProviderModule, stageGrolProviderModule, stageAntlProviderModule };
