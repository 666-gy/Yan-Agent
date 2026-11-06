'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { indexFile, validateIndex, digest } = require('./update-chunks');

function rangeRequest(url, start, size, total, { requestClient, timeoutMs = 30000, signal, redirects = 5 }) {
  let removeAbort = () => {};
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) { reject(new Error('Unsupported update protocol')); return; }
    const req = requestClient(parsed.protocol).get(parsed, { headers: {
      Range: `bytes=${start}-${start + size - 1}`, 'Accept-Encoding': 'identity', 'User-Agent': 'YanAgent-Updater'
    } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume();
        resolve(rangeRequest(new URL(response.headers.location, parsed).href, start, size, total,
          { requestClient, timeoutMs, signal, redirects: redirects - 1 })); return;
      }
      const expected = `bytes ${start}-${start + size - 1}/${total}`;
      if (response.statusCode !== 206 || response.headers['content-range'] !== expected
        || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.resume(); req.destroy(new Error('Update server does not support exact ranges')); return;
      }
      const buffers = []; let received = 0;
      response.on('data', data => {
        received += data.length;
        if (received > size) req.destroy(new Error('Oversized update range'));
        else buffers.push(data);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Update range interrupted')));
      response.on('end', () => received === size ? resolve(Buffer.concat(buffers)) : reject(new Error('Truncated update range')));
    });
    const abort = () => req.destroy(new Error('Update cancelled'));
    removeAbort = () => signal?.removeEventListener('abort', abort);
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Update range timeout')));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  }).finally(() => removeAbort());
}

async function downloadParallel({ urls, targetPath, index, expectedSize, expectedSha512,
  baselinePath, requestClient, onProgress, concurrency = 4, timeoutMs = 30000 }) {
  validateIndex(index, expectedSize, expectedSha512);
  if (!urls.length) throw new Error('Missing update source');
  const temporary = targetPath + '.' + crypto.randomUUID() + '.part';
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const abort = new AbortController();
  const output = await fs.promises.open(temporary, 'wx');
  let baseline, reusedBytes = 0, downloadedBytes = 0, cursor = 0, completed = 0, failure;
  const local = new Map();
  const report = () => onProgress?.({ received: completed, total: expectedSize,
    percent: Math.min(99, Math.floor(completed / expectedSize * 100)), reusedBytes, downloadedBytes, stage: 'download' });
  try {
    if (baselinePath && path.resolve(baselinePath) !== path.resolve(targetPath)) {
      try {
        const old = await indexFile(baselinePath);
        baseline = await fs.promises.open(baselinePath, 'r');
        for (const chunk of old.chunks) local.set(chunk.sha256, chunk);
      } catch { await baseline?.close(); baseline = null; }
    }
    await output.truncate(expectedSize);
    async function worker() {
      try {
        while (!abort.signal.aborted) {
          const chunk = index.chunks[cursor++]; if (!chunk) return;
          // Keep CDC chunks for verification/reuse, but fetch adjacent missing
          // chunks together to avoid thousands of small HTTP round trips.
          const batch = [chunk];
          let requestSize = chunk.size;
          if (!local.has(chunk.sha256)) {
            while (cursor < index.chunks.length) {
              const next = index.chunks[cursor];
              if (local.has(next.sha256) || next.offset !== chunk.offset + requestSize
                || requestSize + next.size > 4 * 1024 * 1024) break;
              batch.push(next); requestSize += next.size; cursor++;
            }
          }
          let data;
          const source = local.get(chunk.sha256);
          if (baseline && source?.size === chunk.size) {
            const buffer = Buffer.alloc(chunk.size);
            const read = await baseline.read(buffer, 0, buffer.length, source.offset);
            if (read.bytesRead === chunk.size && digest(buffer) === chunk.sha256) { data = buffer; reusedBytes += data.length; }
          }
          if (!data) {
            let error;
            for (let attempt = 0; attempt < urls.length * 2 && !abort.signal.aborted; attempt++) {
              try {
                const bytes = await rangeRequest(urls[attempt % urls.length], chunk.offset, requestSize, expectedSize,
                  { requestClient, timeoutMs, signal: abort.signal });
                for (const part of batch) {
                  const offset = part.offset - chunk.offset;
                  if (digest(bytes.subarray(offset, offset + part.size)) !== part.sha256) throw new Error('Update chunk checksum mismatch');
                }
                data = bytes; downloadedBytes += bytes.length; break;
              } catch (e) { error = e; }
            }
            if (!data) throw error || new Error('Update cancelled');
          }
          let written = 0;
          while (written < data.length) {
            const result = await output.write(data, written, data.length - written, chunk.offset + written);
            if (!result.bytesWritten) throw new Error('Update disk write failed');
            written += result.bytesWritten;
          }
          completed += data.length; report();
        }
      } catch (error) { failure ||= error; abort.abort(); }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, worker));
    if (failure) throw failure;
    await output.sync();
    const hash = crypto.createHash('sha512');
    for await (const data of fs.createReadStream(temporary)) hash.update(data);
    if (hash.digest('base64') !== expectedSha512) throw new Error('Reconstructed installer checksum mismatch');
    await output.close(); await baseline?.close(); baseline = null;
    await fs.promises.rename(temporary, targetPath);
    onProgress?.({ received: expectedSize, total: expectedSize, percent: 100, reusedBytes, downloadedBytes, stage: 'verified' });
    return { path: targetPath, size: expectedSize, sha512: expectedSha512, reusedBytes, downloadedBytes, mode: reusedBytes ? 'differential' : 'parallel' };
  } finally {
    await output.close().catch(() => {}); await baseline?.close();
    await fs.promises.unlink(temporary).catch(() => {});
  }
}
module.exports = { rangeRequest, downloadParallel };
