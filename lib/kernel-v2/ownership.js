'use strict';

// Windows reuses PIDs, so a PID alone cannot prove that the process recorded in
// an ownership file is still the same process. Ownership records therefore carry
// the process start time (.NET DateTime ticks, as emitted by the native helper);
// legacy records without it fall back to comparing the process start with the
// time the lock was written.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const shellSupervisor = path.join(__dirname, '../native/yan-shell-job.exe')
  .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
// .NET DateTime ticks count 100ns intervals from 0001-01-01, while Unix ms
// count from 1970-01-01. The difference is 62135596800000 ms.
const DOTNET_EPOCH_OFFSET_MS = 62135596800000;
// File timestamps and process start times come from the same clock, but allow
// for coarse filesystem/process timestamp resolution before calling a PID reused.
const REUSE_TOLERANCE_MS = 2000;

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve('');
  if (process.platform !== 'win32') {
    try { return Promise.resolve(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]); }
    catch { return Promise.resolve(''); }
  }
  return new Promise(resolve => {
    execFile(shellSupervisor, ['--process-start', String(pid)], { windowsHide: true, timeout: 2000 },
      (error, output) => resolve(error ? '' : String(output).trim()));
  });
}

function processStartMs(value) {
  const ticks = Number(value);
  if (!Number.isFinite(ticks) || ticks <= 0) return NaN;
  return ticks / 10000 - DOTNET_EPOCH_OFFSET_MS;
}

// Returns true only when the recorded owner is still the same live process.
// `aliveOf`/`identityOf` are injectable so the decision stays unit-testable.
async function ownerProcessAlive({ pid, identity, lockMtimeMs, aliveOf = alive,
  identityOf = processIdentity, toleranceMs = REUSE_TOLERANCE_MS } = {}) {
  if (!aliveOf(pid)) return false;
  const current = await identityOf(pid);
  if (identity) {
    // An unreadable identity is not proof of reuse; keep the lock rather than
    // letting two kernels open the same database.
    return !current || current === identity;
  }
  // Legacy owner file without an identity. The recorded process necessarily
  // started before the file was written; a live PID that started later is a
  // reused PID, not the original owner.
  if (process.platform !== 'win32') return true;
  const startedMs = processStartMs(current);
  if (!Number.isFinite(startedMs) || !Number.isFinite(lockMtimeMs)) return true;
  return startedMs <= lockMtimeMs + toleranceMs;
}

module.exports = { ownerProcessAlive, processIdentity, processStartMs, alive, REUSE_TOLERANCE_MS };
