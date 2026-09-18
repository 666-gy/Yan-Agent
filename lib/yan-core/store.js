'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const DEFAULT_COMPACTION_DELAY_MS = 1_500;
const MIN_COMPACTION_OVERFLOW = 1_000;
// Chunked file access everywhere: the event log can exceed V8's maximum
// string length (~536M chars), and any full-file readFileSync/readFile('utf8')
// then throws RangeError "Invalid string length", which used to disable
// compaction and flood the console.
const READ_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_LINE_BYTES = 64 * 1024 * 1024;
const COMPACTION_MAX_TAIL_BYTES = 192 * 1024 * 1024;
const COMPACTION_WARN_INTERVAL_MS = 30_000;

function emptySnapshot() {
  return {
    version: STORE_VERSION,
    nextEventSequence: 0,
    threads: {},
    turns: {},
    intents: {},
    items: {},
    updatedAt: 0
  };
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return clone(fallback);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function readJsonDetailed(filePath, fallback) {
  if (!fs.existsSync(filePath)) return { value: clone(fallback), corrupt: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: clone(fallback), corrupt: true };
    }
    return { value: parsed, corrupt: false };
  } catch {
    return { value: clone(fallback), corrupt: true };
  }
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    // Windows cannot always replace an existing file with renameSync. The
    // fallback still writes the complete temporary file before replacing it.
    fs.copyFileSync(temporary, filePath);
    fs.rmSync(temporary, { force: true });
  }
}

class YanCoreStore {
  constructor({
    rootDir,
    stateFile = 'state.json',
    eventsFile = 'events.jsonl',
    maxEvents = 20_000,
    compactionOverflow = null,
    compactionDelayMs = DEFAULT_COMPACTION_DELAY_MS,
    logger = console
  } = {}) {
    if (!rootDir) throw new TypeError('YanCoreStore requires rootDir.');
    this.logger = logger && typeof logger.warn === 'function' ? logger : console;
    this.rootDir = path.resolve(String(rootDir));
    this.statePath = path.join(this.rootDir, stateFile);
    this.eventsPath = path.join(this.rootDir, eventsFile);
    this.maxEvents = Math.max(100, Number(maxEvents) || 20_000);
    const requestedOverflow = Number(compactionOverflow);
    this.compactionOverflow = Number.isFinite(requestedOverflow) && requestedOverflow > 0
      ? Math.max(1, Math.floor(requestedOverflow))
      : Math.max(MIN_COMPACTION_OVERFLOW, Math.ceil(this.maxEvents * 0.25));
    // Keep a hysteresis band. Compacting at maxEvents + 1 made every later
    // token append synchronously rewrite the entire log once the limit was
    // crossed, which can hang Electron for minutes on a busy stream.
    this.compactionThreshold = this.maxEvents + this.compactionOverflow;
    this.compactionDelayMs = Math.max(0, Number(compactionDelayMs) || DEFAULT_COMPACTION_DELAY_MS);
    // Counted once up front, then tracked in memory: the append hot path must
    // never re-read or re-count the JSONL file. Sequences are a poor proxy
    // here — after a compaction and restart they far exceed the real line
    // count and would trigger a needless full compaction on the first append.
    this.eventCount = this.countEvents();
    this.appendGeneration = 0;
    this.compactionTimer = null;
    this.compactionPromise = null;
    this.compactionCount = 0;
    this.compactionNonce = 0;
    this.recoverCompactionBackups();
  }

  load() {
    const loaded = readJsonDetailed(this.statePath, emptySnapshot());
    let raw = loaded.value;
    if (loaded.corrupt) {
      // Preserve the damaged snapshot for diagnosis, then rebuild as much as
      // possible from the append-only event log before Core persists again.
      try {
        fs.copyFileSync(this.statePath, `${this.statePath}.corrupt-${Date.now()}`);
      } catch { /* best effort; the replay remains useful */ }
      try {
        const { YanEventProjector } = require('./projector');
        const projector = new YanEventProjector();
        projector.applyAll(this.iterateEvents({ limit: Number.MAX_SAFE_INTEGER }), { collectResults: false });
        raw = {
          ...emptySnapshot(),
          ...projector.snapshot(),
          nextEventSequence: Math.max(projector.state.lastSequence, this.lastEventSequence())
        };
        this.logger.warn('[yan-core] damaged snapshot recovered from event journal', {
          lastSequence: raw.nextEventSequence,
          threads: Object.keys(raw.threads).length,
          turns: Object.keys(raw.turns).length
        });
      } catch (error) {
        this.logger.warn('[yan-core] snapshot recovery failed:', error?.message || error);
        raw = emptySnapshot();
      }
      // Persist successful recovery so another launch does not repeat replay.
      // Keep the corrupt copy and journal untouched if the replacement fails.
      if (raw.lastSequence > 0) {
        try { this.save(raw); }
        catch (error) { this.logger.warn('[yan-core] recovered snapshot could not be saved:', error?.message || error); }
      }
    }
    return {
      ...emptySnapshot(),
      ...raw,
      version: STORE_VERSION,
      nextEventSequence: Math.max(0, Number(raw.nextEventSequence) || 0),
      threads: raw.threads && typeof raw.threads === 'object' ? raw.threads : {},
      turns: raw.turns && typeof raw.turns === 'object' ? raw.turns : {},
      intents: raw.intents && typeof raw.intents === 'object' ? raw.intents : {},
      items: raw.items && typeof raw.items === 'object' ? raw.items : {}
    };
  }

