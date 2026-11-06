import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Process capture is a separate, much larger budget. Bound model history even
// when a producer reports capture truncation (including truncated: false).
export const SHELL_OUTPUT_BYTES = 32 * 1024;
export const SHELL_OUTPUT_LINES = 400;

function edge(text, bytes, lines, tail) {
  const source = Buffer.from(text);
  let start = tail ? Math.max(0, source.length - bytes) : 0;
  let end = tail ? source.length : Math.min(source.length, bytes);
  // Never split a UTF-8 code point at either retained boundary.
  while (start < source.length && (source[start] & 0xc0) === 0x80) start++;
  while (end < source.length && end > start && (source[end] & 0xc0) === 0x80) end--;
  const rows = source.subarray(start, end).toString('utf8').split('\n');
  return (tail ? rows.slice(-lines) : rows.slice(0, lines)).join('\n');
}

export async function boundShellOutput(value, { sessionID = '', captureTruncated = false,
  directory = path.join(process.env.XDG_DATA_HOME || process.env.YAN_PLUGIN_DATA_DIR || os.tmpdir(), 'opencode', 'tool-output') } = {}) {
  const text = String(value ?? '');
  const bytes = Buffer.byteLength(text);
  const lines = text.split('\n').length;
  if (bytes <= SHELL_OUTPUT_BYTES && lines <= SHELL_OUTPUT_LINES) {
    return { content: text, metadata: { truncated: false, captureTruncated } };
  }
  // Reuse V2's tool-output retention directory and filename contract (7 days).
  // Content addressing prevents repeated status reads duplicating the same log.
  const digest = createHash('sha256').update(sessionID).update('\0').update(text).digest('hex');
  const file = path.join(directory, `tool_${digest}.txt`);
  let outputPath, notice;
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
    outputPath = file;
    notice = `Captured output saved to ${file}. Read selected ranges with the read tool; do not load the entire log.`;
  } catch (error) {
    // A logging failure must not turn a command that already ran into a failed
    // tool that the model may execute again. Still bound the returned content.
    notice = `Could not save captured output (${error.code || 'I/O error'}); omitted text is unavailable. Do not rerun the command solely to recover this log.`;
  }
  const marker = `\n\n[Output shortened: ${bytes} UTF-8 bytes, ${lines} lines. Showing head and tail. ${notice}${captureTruncated ? ' The process capture was already truncated; the file is not the complete command output.' : ''}]\n\n`;
  const allowance = Math.max(0, SHELL_OUTPUT_BYTES - Buffer.byteLength(marker));
  const rows = Math.floor((SHELL_OUTPUT_LINES - 6) / 2);
  const content = edge(text, Math.floor(allowance / 2), rows, false) + marker
    + edge(text, Math.floor(allowance / 2), rows, true);
  return { content, metadata: { truncated: true, captureTruncated, ...(outputPath ? { outputPath } : {}) } };
}

export async function boundShellResult(result, options) {
  const captureTruncated = result.metadata?.captureTruncated ?? result.metadata?.truncated === true;
  const bounded = await boundShellOutput(result.content, { ...options, captureTruncated });
  return { ...result, content: bounded.content, metadata: { ...result.metadata, ...bounded.metadata } };
}
