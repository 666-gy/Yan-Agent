'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('real kernel executes a durable workflow through plugin tools and restores accepted results', { timeout: 90000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workflow-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: directory });
  let sequence = 0, children = 0;
  const operations = [], events = [], errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      const finish = content => { send({ role: 'assistant', content }); send({}, 'stop'); res.end('data: [DONE]\n\n'); };
      const tool = (name, args) => {
        operations.push(name);
        assert.ok(body.tools.some(t => t.function?.name === name), `Missing tool ${name}`);
        send({ role: 'assistant', tool_calls: [{ index: 0, id: `workflow-${++sequence}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
        send({}, 'tool_calls'); res.end('data: [DONE]\n\n');
      };
      const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
      if (user.includes('WF_CHILD_BUILD') || user.includes('WF_CHILD_REVIEW')) {
        children++;
        assert.ok(!body.tools.some(t => t.function?.name === 'workflow_plan'), 'Child cannot orchestrate');
        return finish('Verified child deliverable');
      }
      const run = [...adapter.runs.values()].find(r => !adapter.delegation.context(r.id));
      const state = run.workflow;
      if (!state) return tool('workflow_plan', { goal: 'Build then independently review', members: [{ id: 'builder', name: 'Builder' }, { id: 'reviewer', name: 'Reviewer' }], stages: [{ id: 'build', title: '编写网页' }, { id: 'review', title: '独立验收' }], tasks: [
        { id: 'build', stageId: 'build', memberId: 'builder', title: '编写 hero', prompt: 'WF_CHILD_BUILD', acceptance: 'Deliver responsive implementation', dependsOn: [], writeScopes: ['hero.html'] },
        { id: 'review', stageId: 'review', memberId: 'reviewer', title: '验收 hero', prompt: 'WF_CHILD_REVIEW', acceptance: 'Independent checks pass', dependsOn: ['build'], writeScopes: [] }
      ] });
      if (state.tasks.every(task => task.status === 'accepted')) return finish('WORKFLOW_ACCEPTED');
      if (!state.active) return tool('workflow_run', { revision: state.revision });
      const submitted = state.tasks.find(task => task.status === 'awaiting_review');
      if (submitted) return tool('workflow_review', { revision: state.revision, taskId: submitted.id, attempt: submitted.attempts.at(-1).number, decision: 'accept', evidence: 'Inspected the fixture deliverable' });
      const ids = adapter.delegation.currentChildren(run).filter(child => !child.settled).map(child => child.agentID);
      if (sequence > 25) throw new Error('Workflow failed to progress: ' + JSON.stringify(state));
      return tool('wait_agents', { ids, timeout_ms: 1000 });
    } catch (error) { errors.push(error); res.destroy(error); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: directory }), dsml: false, accessMode: 'full' };
  const request = { ...options, delegationReturn: true, runId: 'workflow-probe', workspace: directory, hasUserWorkspace: true, prompt: 'Execute the planned workflow.', openCodeConfig: buildOpenCodeConfig(options) };
  const result = await adapter.run(request, event => events.push(event));
  assert.deepEqual(errors, []);
  assert.equal(result.status, 'done', result.error);
  assert.equal(result.delegation.workflow.status, 'completed');
  assert.deepEqual(result.delegation.reports, [], 'accepted workflow results must not open a redundant desktop continuation');
  assert.equal(children, 2);
  assert.ok(operations.includes('workflow_plan') && operations.includes('workflow_run') && operations.filter(n => n === 'workflow_review').length === 2);
  assert.ok(events.some(event => event.type === 'yan.workflow.updated'));
  const saved = await adapter.client.session.get({ sessionID: result.openCodeSessionId });
  assert.equal(saved.metadata.yanWorkflow.tasks[1].status, 'accepted');
  const resumed = await adapter.run({ ...request, runId: 'workflow-restored', openCodeSessionId: result.openCodeSessionId, prompt: 'Report the existing workflow result.' });
  assert.equal(resumed.delegation.workflow.status, 'completed');
  assert.equal(children, 2, 'Restore never replays child work');
});
