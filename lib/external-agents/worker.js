'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { atomic, read, TERMINAL, alive, hash } = require('./storage');
const { probe } = require('./adapters');
const desktop = require('./desktop');
const { Journal, discover } = require('./journal');
const { prepare } = require('./payload');
const sessions = require('./sessions');

async function run(dir, { driver = desktop.invoke, detect = probe, journalRoot, interval = 2000, signal, sessionRoots } = {}) {
  if (read(path.join(dir, 'request.json')).transport === 'reasonix-host-v1') return require('./reasonix-worker').run(dir);
  const file = path.join(dir, 'state.json');
  if (TERMINAL.has(read(file).status)) return;
  const request = read(path.join(dir, 'request.json'));
  if (request.transport !== 'desktop-gui-v1') {
    // Never revive old CLI jobs through the new GUI transport.
    if (['queued', 'starting'].includes(read(file).status)) atomic(file, { ...read(file), status: 'blocked', endedAt: Date.now(), error: '旧版任务没有桌面会话绑定，不能自动恢复派发' });
    return;
  }
  const lock = path.join(dir, 'worker.lock');
  const owner = crypto.randomUUID();
  try {
    if (fs.existsSync(lock)) {
      let previous; try { previous = read(lock); } catch {}
      if (alive(previous?.pid) || Date.now() - fs.statSync(lock).mtimeMs < 30000) return;
      fs.unlinkSync(lock);
    }
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, owner }), { flag: 'wx', mode: 0o600 });
  } catch (error) { if (error.code === 'EEXIST') return; throw error; }
  const update = patch => {
    const current = read(file);
    if (TERMINAL.has(current.status)) return current;
    const state = { ...current, ...patch, workerPid: process.pid, heartbeatAt: Date.now() };
    atomic(file, state); return state;
  };
  const heartbeat = setInterval(() => update({}), 2000);
  const handshake = sessions.handshake(request.id);
  const continuation = read(file).continuation || null;
  let targetSessionId;
  let input;
  const openAttempt = path.join(dir, 'open-attempt.json');
  const submitAttempt = path.join(dir, 'submit-attempt.json');
  let bound;
  const opening = executable => ({ action: continuation ? 'resume' : 'open', provider: request.provider, executable,
    url: continuation ? desktop.sessionLink(request.provider, targetSessionId) : desktop.link(request.provider, request.workspace, handshake), text: handshake,
    ...(continuation ? { marker: continuation.kind === 'history' ? continuation.marker : `YAN_READY_${continuation.sourceJobId}`,
      historyTarget: continuation.kind === 'history' } : {}),
    openIntent: path.join(dir, 'navigate.intent'), intent: path.join(dir, 'handshake-send.intent') });
  let lastGuiAttempt = 0;
  const assignmentCommand = state => ({ action: 'send', provider: request.provider, executable: state.executable,
    // The user may have switched chats while the handshake was running.
    // Return to our exact verified session before testing its nonce and sending.
    ...(request.provider === 'codex' ? { url: desktop.sessionLink('codex', bound.journal.sessionId) } : {}),
    marker: `YAN_READY_${request.id}`, text: input, intent: path.join(dir, 'assignment-send.intent') });
  const interact = async (command, stage) => {
    lastGuiAttempt = Date.now();
    update({ guiRetrySafe: false, guiStage: stage });
    try { await driver(command, dir); update({ needsAttention: false, actionUncertain: false, error: '' }); }
    catch (error) {
      if (fs.existsSync(command.intent)) {
        update({ status: 'uncertain', needsAttention: false, guiRetrySafe: false, actionUncertain: true,
          error: error.message, progress: '已记录发送动作，等待原桌面日志确认；不会再次点击发送' });
        return;
      }
      if (error.beforeSend !== true) throw error;
      update({ status: 'uncertain', needsAttention: true, guiRetrySafe: true,
        error: error.message, progress: '等待桌面输入条件满足或用户处理应用提示；尚未点击发送' });
    }
  };
  try {
    input = fs.readFileSync(path.join(dir, 'input.txt'), 'utf8');
    if (hash(input) !== request.inputHash || Buffer.byteLength(input) !== request.inputBytes) throw new Error('已保存的完整任务校验失败，未派发');
    const payload = prepare(dir, request, input);
    input = payload.text;
    update({ deliveryHash: payload.sha256, deliveryBytes: payload.bytes });
    let state = update({ progress: continuation ? '正在继续此工作区的原桌面任务' : '正在连接桌面会话', error: '' });
    if (continuation) {
      if (continuation.kind === 'history') {
        await require('./history').validateHistoryTarget(continuation, request.workspace,
          { allowRunning: fs.existsSync(path.join(dir, 'handshake-send.intent')) });
      } else sessions.validateContinuation(dir, request, continuation);
      // Resolve the GUI id again on restart; archived/deleted sessions never
      // degrade into a new task. After send, only the bound journal is needed.
      if (!fs.existsSync(path.join(dir, 'handshake-send.intent'))) {
        targetSessionId = sessions.desktopSession(request.provider, continuation.externalSessionId, request.workspace, sessionRoots);
      }
      if (state.journalFile && state.journalFile !== continuation.journalFile) throw new Error('恢复的日志与原桌面任务关联不一致');
      state = update({ journalFile: continuation.journalFile, externalSessionId: continuation.externalSessionId,
        ...(targetSessionId ? { desktopSessionId: targetSessionId } : {}) });
    }
    if (state.journalFile) {
      bound = { file: state.journalFile, journal: new Journal(request.provider, request.workspace, handshake, input) };
      bound.journal.poll(bound.file);
      if (continuation && bound.journal.sessionId !== continuation.externalSessionId) throw new Error('原桌面日志的会话编号发生变化，已停止续写');
    }
    if (!bound?.journal.handshakeSeen && !fs.existsSync(openAttempt)) {
      if (fs.existsSync(path.join(dir, 'cancel.json'))) { update({ status: 'cancelled', endedAt: Date.now() }); return; }
      const found = await detect(request.provider, request.executable);
      if (!found.installed) throw new Error(found.error || '未找到桌面程序');
      update({ executable: found.executable });
      atomic(openAttempt, { at: Date.now() });
      await interact(opening(found.executable), 'handshake');
    }
    while (!signal?.aborted) {
      state = read(file);
      if (TERMINAL.has(state.status)) return;
      if (!bound) {
        bound = discover(request.provider, request.workspace, handshake, input, request.createdAt, journalRoot);
        if (bound) update({ journalFile: bound.file, externalSessionId: bound.journal.sessionId });
      } else bound.journal.poll(bound.file);
      const journal = bound?.journal;
      if (continuation && journal && journal.sessionId !== continuation.externalSessionId) throw new Error('原桌面日志的会话编号发生变化，已停止续写');
      if (journal?.status && TERMINAL.has(journal.status)) {
        fs.writeFileSync(path.join(dir, 'result.txt'), journal.output || journal.error, { mode: 0o600 });
        update({ status: journal.status, error: journal.error, endedAt: Date.now(),
          deliveryVerified: journal.inputSeen, needsAttention: false, guiRetrySafe: false,
          progress: '桌面会话已返回结果' }); return;
      }
      const cancelling = fs.existsSync(path.join(dir, 'cancel.json'));
      if (cancelling && !fs.existsSync(path.join(dir, 'assignment-send.intent')) &&
          (!fs.existsSync(submitAttempt) || read(file).guiRetrySafe) &&
          (journal?.ready || !fs.existsSync(path.join(dir, 'handshake-send.intent')))) {
        update({ status: 'cancelled', endedAt: Date.now(), progress: '已取消，正式任务尚未发送' }); return;
      }
      state = read(file);
      if (!journal?.handshakeSeen && state.guiRetrySafe && state.guiStage === 'handshake' && Date.now() - lastGuiAttempt >= 5000 && !fs.existsSync(path.join(dir, 'handshake-send.intent'))) {
        await interact(opening(state.executable), 'handshake');
      }
      if (journal?.ready && !fs.existsSync(submitAttempt)) {
        atomic(submitAttempt, { at: Date.now(), sessionId: journal.sessionId, inputHash: payload.sha256 });
        update({ progress: '工作区已核对，正在发送完整任务' });
        await interact(assignmentCommand(read(file)), 'assignment');
      } else if (journal?.ready && state.guiRetrySafe && state.guiStage === 'assignment' && Date.now() - lastGuiAttempt >= 5000 && !fs.existsSync(path.join(dir, 'assignment-send.intent'))) {
        await interact(assignmentCommand(state), 'assignment');
      }
      const elapsed = Date.now() - request.createdAt;
      const verified = journal?.inputSeen === true;
      state = read(file);
      update({ status: state.needsAttention || journal?.status === 'uncertain' || (!verified && (state.actionUncertain || elapsed > 60000)) ? 'uncertain' : verified ? 'running' : 'starting',
        needsAttention: state.needsAttention || journal?.status === 'uncertain',
        cancelRequested: cancelling, deliveryVerified: verified,
        ...(verified ? { lastActivityAt: fs.statSync(bound.file).mtimeMs } : {}),
        progress: cancelling ? '请在对应桌面会话中停止任务；Yan 继续等待明确的停止或完成记录' : state.needsAttention ? state.progress : verified ? '桌面端已完整接收任务，正在等待结果（无任务超时）' : '等待桌面握手或完整输入确认；不会重新发送',
        error: journal?.error || (state.needsAttention ? state.error : '') });
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  } catch (error) {
    const sent = fs.existsSync(path.join(dir, 'handshake-send.intent')) || fs.existsSync(path.join(dir, 'assignment-send.intent')) || (fs.existsSync(submitAttempt) && error.beforeSend !== true);
    update({ status: sent ? 'uncertain' : 'blocked', error: error.message,
      ...(sent ? {} : { endedAt: Date.now() }), progress: sent ? '发送结果不确定，将恢复监听原会话，绝不重新发送' : '正式任务未发送' });
  } finally {
    clearInterval(heartbeat);
    try { if (read(lock).owner === owner) fs.unlinkSync(lock); } catch {}
  }
}
if (require.main === module) run(process.argv[2]).catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
module.exports = { run };
