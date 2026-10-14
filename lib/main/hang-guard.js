'use strict';

// 主进程停滞哨兵 (hang guard)。
//
// 背景:Yan Agent 主进程曾在工作途中整体卡死 30-40 秒甚至永久无响应 ——
// WER 报 AppHangTransient(1001)、crashpad 里零个 .dmp,即"卡住"而非"崩溃"。
// 主进程一旦阻塞,它自己既写不了日志也做不了恢复,所以观测者必须住在独立的
// worker 线程里,主线程只保留一件极廉价的事:每秒把 Date.now() 写进共享内存。
//
// 具体见 memory 里 "Yan perf work is closed":空转 CPU 必须保持 0-0.3%,因此
// 主线程侧的每 tick 开销只是一次 Atomics.store,采样(rss / GPU pid)每 10 拍
// 才做一次。
//
// 共享内存布局(Float64Array 不支持 Atomics,所以时钟用 BigInt64Array):
//   i64[0] = 心跳时钟 ms   i64[1] = rss(MB)   i64[2] = GPU 进程 pid
//   i64[3] = 启动时刻      i64[4] = 当前阶段开始时刻
//   i32[0] = 阶段标签字节数(0 = 未知)   i32[1] = 预期阻塞深度
//   i32[2] = 已杀 GPU 次数              i32[3] = 运行标志
//   [512, 768) = 阶段标签 UTF-8 字节

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const SAB_BYTES = 1024;
const LABEL_OFFSET = 512;
const LABEL_BYTES = 256;
const MAX_LABEL_CHARS = 96;

const HANG_LOG_NAME = 'hang.log';

