'use strict';

// Explicit opt-in: sends only a synthetic prompt to one configured connection.
// Never logs keys, headers, conversation history, or response content.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

// Windows safeStorage uses the profile's DPAPI-protected key. A windowless
// Electron child can decrypt it with the same OS user without touching the
// running Yan profile or putting a plaintext credential on disk/in argv.
async function runWithSafeStorage() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-stream-benchmark-'));
  try {
    const localState = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'yan-agent', 'Local State'), 'utf8'));
    fs.writeFileSync(path.join(profile, 'Local State'), JSON.stringify({ os_crypt: localState.os_crypt }));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [__filename, ...process.argv.slice(2), `--benchmark-profile=${profile}`], {
      env, windowsHide: true, stdio: 'inherit'
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    const relative = path.relative(os.tmpdir(), profile);
    if (relative.startsWith('yan-stream-benchmark-') && !relative.includes(path.sep)) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

async function measure(fetchImpl, url, body, apiKey, label) {
  const started = performance.now();
  const response = await fetchImpl(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000)
  });
  const result = { label, httpStatus: response.status, headersMs: performance.now() - started,
    firstTextMs: null, lastTextMs: null, doneMs: null, totalMs: null, textChars: 0, textEvents: 0,
    outputTokens: null, reasoningTokens: null, cachedTokens: null };
  if (!response.ok) { await response.body?.cancel(); return result; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  function event(block) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    const now = performance.now() - started;
    if (data === '[DONE]') { result.doneMs = now; return; }
    let value; try { value = JSON.parse(data); } catch { return; }
    const delta = value.type === 'response.output_text.delta' ? value.delta : value.choices?.map(choice => choice.delta?.content || '').join('');
    if (delta) {
      result.firstTextMs ??= now;
      result.lastTextMs = now;
      result.textChars += delta.length;
      result.textEvents++;
    }
    const usage = value.usage || value.response?.usage;
    if (usage) {
      result.outputTokens = usage.completion_tokens ?? usage.output_tokens ?? null;
      result.reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? null;
      result.cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? null;
    }
    if (value.type === 'response.completed') result.doneMs = now;
  }
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    pending += decoder.decode(next.value, { stream: true });
    let separator;
    while ((separator = /\r?\n\r?\n/.exec(pending))) {
      event(pending.slice(0, separator.index));
      pending = pending.slice(separator.index + separator[0].length);
    }
  }
  pending += decoder.decode();
  if (pending.trim()) event(pending);
  result.totalMs = performance.now() - started;
  const streamSeconds = (result.lastTextMs - result.firstTextMs) / 1000;
  result.charsPerSecond = streamSeconds > 0 ? result.textChars / streamSeconds : null;
  result.visibleTokensPerSecond = streamSeconds > 0 && result.outputTokens != null
    ? (result.outputTokens - (result.reasoningTokens || 0)) / streamSeconds : null;
  return result;
}

(async () => {
  if (!process.argv.includes('--live')) throw new Error('Use --live --connection=<id> --model=<id> to benchmark a configured endpoint.');
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const connectionId = option('connection');
  const model = option('model');
  if (!connectionId || !model) throw new Error('connection and model must be explicit');
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'yan-agent', 'YanData', 'config.json'), 'utf8'));
  const provider = config.api?.providerConfigs?.[connectionId];
  if (!provider?.baseUrl || !provider?.apiKey) throw new Error('Configured connection requires a base URL and API key');
  let apiKey = provider.apiKey;
  if (apiKey.startsWith('enc:v1:')) {
    if (!process.versions.electron) return runWithSafeStorage();
    const { app, safeStorage } = require('electron');
    const profile = option('benchmark-profile');
    if (!profile) throw new Error('Encrypted credentials require an isolated benchmark profile');
    app.setPath('userData', profile);
    app.disableHardwareAcceleration();
    await app.whenReady();
    apiKey = safeStorage.decryptString(Buffer.from(apiKey.slice('enc:v1:'.length), 'base64'));
  }
  const root = provider.baseUrl.replace(/\/+$/, '');
  const baseUrl = /\/v\d+(?:beta\d*)?$/.test(root) ? root : `${root}/v1`;
  const prompt = 'Output exactly 60 lines. Each line is "stream test line NN", numbered 01 through 60. No introduction, explanation, markdown, or conclusion.';
  const chat = { model, messages: [{ role: 'user', content: prompt }], stream: true,
    reasoning_effort: 'low', max_completion_tokens: 1200, stream_options: { include_usage: true } };
  const { createYanProviderFetch } = await import('../lib/opencode-dsml-provider.mjs');
  const results = [];
  const runs = [
    ['chat-direct', fetch, `${baseUrl}/chat/completions`, chat],
    ['chat-yan-adapter', createYanProviderFetch(fetch), `${baseUrl}/chat/completions`, chat],
    ['responses-direct', fetch, `${baseUrl}/responses`, {
      model, input: prompt, stream: true, store: false, reasoning: { effort: 'low' }, max_output_tokens: 1200
    }]
  ];
  for (const [label, fetchImpl, url, body] of runs) {
    try { results.push(await measure(fetchImpl, url, body, apiKey, label)); }
    catch (error) { results.push({ label, error: error.name || 'Error' }); }
    console.log(JSON.stringify(results.at(-1)));
  }
  const output = path.resolve('output', 'diagnostics', 'gpt-stream-live.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ model, origin: new URL(baseUrl).origin, measuredAt: new Date().toISOString(), results }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  if (process.versions.electron) require('electron').app.exit(process.exitCode || 0);
});
