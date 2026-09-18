'use strict';

// Protocol reverse engineering engine behind the hex_* / crc_probe MCP tools.
// All functions are pure offline analysis over Buffers. The guiding rule:
// statistics before guesses, executable validation before claims.

const SAMPLE_RECORDS_MIN = 2;
const MAX_STRIDE = 64;
const MAX_RECORDS = 4096;

function shannonEntropy(values) {
  if (!values.length) return 0;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / values.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

// Splits every sample into fixed-stride records and returns per-offset
// statistics: distinct values, entropy, most common byte, classification
// (constant / low-entropy / high-entropy / varying).
function offsetStats(samples, stride) {
  const columns = [];
  for (const sample of samples) {
    for (let start = 0; start + stride <= sample.length; start += stride) {
      columns.push(sample.subarray(start, start + stride));
      if (columns.length >= MAX_RECORDS) break;
    }
    if (columns.length >= MAX_RECORDS) break;
  }
  const stats = [];
  for (let offset = 0; offset < stride; offset++) {
    const values = columns.map(record => record[offset]);
    const distinct = new Set(values).size;
    const entropy = shannonEntropy(values);
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    let common = 0;
    let commonCount = 0;
    for (const [value, count] of counts) {
      if (count > commonCount) { common = value; commonCount = count; }
    }
    let classification = 'varying';
    if (distinct === 1) classification = 'constant';
    else if (entropy < 1.0) classification = 'low-entropy';
    else if (entropy > 6.5) classification = 'high-entropy';
    stats.push({ offset, distinct, entropy: Number(entropy.toFixed(3)), common: `0x${common.toString(16).padStart(2, '0')}`, classification });
  }
  return { stride, records: columns.length, stats };
}

// Autocorrelates candidate strides: score = constant-offset ratio, smallest
// stride wins ties (the canonical minimal record length beats its multiples).
function inferStride(samples, { maxStride = MAX_STRIDE, minRecords = SAMPLE_RECORDS_MIN } = {}) {
  let best = { stride: 0, score: -1, constant: 0 };
  for (let stride = 1; stride <= maxStride; stride++) {
    const columns = [];
    for (const sample of samples) {
      for (let start = 0; start + stride <= sample.length; start += stride) {
        columns.push(sample.subarray(start, start + stride));
        if (columns.length >= MAX_RECORDS) break;
      }
      if (columns.length >= MAX_RECORDS) break;
    }
    if (columns.length < minRecords) continue;
    let constant = 0;
    for (let offset = 0; offset < stride; offset++) {
      const values = columns.map(record => record[offset]);
      if (new Set(values).size === 1) constant += 1;
    }
    const score = constant / stride;
    if (score > best.score) best = { stride, score, constant };
  }
  return best.stride;
}

function hexDump(buffer, { offset = 0, length = 0 } = {}) {
  const start = Math.max(0, Number(offset) || 0);
  const end = Math.min(buffer.length, start + (Number(length) > 0 ? Number(length) : buffer.length - start));
  const lines = [];
  for (let position = start; position < end; position += 16) {
    const chunk = buffer.subarray(position, Math.min(position + 16, end));
    const hex = [...chunk].map(byte => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = [...chunk].map(byte => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${position.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
  }
  return lines.join('\n') || '(empty)';
}

// Byte-level diff of two equal-ish samples: first divergence, divergence
// count, and a per-byte table for small files.
function diffSamples(left, right) {
  const shared = Math.min(left.length, right.length);
  let firstDivergence = -1;
  let changed = 0;
  const changes = [];
  for (let index = 0; index < shared; index++) {
    if (left[index] !== right[index]) {
      changed += 1;
      if (firstDivergence === -1) firstDivergence = index;
      if (changes.length < 64) {
        changes.push({
          offset: index,
          left: `0x${left[index].toString(16).padStart(2, '0')}`,
          right: `0x${right[index].toString(16).padStart(2, '0')}`
        });
      }
    }
  }
  return {
    leftLength: left.length,
    rightLength: right.length,
    sameLength: left.length === right.length,
    firstDivergence,
    changed,
    density: Number((changed / Math.max(1, shared)).toFixed(4)),
    changes
  };
}

// ---- CRC / checksum probing ------------------------------------------------

function crc16(values, { poly = 0x1021, init = 0x0000, reflect = false, xorOut = 0x0000 } = {}) {
  let crc = init;
  for (const byte of values) {
    crc ^= reflect ? reflectByte(byte) << 8 : byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ poly) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return (reflect ? reflect16(crc) : crc) ^ xorOut;
}

function crc32(values, { init = 0xffffffff } = {}) {
  let crc = init;
  for (const byte of values) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) >>> 0 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function reflectByte(byte) {
  let reflected = 0;
  for (let bit = 0; bit < 8; bit++) {
    if (byte & (1 << bit)) reflected |= 0x80 >> bit;
  }
  return reflected & 0xff;
}

function reflect16(value) {
  let reflected = 0;
  for (let bit = 0; bit < 16; bit++) {
    if (value & (1 << bit)) reflected |= 0x8000 >> bit;
  }
  return reflected & 0xffff;
}

// Tests whether the trailing `trailerBytes` of each record match a standard
// checksum computed over the leading bytes. Returns the matching candidates
// across ALL records — a real hit matches every record with the same rule.
function probeChecksum(records, { trailerBytes = 2 } = {}) {
  if (records.length < 2 || records[0].length <= trailerBytes) return [];
  const candidates = [];
  for (let payloadLength = records[0].length - trailerBytes; payloadLength >= 1; payloadLength--) {
    for (const [name, compute] of [
      ['sum8', bytes => bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0)],
      ['sum16le', bytes => bytes.reduce((sum, byte) => (sum + byte) & 0xffff, 0) & 0xff],
      ['sum16be', bytes => bytes.reduce((sum, byte) => (sum + byte) & 0xffff, 0) & 0xff],
      ['xor8', bytes => bytes.reduce((xor, byte) => xor ^ byte, 0)],
      ['crc16-arc', bytes => crc16(bytes, { poly: 0x1021, init: 0x0000, reflect: true }) & 0xff],
      ['crc16-ccitt-false', bytes => crc16(bytes, { poly: 0x1021, init: 0xffff }) & 0xff],
      ['crc16-modbus', bytes => crc16(bytes, { poly: 0x8005, init: 0xffff, reflect: true }) & 0xff],
      ['crc32', bytes => crc32(bytes) & 0xff]
    ]) {
      let matches = 0;
      for (const record of records) {
        const expected = record[payloadLength];
        const computed = compute(record.subarray(0, payloadLength));
        if (expected === computed) matches += 1;
        else break;
      }
      if (matches === records.length) {
        candidates.push({
          algorithm: name,
          payloadOffset: 0,
          payloadLength,
          trailerOffset: payloadLength,
          trailerBytes,
          note: trailerBytes > 1 ? `low byte of ${name} at offset ${payloadLength}; full trailer is ${trailerBytes} bytes` : `full ${name} trailer`
        });
      }
    }
  }
  return candidates;
}

module.exports = { shannonEntropy, offsetStats, inferStride, hexDump, diffSamples, probeChecksum, crc16, crc32 };