const WORKER_SOURCE = `
'use strict';
const { workerData, parentPort } = require('node:worker_threads');
const fs = require('node:fs');

const { sab, logPath, softMs, hardMs, pollMs, maxKills, killCooldownMs, killGpu, maxBytes } = workerData;
const i64 = new BigInt64Array(sab, 0, 8);
const i32 = new Int32Array(sab, 64, 8);
const labelBytes = new Uint8Array(sab, ${LABEL_OFFSET}, ${LABEL_BYTES});
const decoder = new TextDecoder();

let logSize = 0;
try { logSize = fs.statSync(logPath).size; } catch { logSize = 0; }

function rotate() {
  try {
    if (logSize <= maxBytes) return;
    fs.renameSync(logPath, logPath + '.1');
    logSize = 0;
  } catch { logSize = 0; }
}

// 本进程是 hang.log 的唯一写入者:主线程只能通过消息请它代写,避免多写入者
// 交叉出半行。
function write(entry) {
  let line;
  try { line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) + '\\n'; }
  catch { line = JSON.stringify({ at: new Date().toISOString(), event: 'log-encode-failed' }) + '\\n'; }
  try {
    rotate();
    fs.appendFileSync(logPath, line, 'utf8');
    logSize += Buffer.byteLength(line);
  } catch { /* 日志失败绝不能再抛,否则哨兵反而成了故障源 */ }
}

function readLabel() {
  const len = Atomics.load(i32, 0);
  if (len <= 0) return '';
  return decoder.decode(labelBytes.subarray(0, Math.min(len, labelBytes.length)));
}

function phaseAgeMs(now) {
  const startedAt = Number(Atomics.load(i64, 4));
  if (!startedAt) return 0;
  return Math.max(0, now - startedAt);
}

let stalled = false;
let stallStartedAt = 0;
let lastStallLogAt = 0;
let lastKillAt = 0;
let kills = 0;
let lastSeen = Date.now();

function poll() {
  const now = Date.now();
  const gap = now - lastSeen;
  lastSeen = now;
  // 机器休眠/挂起时主线程与 worker 一起停摆,不是应用卡死:重置基线,不告警、
  // 更不许杀进程。
  if (gap > pollMs * 4) {
    if (gap > 60000) write({ event: 'resume-after-suspend', gapMs: gap });
    stalled = false;
    return;
  }
  if (!Atomics.load(i32, 3)) return;
  const clock = Number(Atomics.load(i64, 0));
  if (!clock) return;
  const age = now - clock;
  const blocking = Atomics.load(i32, 1) > 0;

  if (age < softMs) {
    if (stalled) {
      stalled = false;
      write({ event: 'stall-end', durationMs: now - stallStartedAt, phase: readLabel() });
    }
    return;
  }

  if (!stalled) {
    stalled = true;
    stallStartedAt = clock;
    lastStallLogAt = now;
    write({
      event: 'stall-start',
      ageMs: age,
      phase: readLabel(),
      phaseAgeMs: phaseAgeMs(clock),
      blocking,
      rssMb: Number(Atomics.load(i64, 1)),
      gpuPid: Number(Atomics.load(i64, 2))
    });
  } else if (now - lastStallLogAt >= 10000) {
    lastStallLogAt = now;
    write({ event: 'stall-continue', ageMs: age, phase: readLabel(), blocking });
  }

  // 硬阈值自愈:终止 GPU 子进程。Chromium 会自己重启 GPU 进程并在反复崩溃后
  // 回退到软件渲染,这是主线程已经卡死时唯一还能生效的软件级手段。预期中的
  // 阻塞(原生模态框)永不触发。
  if (!killGpu || blocking || age < hardMs) return;
  if (kills >= maxKills || now - lastKillAt < killCooldownMs) return;
  const pid = Number(Atomics.load(i64, 2));
  if (!(pid > 1) || pid === process.pid) return;
  let ok = true;
  let error = '';
  try { process.kill(pid); } catch (e) { ok = false; error = e && e.message ? e.message : String(e); }
  kills += 1;
  lastKillAt = now;
  Atomics.store(i32, 2, kills);
  Atomics.store(i64, 2, 0n); // pid 可能被复用,等主线程重新采样
  write({ event: ok ? 'gpu-kill' : 'gpu-kill-failed', pid, attempt: kills, ageMs: age, phase: readLabel(), error });
}

const timer = setInterval(poll, pollMs);
timer.unref && timer.unref();

parentPort.on('message', message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'note') {
    write({ event: 'note', text: String(message.text || '').slice(0, 2000), extra: message.extra || undefined });
    return;
  }
  if (message.type === 'mark') {
    write({ event: 'phase', phase: String(message.text || '') });
    return;
  }
  if (message.type === 'stop') {
    clearInterval(timer);
    write({ event: 'guard-stop' });
    process.exit(0);
  }
});

write({ event: 'guard-start', softMs, hardMs, killGpu, logPath });
`;

function safeExtra(extra) {
  if (extra === undefined || extra === null) return null;
  try { return JSON.parse(JSON.stringify(extra)); } catch { return String(extra); }
}

