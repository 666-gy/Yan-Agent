'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalize, SOURCES } = require('./voice-preferences');
const { createSubprocessAdapter } = require('./voice-subprocess');
const { OnlineRecognizer } = require('sherpa-onnx-node');
const { MODEL_BYTES: STREAMING_MODEL_BYTES, modelDirectory, inspectStreamingModels, prepareStreamingModels } = require('./voice-streaming-models');
const MAX_DURATION_SECONDS = 120;
const MAX_AUDIO_BYTES = 44 + MAX_DURATION_SECONDS * 32000;
// Pinned sizes from the streaming zipformer release (encoder, decoder,
// joiner and tokens). This is also the value shown beside the install button.

function createVoiceInput({ dataDir, appRoot, loadConfig, saveConfig, onChanged = () => {}, providerFactory, subprocess } = {}) {
  const processes = subprocess || createSubprocessAdapter();
  let worker, off, generation = 0, closing = false, installed = false, inspected = false;
  let streamRecognizer, streamLoading, streamAbort, streamingReady = false;
  let streamFailAt = 0;
  let streamPreparation;
  let streamingTaskActive = false;
  let streamingProgress = {};
  const streams = new Map();
  let prefs = normalize(), preferencesLoaded = false;
  let preparation = { phase: 'unprepared', steps: [] };
  let mutations = Promise.resolve();
  const calls = new Map();
  const usable = () => ['ready', 'standby', 'waking'].includes(preparation.phase);
  let streamingPhase = 'idle', streamingError = '';
  const snapshot = () => ({ preferences: { ...prefs }, preparation,
    supported: process.platform === 'win32' && process.arch === 'x64',
    // Production recording is only exposed after both the official DSH worker and
    // the zipformer streaming recognizer are available. Test providers do not
    // have the native streaming model and keep the historical readiness rule.
    ready: prefs.enabled && !!worker && usable() && (!!providerFactory || streamingReady), installed,
    modelBytes: STREAMING_MODEL_BYTES, maxDurationSeconds: MAX_DURATION_SECONDS, maxAudioBytes: MAX_AUDIO_BYTES, streaming: true, streamingReady, streamingPhase, streamingError });
  const publish = () => { if (!closing) onChanged(snapshot()); };
  const serialize = operation => {
    const result = mutations.then(() => {
      // Config migration needs main runtimes initialized after service registration.
      if (!preferencesLoaded && !closing) {
        prefs = normalize(loadConfig().voice);
        preferencesLoaded = true;
      }
      return operation();
    });
    mutations = result.catch(() => {});
    return result;
  };
  async function activate() {
    if (worker || !prefs.enabled || closing) return;
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前语音识别支持 Windows x64');
    const run = ++generation;
    const config = { dataRoot: path.join(dataDir, 'voice'), precision: 'int8',
      modelOrigins: ['https://huggingface.co', 'https://hf-mirror.com'], modelProbeTimeoutMs: 3000,
      threads: 2, segmentSeconds: 30, vadThreshold: 0.5, minSpeechSeconds: 0.25, minSilenceSeconds: 0.5,
      maxAudioBytes: MAX_AUDIO_BYTES, prepareTimeoutMs: 3600000, inferenceTimeoutMs: 120000,
      idleTimeoutMs: 300000, maxPending: 2, graceMs: 1000, maxLogBytes: 65536, maxResponseBytes: 131072, progressIntervalMs: 150 };
    const ctx = { subprocess: processes, logger: { warn: (...args) => console.warn('[voice]', ...args) } };
    if (providerFactory) worker = await providerFactory(ctx, config);
    else {
      const { SenseVoiceWorker } = await import(pathToFileURL(path.join(appRoot, 'lib/vendor/dsh-voice/lib/provider.mjs')).href);
      worker = new SenseVoiceWorker(ctx, config);
    }
    off = worker.subscribe(() => {
      if (run !== generation || closing) return;
      const workerState = worker.snapshot();
      preparation = streamingTaskActive
        ? { ...workerState, phase: 'downloading', step: 'streaming', ...streamingProgress }
        : workerState;
      if (usable()) installed = true;
      if (preparation.phase === 'unprepared') installed = false;
      publish();
    });
    worker.inspect();
  }
  async function ensureStreamingRecognizer(signal) {
    if (streamRecognizer) return streamRecognizer;
    if (streamLoading) return streamLoading;
    if (Date.now() < streamFailAt) throw new Error('流式模型下载正在退避，请稍后重试');
    const dir = modelDirectory(dataDir);
    const cached = streamingReady;
    streamingPhase = cached ? 'loading' : 'downloading'; streamingError = ''; publish();
    streamLoading = (async () => {
      if (!cached) {
        await prepareStreamingModels(dataDir, prefs.downloadSource, signal, state => {
          streamingProgress = { resource: state.resource, completedBytes: state.completedBytes, totalBytes: state.totalBytes };
          const phase = state.completedBytes >= state.totalBytes ? 'checking' : 'downloading';
          preparation = { ...preparation, phase, resource: state.resource, completedBytes: state.completedBytes, totalBytes: state.totalBytes };
          publish();
        });
      }
      signal?.throwIfAborted();
      const p = file => path.join(dir, file);
      streamRecognizer = new OnlineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: { transducer: { encoder: p('encoder.int8.onnx'), decoder: p('decoder.onnx'), joiner: p('joiner.int8.onnx') }, tokens: p('tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 },
        enableEndpoint: 1, rule1MinTrailingSilence: 0.5, rule2MinTrailingSilence: 1.0, rule3MinUtteranceLength: 20,
      });
      streamingPhase = 'ready'; streamingError = ''; streamingProgress = {};
      return streamRecognizer;
    })().finally(() => { streamLoading = undefined; });
    return streamLoading.catch(error => { streamFailAt = Date.now() + 2000; streamingReady = false; streamingPhase = 'failed'; streamingError = error instanceof Error ? error.message : String(error); publish(); throw error; });
  }
  async function streamingInstalled() {
    return inspectStreamingModels(dataDir, new AbortController().signal);
  }
  async function deactivate() {
    ++generation;
    streamAbort?.abort(new Error('语音服务已停用')); streamAbort = undefined;
    for (const call of calls.values()) call.abort();
    off?.(); off = undefined;
    const old = worker; worker = undefined;
    await old?.dispose();
    preparation = { phase: installed ? 'standby' : 'unprepared', steps: [] };
  }
  async function status() {
    await serialize(async () => {
      if (!inspected && !prefs.enabled && !providerFactory && process.platform === 'win32' && process.arch === 'x64') {
        const { inspectRuntime } = await import(pathToFileURL(path.join(appRoot, 'lib/vendor/dsh-voice/lib/provider.mjs')).href);
        installed = !!await inspectRuntime({ dataRoot: path.join(dataDir, 'voice'), precision: 'int8' }, AbortSignal.timeout(60000));
        preparation = { phase: installed ? 'standby' : 'unprepared', steps: [] };
      }
      inspected = true;
      await activate();
      if (!providerFactory) {
        streamingReady = await streamingInstalled();
        if (streamingReady) streamingPhase = 'ready';
        if (installed && streamingReady && !prefs.enabled) {
          prefs = { ...prefs, enabled: true };
          const cfg = loadConfig(); cfg.voice = { ...prefs }; saveConfig(cfg);
          await activate();
        }
      }
    });
    return snapshot();
  }
  function configure(patch = {}) {
    return serialize(async () => {
      if (closing) throw new Error('语音服务已关闭');
      const next = normalize({ ...prefs, ...patch });
      if (!next.enabled) await deactivate();
      const cfg = loadConfig(); cfg.voice = next; saveConfig(cfg); prefs = next;
      await activate();
      if (worker && !providerFactory && patch.enabled === true) {
        const deadline = Date.now() + 2000;
        while (worker.snapshot().phase === 'checking' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (worker && !providerFactory) {
        const currentState = worker.snapshot();
        preparation = currentState;
        if (['ready', 'standby', 'waking'].includes(currentState.phase)) installed = true;
        if (patch.enabled === true) {
          streamingReady = await streamingInstalled();
          streamingPhase = streamingReady ? 'ready' : 'idle';
        }
      }
      publish(); return snapshot();
    });
  }
  function prepare() {
    return serialize(async () => {
      if (!prefs.enabled) {
        prefs = { ...prefs, enabled: true };
        const cfg = loadConfig(); cfg.voice = { ...prefs }; saveConfig(cfg);
      }
      await activate();
      if (!worker || !prefs.enabled) throw new Error('请先启用语音输入');
      const downloadSource = SOURCES[prefs.downloadSource];
      if (!providerFactory) {
        streamingPhase = 'downloading'; streamingError = ''; streamingProgress = {}; streamingTaskActive = true;
      }
      worker.prepare(downloadSource ? { downloadSource } : {});
      if (!providerFactory) {
        streamAbort?.abort();
        streamAbort = new AbortController();
        streamPreparation = ensureStreamingRecognizer(streamAbort.signal).then(() => {
          streamingReady = true; streamingTaskActive = false; preparation = worker?.snapshot?.() || preparation; publish();
        }).catch(error => {
          streamingReady = false; streamingTaskActive = false; preparation = worker?.snapshot?.() || preparation; publish(); throw error;
        });
        void streamPreparation.catch(() => undefined).finally(() => { streamAbort = undefined; });
      }
      return snapshot();
    });
  }
  async function cancelPreparation() {
    await serialize(async () => {
      streamAbort?.abort(new Error('流式模型下载已取消'));
      await worker?.cancel();
      try { await streamPreparation; } catch {}
      streamPreparation = undefined;
      streamingTaskActive = false; streamingProgress = {};
      if (!streamRecognizer) { streamingReady = false; streamingPhase = 'idle'; streamingError = ''; publish(); }
    });
    return snapshot();
  }
  function removeModels() {
    return serialize(async () => {
      await deactivate();
      await require('node:fs/promises').rm(path.join(dataDir, 'voice', 'models'), { recursive: true, force: true });
      await require('node:fs/promises').rm(path.join(dataDir, 'voice', 'streaming'), { recursive: true, force: true });
      try { streamRecognizer?.free?.(); } catch {}
      streamRecognizer = undefined;
      streamAbort?.abort(new Error('流式模型下载已取消')); streamAbort = undefined;
      streamPreparation = undefined; streamingReady = false; streamingPhase = 'idle'; streamingError = '';
      installed = false; preparation = { phase: 'unprepared', steps: [] };
      await activate(); publish(); return snapshot();
    });
  }
  async function transcribe({ requestId, audio } = {}) {
    if (!prefs.enabled || !worker || !usable()) throw new Error('请先安装并准备语音模型');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(requestId) || calls.has(requestId)) throw new Error('无效或重复的录音请求');
    if (!(audio instanceof Uint8Array) || audio.byteLength < 46 || audio.byteLength > MAX_AUDIO_BYTES) throw new Error('录音格式或长度无效');
    const abort = new AbortController(); calls.set(requestId, abort);
    const recognizer = worker, language = prefs.language;
    try {
      const { validateWave } = await import(pathToFileURL(path.join(appRoot, 'lib/vendor/dsh-voice/lib/provider.mjs')).href);
      abort.signal.throwIfAborted();
      validateWave(audio, MAX_DURATION_SECONDS);
      return await recognizer.transcribe({ audio, language }, abort.signal);
    }
    finally { calls.delete(requestId); }
  }
  async function streamStart({ requestId } = {}) {
    if (!prefs.enabled || !worker || !usable()) throw new Error('请先安装并准备语音模型');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(requestId) || calls.has(requestId)) throw new Error('无效或重复的录音请求');
    const abort = new AbortController(); calls.set(requestId, abort);
    try {
      if (providerFactory) throw new Error('测试 provider 不支持流式识别');
      const recognizer = await ensureStreamingRecognizer(abort.signal);
      const stream = recognizer.createStream();
      streams.set(requestId, { recognizer, stream, samples: [] });
      return { ok: true };
    } catch (error) { calls.delete(requestId); throw error; }
  }
  async function streamChunk({ requestId, pcm, final = false } = {}) {
    const abort = calls.get(requestId);
    if (!abort || !worker) throw new Error('流式录音会话不存在');
    if (!(pcm instanceof Uint8Array) || pcm.byteLength % 4 !== 0 || pcm.byteLength > 256000) throw new Error('流式音频数据无效');
    const session = streams.get(requestId); if (!session) throw new Error('流式录音会话不存在');
    const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
    if (samples.length) { session.stream.acceptWaveform({ samples, sampleRate: 16000 }); session.samples.push(new Float32Array(samples)); }
    while (session.recognizer.isReady(session.stream)) session.recognizer.decode(session.stream);
    return { text: session.recognizer.getResult(session.stream).text || '', final: false };
  }
  async function streamFinish({ requestId, audio } = {}) {
    const abort = calls.get(requestId);
    if (!abort || !worker) throw new Error('流式录音会话不存在');
    const session = streams.get(requestId); if (!session) throw new Error('流式录音会话不存在');
    try {
      session.stream.acceptWaveform({ samples: new Float32Array(8000), sampleRate: 16000 });
      session.stream.inputFinished();
      while (session.recognizer.isReady(session.stream)) session.recognizer.decode(session.stream);
      return { text: session.recognizer.getResult(session.stream).text || '', final: true };
    } finally { streams.delete(requestId); calls.delete(requestId); }
  }
  function cancel(requestId) { calls.get(requestId)?.abort(); calls.delete(requestId); streams.delete(requestId); }
  async function dispose() {
    closing = true;
    streamAbort?.abort(new Error('语音服务已关闭')); streamAbort = undefined;
    for (const call of calls.values()) call.abort();
    processes.terminateAll?.();
    streams.clear();
    try { streamRecognizer?.free?.(); } catch {}
    streamRecognizer = undefined;
    await serialize(deactivate);
  }
  return { status, snapshot, configure, prepare, cancelPreparation, removeModels, transcribe, streamStart, streamChunk, streamFinish, cancel, dispose };
}
module.exports = { createVoiceInput, MAX_AUDIO_BYTES, MAX_DURATION_SECONDS };
