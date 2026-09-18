'use strict';

// tshark-based pcap overview for the Reverser agent. tshark is NOT bundled:
// the tool probes for it (PATH + Wireshark default locations) and degrades to
// an actionable "not installed" result.

const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const TSHARK_TIMEOUT_MS = 60_000;

function candidateTsharkPaths() {
  if (process.env.TSHARK_PATH) return [process.env.TSHARK_PATH];
  const candidates = ['tshark'];
  if (process.platform === 'win32') {
    for (const root of ['C:\\Program Files\\Wireshark', 'C:\\Program Files (x86)\\Wireshark']) {
      candidates.push(path.join(root, 'tshark.exe'));
    }
  }
  return candidates;
}

function detectTshark({ candidates = candidateTsharkPaths(), probe = spawnSync } = {}) {
  for (const candidate of candidates) {
    try {
      const result = probe(candidate, ['--version'], { timeout: 3000, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
      if (!result.error && result.status === 0) return { ok: true, tshark: candidate };
    } catch {}
  }
  return {
    ok: false,
    reason: 'tshark (Wireshark CLI) not found.',
    hint: 'Install Wireshark (https://www.wireshark.org/) or set TSHARK_PATH.'
  };
}

function runTshark(tshark, args, timeoutMs = TSHARK_TIMEOUT_MS) {
  return new Promise(resolve => {
    execFile(tshark, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && !stdout) return resolve({ ok: false, reason: (stderr || error.message || '').slice(0, 500) });
      resolve({ ok: true, text: stdout });
    });
  });
}

// Protocol hierarchy + top conversations + first messages of a capture.
async function pcapOverview(pcapPath, { messages = 40 } = {}) {
  const detection = detectTshark();
  if (!detection.ok) return detection;
  const source = path.resolve(String(pcapPath || ''));
  if (!fs.existsSync(source)) return { ok: false, reason: `pcap not found: ${source}` };

  const hierarchy = await runTshark(detection.tshark, ['-r', source, '-q', '-z', 'io,phs']);
  const conversations = await runTshark(detection.tshark, ['-r', source, '-q', '-z', 'conv,tcp']);
  const stream = await runTshark(detection.tshark, [
    '-r', source, '-T', 'fields',
    '-e', 'frame.number', '-e', 'frame.len', '-e', 'ip.src', '-e', 'ip.dst',
    '-e', 'udp.srcport', '-e', 'udp.dstport', '-e', 'tcp.srcport', '-e', 'tcp.dstport',
    '-e', '_ws.col.Protocol', '-e', '_ws.col.Info',
    '-c', String(Math.max(1, Math.min(500, Number(messages) || 40)))
  ]);

  const sections = [];
  if (hierarchy.ok) sections.push(`== protocol hierarchy ==\n${hierarchy.text.trim()}`);
  if (conversations.ok) sections.push(`== tcp conversations ==\n${conversations.text.trim()}`);
  if (stream.ok) {
    const rows = stream.text.trim().split('\n').slice(0, messages)
      .map(line => line.split('\t').join(' | '));
    sections.push(`== first messages (frame | len | src | dst | ports | protocol | info) ==\n${rows.join('\n')}`);
  }
  if (!sections.length) {
    return { ok: false, reason: hierarchy.reason || 'tshark produced no output.' };
  }
  return { ok: true, path: source, text: sections.join('\n\n') };
}

module.exports = { detectTshark, pcapOverview };