function createHangGuard(options = {}) {
  const {
    app,
    dataDir,
    logFileName = HANG_LOG_NAME,
    softMs = 5000,
    hardMs = 20000,
    pollMs = 1000,
    tickMs = 1000,
    maxKills = 3,
    killCooldownMs = 5 * 60 * 1000,
    maxBytes = 1024 * 1024,
    enabled = true,
    // 主线程卡死的原因几乎总是主进程自己的同步 JS(例如解析一个超大的 SSE
    // 事件),不是 GPU。杀 GPU 进程救不了它,反而会因为合成器失去 GPU 进程
    // 而让窗口变黑变白。默认只记录、不杀;确实要当作重启尝试时再打开。
    killGpu: killGpuRequested = false
  } = options;

  const logPath = path.join(dataDir, logFileName);
  // --inspect / --inspect-brk 下主线程会因为断点而长时间静止,那是预期的,不能
  // 因此杀掉 GPU 进程。
  const debugging = process.execArgv.concat(process.argv).some(arg => /^--inspect(-brk)?(=|$)/.test(String(arg)));
  const killGpu = enabled && killGpuRequested && !debugging;

  const sab = new SharedArrayBuffer(SAB_BYTES);
  const i64 = new BigInt64Array(sab, 0, 8);
  const i32 = new Int32Array(sab, 64, 8);
  const labelBytes = new Uint8Array(sab, LABEL_OFFSET, LABEL_BYTES);
  const encoder = new TextEncoder();

  let worker = null;
  let timer = null;
  let ticks = 0;
  let blockingDepth = 0;
  let started = false;

  function mark(label) {
    const text = String(label || '').slice(0, MAX_LABEL_CHARS);
    const bytes = encoder.encode(text);
    const length = Math.min(bytes.length, LABEL_BYTES);
    // 先清零长度,worker 读到 0 就当作"未知",不会读到写了一半的标签。
    Atomics.store(i32, 0, 0);
    labelBytes.set(bytes.subarray(0, length));
    Atomics.store(i64, 4, BigInt(Date.now()));
    Atomics.store(i32, 0, length);
  }

  function refreshMetrics() {
    try {
      const memory = process.memoryUsage();
      Atomics.store(i64, 1, BigInt(Math.max(0, Math.round(memory.rss / 1048576))));
    } catch { /* 采样失败不影响心跳 */ }
    try {
      const metrics = app && typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : null;
      if (Array.isArray(metrics)) {
        const gpu = metrics.find(entry => entry && entry.type === 'GPU');
        Atomics.store(i64, 2, BigInt(gpu && gpu.pid ? gpu.pid : 0));
      }
    } catch { /* 同上 */ }
  }

  function tick() {
    ticks += 1;
    if (ticks === 1 || ticks % 10 === 0) refreshMetrics();
    Atomics.store(i64, 0, BigInt(Date.now()));
  }

  function note(text, extra) {
    const message = String(text == null ? '' : text);
    console.log(`[hang-guard] ${message}`);
    if (!worker) return;
    try { worker.postMessage({ type: 'note', text: message, extra: safeExtra(extra) }); } catch { /* 哨兵不能反噬主线程 */ }
  }

  function markPhase(label) {
    mark(label);
    if (!worker) return;
    try { worker.postMessage({ type: 'mark', text: String(label || '').slice(0, MAX_LABEL_CHARS) }); } catch { /* 同上 */ }
  }

  function enterBlocking() {
    blockingDepth += 1;
    Atomics.store(i32, 1, blockingDepth);
  }

  function exitBlocking() {
    blockingDepth = Math.max(0, blockingDepth - 1);
    Atomics.store(i32, 1, blockingDepth);
  }

  // 包住预期会阻塞事件循环的原生调用(模态对话框、同步文件选择框)。期间的
  // 停滞只记录,绝不触发 GPU 终止。
  function whileBlocking(label, fn) {
    mark(`blocking:${String(label || '').slice(0, 60)}`);
    enterBlocking();
    try { return fn(); } finally { exitBlocking(); }
  }

  function start() {
    if (!enabled || started) return;
    started = true;
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch { /* 目录建不出来时哨兵静默降级 */ }
    Atomics.store(i32, 3, 1);
    Atomics.store(i64, 3, BigInt(Date.now()));
    Atomics.store(i64, 0, BigInt(Date.now()));
    refreshMetrics();
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { sab, logPath, softMs, hardMs, pollMs, maxKills, killCooldownMs, killGpu, maxBytes }
      });
      // 哨兵必须永远不阻止应用退出。
      worker.unref();
      worker.on('error', error => console.error('[hang-guard] worker error:', error && error.message ? error.message : error));
    } catch (error) {
      worker = null;
      console.error('[hang-guard] worker 启动失败,仅保留心跳:', error && error.message ? error.message : error);
    }
    timer = setInterval(tick, tickMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (!started) return;
    started = false;
    Atomics.store(i32, 3, 0);
    if (timer) { clearInterval(timer); timer = null; }
    const instance = worker;
    worker = null;
    if (!instance) return;
    try { instance.postMessage({ type: 'stop' }); } catch { /* 已经在退出 */ }
    try { instance.terminate(); } catch { /* 同上 */ }
  }

  return { start, stop, mark: markPhase, note, whileBlocking, logPath };
}

module.exports = { createHangGuard, HANG_LOG_NAME };
