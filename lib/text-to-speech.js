'use strict';

// Edge text-to-speech service for Yan Agent.
//
// Synthesis runs in the main process; the renderer only receives encoded audio
// bytes, so message text never leaks to a renderer-side network surface. The
// msedge-tts engine is bundled as lib/tts-msedge.bundle.cjs (see
// scripts/build-tts-bundle.cjs) to keep the packaged app self-contained.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_RATE = 0;
const MIN_RATE = -50;
const MAX_RATE = 100;
const MAX_TEXT_LENGTH = 1000;
const SYNTH_TIMEOUT_MS = 45000;
const VOICES_TIMEOUT_MS = 15000;
const VOICES_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_FILES = 400;
const STALE_PARTIAL_MS = 24 * 60 * 60 * 1000;
const VOICE_PATTERN = /^[A-Za-z0-9]{2,10}(?:-[A-Za-z0-9]+){1,5}$/;

function normalizeVoice(value) {
  const voice = String(value || '').trim();
  return VOICE_PATTERN.test(voice) ? voice : DEFAULT_VOICE;
}

function normalizeRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return DEFAULT_RATE;
  return Math.max(MIN_RATE, Math.min(MAX_RATE, Math.round(rate)));
}

function rateToProsody(rate) {
  return `${rate >= 0 ? '+' : ''}${rate}%`;
}

function loadEdgeClient() {
  const mod = require('./tts-msedge.bundle.cjs');
  if (!mod?.MsEdgeTTS || !mod?.OUTPUT_FORMAT) {
    throw new Error('语音引擎未打包，请先运行 npm run bundle:tts 后重试。');
  }
  return mod;
}

function synthesizeToFile(client, text, rate, partPath, timeoutMs) {
  const { audioStream } = client.toStream(text, { rate: rateToProsody(rate) });
  const output = fs.createWriteStream(partPath);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { client.close(); } catch { /* the stream error below is the signal */ }
  }, timeoutMs);
  return pipeline(audioStream, output)
    .catch(error => {
      throw timedOut ? new Error('语音合成超时，请检查网络后重试') : error;
    })
    .finally(() => clearTimeout(timer));
}

async function unlinkQuietly(target) {
  try { await fsp.unlink(target); } catch { /* best-effort cleanup */ }
}

function createTextToSpeech(options = {}) {
  const cacheDir = String(options.cacheDir || '');
  if (!cacheDir) throw new Error('cacheDir is required');
  const makeClient = typeof options.clientFactory === 'function'
    ? options.clientFactory
    : () => {
        const { MsEdgeTTS } = loadEdgeClient();
        return new MsEdgeTTS();
      };
  const maxCacheFiles = Number.isFinite(Number(options.maxCacheFiles))
    ? Math.max(16, Math.floor(Number(options.maxCacheFiles)))
    : MAX_CACHE_FILES;
  const synthTimeoutMs = Number.isFinite(Number(options.synthTimeoutMs))
    ? Math.max(1000, Math.floor(Number(options.synthTimeoutMs)))
    : SYNTH_TIMEOUT_MS;

  const active = new Map();
  let voicesCache = null;

  async function pruneCache() {
    let entries;
    try {
      entries = await fsp.readdir(cacheDir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(cacheDir, entry.name);
      if (entry.name.endsWith('.mp3')) {
        files.push(full);
      } else if (entry.name.includes('.part-')) {
        try {
          const stat = await fsp.stat(full);
          if (Date.now() - stat.mtimeMs > STALE_PARTIAL_MS) await fsp.unlink(full);
        } catch { /* best-effort */ }
      }
    }
    if (files.length <= maxCacheFiles) return;
    const stats = [];
    for (const file of files) {
      try { stats.push({ file, mtimeMs: (await fsp.stat(file)).mtimeMs }); } catch { /* skipped */ }
    }
    stats.sort((left, right) => left.mtimeMs - right.mtimeMs);
    for (let index = 0; index < stats.length - maxCacheFiles; index += 1) {
      await unlinkQuietly(stats[index].file);
    }
  }

  async function synthesize(payload = {}) {
    const text = String(payload.text || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('没有可朗读的文本');
    if (text.length > MAX_TEXT_LENGTH) {
      throw new Error(`朗读文本过长（上限 ${MAX_TEXT_LENGTH} 字）`);
    }
    const voice = normalizeVoice(payload.voice);
    const rate = normalizeRate(payload.rate);
    const requestId = String(payload.requestId || '');
    const key = crypto
      .createHash('sha256')
      .update(`${voice}|${rate}|${text}`)
      .digest('hex')
      .slice(0, 40);
    const cachePath = path.join(cacheDir, `${key}.mp3`);

    try {
      const stat = await fsp.stat(cachePath);
      if (stat.isFile() && stat.size > 0) {
        return { path: cachePath, cached: true, voice, rate };
      }
    } catch { /* cache miss */ }

    await fsp.mkdir(cacheDir, { recursive: true });
    const partPath = `${cachePath}.part-${process.pid}-${Date.now()}`;
    const { OUTPUT_FORMAT } = loadEdgeClient();
    const client = makeClient();
    const entry = { client, partPath, cancelled: false };
    if (requestId) active.set(requestId, entry);
    try {
      await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      if (entry.cancelled) throw new Error('已取消');
      await synthesizeToFile(client, text, rate, partPath, synthTimeoutMs);
      if (entry.cancelled) throw new Error('已取消');
      await fsp.rename(partPath, cachePath);
      void pruneCache();
      return { path: cachePath, cached: false, voice, rate };
    } catch (error) {
      await unlinkQuietly(partPath);
      if (entry.cancelled) throw new Error('已取消');
      throw error;
    } finally {
      if (requestId) active.delete(requestId);
      try { client.close(); } catch { /* already closed */ }
    }
  }

  function cancel(requestId) {
    const id = String(requestId || '');
    const entry = active.get(id);
    if (!entry) return false;
    entry.cancelled = true;
    active.delete(id);
    try { entry.client.close(); } catch { /* stream error already surfaced */ }
    void unlinkQuietly(entry.partPath);
    return true;
  }

  async function listVoices(payload = {}) {
    const force = payload.force === true;
    if (!force && voicesCache && Date.now() - voicesCache.at < VOICES_TTL_MS) {
      return voicesCache.voices;
    }
    const client = makeClient();
    try {
      const voices = await Promise.race([
        Promise.resolve(client.getVoices()),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('获取音色列表超时')), VOICES_TIMEOUT_MS);
        })
      ]);
      const list = Array.isArray(voices) ? voices : [];
      voicesCache = { at: Date.now(), voices: list };
      return list;
    } finally {
      try { client.close(); } catch { /* voices only use HTTP */ }
    }
  }

  return {
    synthesize,
    cancel,
    listVoices,
    pruneCache,
    cacheDir,
    get activeCount() { return active.size; }
  };
}

module.exports = {
  createTextToSpeech,
  normalizeVoice,
  normalizeRate,
  rateToProsody,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  MIN_RATE,
  MAX_RATE,
  MAX_TEXT_LENGTH
};
