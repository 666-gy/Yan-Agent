'use strict';
const crypto = require('node:crypto');
// One complete reply per request. No warm-up synthesis or automatic retries.
function createVoiceCallSpeech({ clientFactory, timeoutMs = 120000 } = {}) {
  let active, cooldownUntil = 0;
  const cache = new Map();
  function cancel(requestId) {
    if (!active || (requestId && active.id !== requestId)) return false;
    active.abort(Error('语音播放已取消')); return true;
  }
  async function synthesize(payload = {}) {
    const text = String(payload.text || '').trim();
    if (!text) throw Error('没有可合成的正文');
    if (Buffer.byteLength(text, 'utf8') > 45000) throw Error('本次正文过长，已保留字幕；请缩短回答后重试');
    const key = crypto.createHash('sha256').update(text).digest('hex');
    if (cache.has(key)) return cache.get(key);
    if (active) throw Error('上一段语音尚未合成完成');
    if (Date.now() < cooldownUntil) throw Error('微软语音服务限流，请稍后再试；正文已保留在字幕中');
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('./tts-msedge.bundle.cjs');
    const client = clientFactory ? clientFactory() : new MsEdgeTTS();
    const id = payload.requestId || crypto.randomUUID();
    let rejectAbort, audioStream;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const entry = { id, cancelled: false, abort(error) { entry.cancelled = true; audioStream?.destroy(error); try { client.close(); } catch {} rejectAbort(error); } };
    active = entry;
    const timer = setTimeout(() => entry.abort(Error('微软语音合成超时，正文已保留在字幕中')), timeoutMs);
    try {
      const work = async () => {
        await client.setMetadata('zh-CN-XiaoxiaoNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        if (active !== entry || entry.cancelled) throw Error('语音播放已取消');
        audioStream = client.toStream(text, { rate: '+0%' }).audioStream;
        const parts = []; let bytes = 0;
        for await (const chunk of audioStream) {
          bytes += chunk.length; if (bytes > 32 * 1024 * 1024) throw Error('语音音频过大');
          parts.push(Buffer.from(chunk));
        }
        if (!bytes) throw Error('微软未返回语音音频');
        return { audio: Buffer.concat(parts), mime: 'audio/mpeg', voice: 'zh-CN-XiaoxiaoNeural' };
      };
      const result = await Promise.race([work(), aborted]);
      cache.set(key, result); while (cache.size > 4) cache.delete(cache.keys().next().value);
      return result;
    } catch (error) {
      if (/429/.test(error.message)) { cooldownUntil = Date.now() + 60000; throw Error('微软语音服务限流，请稍后再试；正文已保留在字幕中'); }
      throw error;
    } finally { clearTimeout(timer); if (active === entry) active = null; try { client.close(); } catch {} }
  }
  function dispose() { const entry = active; active = null; entry?.abort(Error('通话已结束')); cache.clear(); }
  return { synthesize, cancel, dispose, get activeCount() { return active ? 1 : 0; } };
}
module.exports = { createVoiceCallSpeech };