  save(snapshot) {
    // No defensive deep clone here: writeAtomic serializes synchronously on
    // this same thread, so the clone only doubled the serialization cost of a
    // potentially multi-megabyte state on Electron's main thread.
    const next = {
      ...emptySnapshot(),
      ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
      version: STORE_VERSION,
      updatedAt: Date.now()
    };
    writeAtomic(this.statePath, next);
    return next;
  }

  countEvents() {
    if (!fs.existsSync(this.eventsPath)) return 0;
    let fd;
    try {
      const { size } = fs.statSync(this.eventsPath);
      if (!size) return 0;
      fd = fs.openSync(this.eventsPath, 'r');
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, size));
      let position = size;
      let newlines = 0;
      let lastByte = 0x0a;
      let firstChunk = true;
      while (position > 0) {
        const length = Math.min(buffer.length, position);
        position -= length;
        fs.readSync(fd, buffer, 0, length, position);
        // Backward reads overwrite the buffer; the first chunk holds the file
        // tail, so capture its last byte before it can be overwritten.
        if (firstChunk) {
          lastByte = buffer[length - 1];
          firstChunk = false;
        }
        for (let index = 0; index < length; index += 1) {
          if (buffer[index] === 0x0a) newlines += 1;
        }
      }
      // Appends always end with '\n'; a missing trailing newline means the
      // last line is a torn write and still counts as a line.
      if (lastByte !== 0x0a) newlines += 1;
      return newlines;
    } catch {
      return 0;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
      }
    }
  }

  // The last durable sequence number, read from the file tail only. Delta
  // events advance the sequence cursor without rewriting state.json, so this
  // is how a restarted Core avoids reusing sequence numbers after a crash.
  lastEventSequence() {
    if (!fs.existsSync(this.eventsPath)) return 0;
    let fd;
    try {
      const { size } = fs.statSync(this.eventsPath);
      if (!size) return 0;
      const length = Math.min(size, 256 * 1024);
      const buffer = Buffer.alloc(length);
      fd = fs.openSync(this.eventsPath, 'r');
      fs.readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const event = JSON.parse(lines[index]);
          if (Number.isFinite(Number(event?.sequence))) return Math.max(0, Number(event.sequence));
        } catch { /* torn tail line; keep scanning backwards */ }
      }
      return 0;
    } catch {
      return 0;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
      }
    }
  }

  appendEvent(event) {
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    if (this.eventCount === null) this.eventCount = this.countEvents();
    this.eventCount += 1;
    this.appendGeneration += 1;
    this.compactEventsIfNeeded();
    return event;
  }

  readEvents(options = {}) {
    return Array.from(this.iterateEvents(options));
  }

  // Recovery consumes events incrementally. Retain at most one bounded line,
  // never the entire journal or a snapshot for every historical event.
  *iterateEvents({ afterSequence = 0, limit = 5_000 } = {}) {
    if (!fs.existsSync(this.eventsPath)) return;
    const max = Math.max(1, Number(limit) || 5_000);
    let fd;
    try {
      fd = fs.openSync(this.eventsPath, 'r');
      const chunk = Buffer.alloc(READ_CHUNK_BYTES);
      let parts = [], bytes = 0, oversized = false, count = 0;
      const append = (part) => {
        if (oversized) return;
        bytes += part.length;
        if (bytes > MAX_EVENT_LINE_BYTES) {
          parts = []; oversized = true;
          return;
        }
        if (part.length) parts.push(Buffer.from(part));
      };
      const finish = () => {
        let event;
        if (!oversized && bytes) {
          try {
            const parsed = JSON.parse(Buffer.concat(parts, bytes).toString('utf8'));
            if (parsed && typeof parsed === 'object' && Number(parsed.sequence) > Number(afterSequence)) event = parsed;
          } catch { /* Skip malformed/torn lines; later valid events still recover. */ }
        }
        parts = []; bytes = 0; oversized = false;
        return event;
      };
      let length;
      while ((length = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
        let start = 0;
        for (let index = 0; index < length; index += 1) {
          if (chunk[index] !== 0x0a) continue;
          append(chunk.subarray(start, index));
          const event = finish();
          start = index + 1;
          if (event) { yield event; if (++count >= max) return; }
        }
        append(chunk.subarray(start, length));
      }
      const event = finish();
      if (event && count < max) yield event;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  // Schedule compaction after a quiet period. The append path remains
  // synchronous for durability, but the potentially large read/write work is
  // performed with fs.promises so a token stream cannot monopolize Electron's
  // main thread.
  compactEventsIfNeeded() {
    if (this.eventCount === null) this.eventCount = this.lastEventSequence();
    if (this.eventCount <= this.compactionThreshold) return false;
    if (this.compactionTimer) clearTimeout(this.compactionTimer);
    this.compactionTimer = setTimeout(() => {
      this.compactionTimer = null;
      void this.compactEventsAsync();
    }, this.compactionDelayMs);
    this.compactionTimer.unref?.();
    return true;
  }

  warnThrottled(message, detail) {
    const now = Date.now();
    if (now - (this.lastCompactionWarnAt || 0) < COMPACTION_WARN_INTERVAL_MS) return;
    this.lastCompactionWarnAt = now;
    this.logger?.warn?.(message, detail);
  }

  // Byte offset that leaves maxEvents complete lines at the tail of the
  // file, found by scanning newlines backward in chunks. Never builds a
  // string from the file, so a multi-GB log cannot hit the V8 string limit.
  // A byte cap bounds the kept tail when lines are individually huge.
  async findCompactionTailStart(handle, size) {
    const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, size));
    const neededNewlines = this.maxEvents + 1; // terminates the line before the kept tail
    let position = size;
    let newlinesSeen = 0;
    let boundary = -1;
    while (position > 0 && newlinesSeen < neededNewlines) {
      const length = Math.min(chunk.length, position);
      position -= length;
      const view = chunk.subarray(0, length);
      await handle.read(view, 0, length, position);
      for (let index = length - 1; index >= 0; index -= 1) {
        if (view[index] !== 0x0a) continue;
        newlinesSeen += 1;
        if (newlinesSeen === neededNewlines) {
          boundary = position + index + 1;
          break;
        }
      }
      if (boundary >= 0) break;
    }
    let align = false;
    if (boundary < 0) {
      // Fewer lines than maxEvents: keep everything unless the file is
      // oversized (a few pathological giant lines), in which case fall back
      // to the byte cap.
      if (size - position < COMPACTION_MAX_TAIL_BYTES) return 0;
      boundary = position;
      align = true;
    }
    if (size - boundary > COMPACTION_MAX_TAIL_BYTES) {
      boundary = size - COMPACTION_MAX_TAIL_BYTES;
      align = true;
    }
    if (boundary <= 0) return 0;
    return align ? this.alignToLineStart(handle, boundary, size) : boundary;
  }

  // Advances rawStart to just after the next newline so the copied tail
  // begins at a line boundary. Falls back to a mid-line cut when no newline
  // exists ahead; the torn head is ignored by readers like the pre-existing
  // torn-tail case.
  async alignToLineStart(handle, rawStart, size) {
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    let position = rawStart;
    while (position < size) {
      const length = Math.min(chunk.length, size - position);
      const view = chunk.subarray(0, length);
      await handle.read(view, 0, length, position);
      for (let index = 0; index < length; index += 1) {
        if (view[index] === 0x0a) return position + index + 1;
      }
      position += length;
    }
    return rawStart;
  }

  // Copies bytes [tailStart, size) into the temporary file in fixed chunks,
  // returning the number of complete lines written.
  async copyEventTail(handle, tailStart, size, temporary) {
    const output = await fs.promises.open(temporary, 'w');
    try {
      const chunk = Buffer.alloc(READ_CHUNK_BYTES);
      let position = tailStart;
      let newlines = 0;
      while (position < size) {
        const length = Math.min(chunk.length, size - position);
        const view = chunk.subarray(0, length);
        await handle.read(view, 0, length, position);
        for (let index = 0; index < length; index += 1) {
          if (view[index] === 0x0a) newlines += 1;
        }
        await output.write(view, 0, length);
        position += length;
      }
      return newlines;
    } finally {
      try { await output.close(); } catch { /* already closed */ }
    }
  }

  async compactEventsAsync({ force = false } = {}) {
    if (this.compactionPromise) return this.compactionPromise;
    if (this.eventCount === null) this.eventCount = this.lastEventSequence();
    const threshold = force ? this.maxEvents : this.compactionThreshold;
    if (this.eventCount <= threshold) return false;

    const generation = this.appendGeneration;
    const promise = (async () => {
      let handle;
      let temporary = '';
      try {
        const { size: sourceSize } = await fs.promises.stat(this.eventsPath);
        if (!sourceSize) return false;
        handle = await fs.promises.open(this.eventsPath, 'r');
        const tailStart = await this.findCompactionTailStart(handle, sourceSize);
        if (tailStart <= 0) return false;
        // An append may have happened while the scan was in flight.
        // Never replace the live log with a stale snapshot in that case.
        if (generation !== this.appendGeneration || this.currentEventFileSize() !== sourceSize) return false;
        temporary = `${this.eventsPath}.tmp-${process.pid}-${Date.now()}-${++this.compactionNonce}`;
        const keptLines = await this.copyEventTail(handle, tailStart, sourceSize, temporary);
        if (generation !== this.appendGeneration || this.currentEventFileSize() !== sourceSize) return false;
        this.replaceCompactedFile(temporary);
        this.eventCount = keptLines;
        this.compactionCount += 1;
        return true;
      } catch (error) {
        this.warnThrottled('[yan-core] event log compaction failed:', error?.message || error);
        return false;
      } finally {
        if (handle !== undefined) {
          try { await handle.close(); } catch { /* already closed */ }
        }
        if (temporary) {
          try { await fs.promises.rm(temporary, { force: true }); } catch {}
        }
      }
    })();

    this.compactionPromise = promise
      .catch(error => {
        this.warnThrottled('[yan-core] event log compaction failed:', error?.message || error);
        return false;
      })
      .finally(() => {
        this.compactionPromise = null;
        // If more events arrived after the snapshot was taken, let the normal
        // quiet-period scheduler try again instead of dropping the request.
        if (this.eventCount > this.compactionThreshold && !this.compactionTimer) {
          this.compactEventsIfNeeded();
        }
      });
    return this.compactionPromise;
  }

  async flushCompaction({ force = false } = {}) {
    if (this.compactionTimer) {
      clearTimeout(this.compactionTimer);
      this.compactionTimer = null;
    }
    if (this.compactionPromise) return this.compactionPromise;
    if (this.eventCount === null) this.eventCount = this.lastEventSequence();
    const threshold = force ? this.maxEvents : this.compactionThreshold;
    if (this.eventCount <= threshold) return false;
    return this.compactEventsAsync({ force });
  }

  close() {
    if (this.compactionTimer) {
      clearTimeout(this.compactionTimer);
      this.compactionTimer = null;
    }
    return this.compactionPromise || Promise.resolve(false);
  }

  currentEventFileSize() {
    try { return fs.statSync(this.eventsPath).size; } catch { return 0; }
  }

  recoverCompactionBackups() {
    const directory = path.dirname(this.eventsPath);
    const prefix = `${path.basename(this.eventsPath)}.bak-`;
    let backups = [];
    try {
      backups = fs.readdirSync(directory)
        .filter(name => name.startsWith(prefix))
        .sort()
        .map(name => path.join(directory, name));
    } catch { return; }
    if (!backups.length) return;
    if (!fs.existsSync(this.eventsPath)) {
      const newest = backups.pop();
      try { fs.renameSync(newest, this.eventsPath); } catch {}
    }
    for (const backup of backups) {
      try { fs.rmSync(backup, { force: true }); } catch {}
    }
  }

  replaceCompactedFile(temporary) {
    try {
      fs.renameSync(temporary, this.eventsPath);
      return;
    } catch (renameError) {
      // Windows does not replace an existing file with renameSync. Move the
      // old file aside, install the complete compacted file, and restore the
      // old file if the second rename fails. Both renames are tiny metadata
      // operations, so this fallback does not copy the whole log on the hot
      // path.
      const backup = `${this.eventsPath}.bak-${process.pid}-${Date.now()}-${++this.compactionNonce}`;
      let moved = false;
      try {
        if (fs.existsSync(this.eventsPath)) {
          fs.renameSync(this.eventsPath, backup);
          moved = true;
        }
        fs.renameSync(temporary, this.eventsPath);
        if (moved) {
          try { fs.rmSync(backup, { force: true }); } catch {}
        }
      } catch (error) {
        if (moved && !fs.existsSync(this.eventsPath) && fs.existsSync(backup)) {
          try { fs.renameSync(backup, this.eventsPath); } catch {}
        }
        // Preserve the original failure context when the platform refuses the
        // replacement. It is safer to leave the original log intact than to
        // fall back to a blocking copy of a multi-megabyte stream log.
        error.cause ||= renameError;
        throw error;
      }
    }
  }
}

module.exports = {
  STORE_VERSION,
  YanCoreStore,
  emptySnapshot,
  writeAtomic
};
