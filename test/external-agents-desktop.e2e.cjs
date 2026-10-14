'use strict';
// Explicit live test: this opens a real desktop chat and uses its signed-in
// model. Run one provider at a time; never retry a submitted test automatically.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const { ExternalAgentService } = require('../lib/external-agents/service');
const provider = process.argv.find(a => a.startsWith('--provider='))?.split('=')[1];
if (!['claude', 'codex'].includes(provider)) throw new Error('Specify --provider=claude or --provider=codex to run a live desktop test');
// Explicit follow-up mode uses the SAME production binding and resume path.
// Import only the selected completed job into the isolated test service; do
// not replace the native transport with a send-to-current-window test double.
const reuseDir = process.argv.find(a => a.startsWith('--reuse-session-job='))?.slice('--reuse-session-job='.length);
let reuse;
let reuseState;
if (reuseDir) {
  reuse = JSON.parse(fs.readFileSync(path.join(reuseDir, 'request.json'), 'utf8'));
  assert.equal(reuse.provider, provider);
  reuseState = JSON.parse(fs.readFileSync(path.join(reuseDir, 'state.json'), 'utf8'));
  assert.equal(reuseState.status, 'succeeded');
  assert.equal(reuseState.deliveryVerified, true);
  assert.ok(reuseState.externalSessionId && reuseState.journalFile);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), `yan-live-desktop-${provider}-`));
const workspace = path.resolve(__dirname, '..');
const config = { externalAgents: { enabled: true, providers: { [provider]: { enabled: true } } } };
const service = new ExternalAgentService({ dataDir: root, loadConfig: () => config });
if (reuse) {
  assert.equal(fs.realpathSync(reuse.workspace), fs.realpathSync(workspace));
  const destination = require('../lib/external-agents/storage').jobDir(service.root, reuse.id);
  fs.mkdirSync(destination);
  for (const name of ['request.json', 'state.json', 'input.txt', 'delivery.txt', 'result.txt']) {
    fs.copyFileSync(path.join(reuseDir, name), path.join(destination, name));
  }
}
const context = { sessionId: `desktop-e2e-${Date.now()}`, workspace, readOnly: true };
const expected = `YAN_DESKTOP_RESULT_${Date.now()}`;
(async () => {
  const job = service.dispatch(context, { provider, request_key: expected, read_only: true,
    prompt: `这是 Yan 桌面协同端到端测试。只读取当前工作目录，不修改任何文件，不切换目录，不创建 worktree。请返回：${expected}、当前工作目录绝对路径，以及“中文完整返回😀”。` });
  console.log(JSON.stringify({ dataDir: root, jobId: job.job_id, provider, expected }));
  if (reuse) {
    assert.equal(job.reused_session, true);
    assert.equal(job.session_source_job_id, reuse.id);
  }
  let last = '';
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    const result = service.result(context, job.job_id);
    const progress = JSON.stringify({ status: result.status, progress: result.progress, error: result.error, session: result.external_session_id });
    if (progress !== last) { console.log(progress); last = progress; }
    if (result.terminal) {
      console.log(JSON.stringify({ result: result.output }));
      assert.equal(result.status, 'succeeded');
      assert.ok(result.output.includes(expected));
      assert.ok(result.output.includes(workspace));
      assert.ok(result.output.includes('中文完整返回😀'));
      assert.equal(service.record(job.job_id).deliveryVerified, true);
      if (reuse) assert.equal(result.external_session_id, reuseState.externalSessionId);
      assert.ok(fs.existsSync(path.join(root, 'external-agents/jobs', job.job_id, 'assignment-send.intent')), 'the native bridge must click Send itself');
      console.log(reuse ? 'PASS real GUI automatic follow-up, workspace, full receipt and result in the authorized desktop chat'
        : 'PASS real desktop dispatch, workspace, full receipt and result');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Test observation window ended; original desktop job is preserved and must not be resubmitted');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => service.close());
