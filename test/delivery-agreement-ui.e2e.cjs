'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-delivery-agreement-e2e-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => (
      typeof createRunCtx === 'function'
      && typeof applyOpenCodeEvent === 'function'
      && typeof extractDeliveryAgreement === 'function'
      && typeof openCodeResultToAgentRun === 'function'
    ));

    const result = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      setEmptyState(false);
      const runCtx = createRunCtx(session.id, true, session.workspace || '');
      runCtx.activeAgentRun = { runId: runCtx.runId, status: 'working', timeline: [] };
      runCtx.openCodePhase = 'work';
      runCtx.openCodePartTypes = new Map();
      runCtx.openCodePendingPartDeltas = new Map();
      runCtx.openCodeRawTextParts = new Map();
      runCtx.openCodeNextStreamIDs = new Set();
      runCtx.openCodeSuppressedPartIDs = new Set();
      runCtx.openCodeProtocolProbe = new Map();
      rebuildOpenCodeTimelineIndex(runCtx);

      const assistantEl = appendMessage('assistant', '');
      state.activeRuns.set(session.id, { sessionRef: session, runCtx, assistantEl });

      applyOpenCodeEvent(runCtx, {
        type: 'message.part.updated',
        data: { part: { id: 'delivery-part', type: 'text', text: '<yan-deliv' } }
      }, { deferEffects: true });
      renderOpenCodeRunNow(runCtx);
      const partialOpen = {
        visibleText: assistantEl.querySelector('.msg-body')?.innerText || '',
        agreementCount: assistantEl.querySelectorAll('.delivery-agreement-tool').length
      };

      applyOpenCodeEvent(runCtx, {
        type: 'message.part.delta',
        data: {
          partID: 'delivery-part',
          field: 'text',
          delta: 'ery-contract>\nintent: presentable（演示级单文件网页）\nartifact: frontend\nscope: 仅实现“3D 小岛”单页展示\ndirection: 宁静的海岛午后\ndecisions:\n海面与植被采用统一风向\n主体居中，远景保持简洁\nacceptance: 真实浏览器预览且页面可交互旋转\n</yan-delivery'
        }
      }, { deferEffects: true });
      renderOpenCodeRunNow(runCtx);
      const partialClose = {
        visibleText: assistantEl.querySelector('.msg-body')?.innerText || '',
        agreementCount: assistantEl.querySelectorAll('.delivery-agreement-tool').length
      };

      applyOpenCodeEvent(runCtx, {
        type: 'message.part.delta',
        data: { partID: 'delivery-part', field: 'text', delta: '-contract>\n我们开始实现。' }
      }, { deferEffects: true });
      renderOpenCodeRunNow(runCtx);

      const agreement = assistantEl.querySelector('.delivery-agreement-tool');
      const initiallyOpen = agreement.open;
      agreement.open = true;
      const agreementPanel = agreement.querySelector('.delivery-agreement-panel');
      const rows = Array.from(agreement.querySelectorAll('.delivery-agreement-field')).map(row => ({
        key: row.querySelector('.delivery-agreement-key')?.textContent,
        value: row.querySelector('.delivery-agreement-value')?.textContent
      }));
      const completedStream = {
        visibleText: assistantEl.querySelector('.msg-body')?.innerText || '',
        name: agreement.querySelector('.tool-activity-label')?.textContent,
        icon: agreement.querySelector('.tc-icon-svg')?.dataset.icon,
        iconStrokeWidth: agreement.querySelector('.tc-icon-svg svg')?.getAttribute('stroke-width'),
        labelMode: agreement.dataset.toolLabelMode,
        isOuterTool: agreement.classList.contains('tool-activity-group'),
        initiallyOpen,
        verification: agreement.dataset.deliveryVerification,
        statusChipPresent: !!agreement.querySelector('.delivery-agreement-status'),
        panelBorderWidth: getComputedStyle(agreementPanel).borderTopWidth,
        rows,
        contractItems: runCtx.activeAgentRun.timeline.filter(item => item.type === 'delivery_contract').length,
        textItems: runCtx.activeAgentRun.timeline.filter(item => item.type === 'text').map(item => item.content)
      };

      const currentContract = Object.fromEntries(rows.map(row => [row.key, row.value]));
      applyOpenCodeEvent(runCtx, { type: 'yan.delivery.contract.updated', data: { contract: currentContract, contractId: 'version-one' } }, { deferEffects: true });
      applyOpenCodeEvent(runCtx, { type: 'yan.delivery.acceptance.started', data: { round: 1 } }, { deferEffects: true });
      renderOpenCodeRunNow(runCtx);
      const checking = assistantEl.querySelector('.delivery-agreement-tool').dataset.deliveryVerification;
      applyOpenCodeEvent(runCtx, { type: 'yan.delivery.acceptance.passed', data: { contractId: 'stale-version' } }, { deferEffects: true });
      const staleStatus = openCodeTimelineItem(runCtx, 'delivery-contract').verification;
      const review = { criteria: { direction: { status: 'pass', evidence: '海面、树影和主体形成统一的午后场景' } } };
      applyOpenCodeEvent(runCtx, { type: 'yan.delivery.acceptance.passed', data: { contractId: 'version-one', review } }, { deferEffects: true });
      renderOpenCodeRunNow(runCtx);
      const verified = {
        status: assistantEl.querySelector('.delivery-agreement-tool').dataset.deliveryVerification,
        label: assistantEl.querySelector('.delivery-agreement-tool .tool-activity-label')?.textContent,
        evidence: assistantEl.querySelector('.delivery-agreement-evidence')?.textContent,
        normalized: normalizeDeliveryAgreementTimeline(runCtx.activeAgentRun.timeline).find(item => item.type === 'delivery_contract')?.verification
      };
      applyOpenCodeEvent(runCtx, { type: 'yan.delivery.contract.updated', data: { contract: { ...currentContract, direction: '风暴中的海岛' }, contractId: 'version-two' } }, { deferEffects: true });
      const revisedStatus = openCodeTimelineItem(runCtx, 'delivery-contract').verification;
      applyOpenCodeEvent(runCtx, { type: 'yan.delivery.acceptance.failed', data: { message: '尚未观察到统一风向' } }, { deferEffects: true });
      renderOpenCodeRunNow(runCtx);
      const failedStatus = openCodeTimelineItem(runCtx, 'delivery-contract').verification;
      const failedLabel = assistantEl.querySelector('.delivery-agreement-tool .tool-activity-label')?.textContent;

      const rawContract = '<yan-delivery-contract>\nintent: delivery\nartifact: backend\nscope: 保留现有 API\nacceptance: 本地测试通过\n</yan-delivery-contract>';
      const finalized = openCodeResultToAgentRun({
        status: 'done',
        text: `${rawContract}\n<yan-delivery-review>{"criteria":{}}</yan-delivery-review>\n最终完成。`,
        delivery: { contract: currentContract, contractId: 'version-three', verified: true, review },
        toolCalls: [],
        todos: []
      }, runCtx);

      const restoredEl = appendMessage('assistant', '');
      const restoredRun = JSON.parse(JSON.stringify(finalized));
      const restoredBody = restoredEl.querySelector('.msg-body');
      renderAgentRunBody(restoredBody, restoredRun, finalized.textContent);
      restoredBody.querySelector('.agent-run-header').dataset.workExpanded = 'true';
      renderAgentRunBody(restoredBody, restoredRun, finalized.textContent);
      const restored = {
        agreementCount: restoredEl.querySelectorAll('.delivery-agreement-tool').length,
        name: restoredEl.querySelector('.delivery-agreement-tool .tool-activity-label')?.textContent,
        visibleText: restoredEl.querySelector('.msg-body')?.innerText || '',
        persistedContract: restoredRun.timeline.find(item => item.type === 'delivery_contract')?.contract,
        verification: restoredEl.querySelector('.delivery-agreement-tool')?.dataset.deliveryVerification,
        textContent: finalized.textContent,
        contractItems: finalized.timeline.filter(item => item.type === 'delivery_contract').length
      };

      const loaderEl = appendMessage('assistant', '');
      renderAgentRunBody(loaderEl.querySelector('.msg-body'), {
        status: 'working',
        timeline: [{
          type: 'progress',
          variant: 'agent-loader',
          content: '',
          openCodeKey: 'model-wait'
        }]
      });
      const loaderCount = loaderEl.querySelectorAll('.agent-loader-note').length;

      // A completed body must survive collapsed work and history restoration,
      // even when the stream ends with unrelated progress or partial text.
      const finalBodies = [];
      for (const modelId of ['gpt-5.3', 'deepseek-v4-flash']) {
        for (const streamed of ['正在整理文件。', '最终正文。']) {
          const bodyCtx = createRunCtx(session.id, true, session.workspace || '');
          bodyCtx.modelId = modelId;
          bodyCtx.activeAgentRun = { runId: bodyCtx.runId, status: 'working', timeline: [
            { type: 'text', stage: 'work', content: streamed, streaming: true },
            { type: 'text', stage: 'work', content: '过程尾句。', streaming: false }
          ] };
          const completed = openCodeResultToAgentRun({
            status: 'done', text: '最终正文。', toolCalls: [], todos: [],
            delivery: { passive: true, skipped: true, verified: false, acceptanceRounds: 0 }
          }, bodyCtx);
          const element = appendMessage('assistant', '');
          const body = element.querySelector('.msg-body');
          const restoredBodyRun = JSON.parse(JSON.stringify(completed));
          renderAgentRunBody(body, restoredBodyRun, completed.textContent);
          finalBodies.push({
            modelId,
            summaryStarted: completed.summaryStarted,
            summaries: completed.timeline.filter(item => item.type === 'text' && item.stage === 'summary').map(item => item.content),
            visible: body.innerText,
            acceptanceCriteria: completed.acceptanceCriteria
          });
          element.remove();
        }
      }

      state.activeRuns.delete(session.id);
      assistantEl.remove();
      restoredEl.querySelector('.delivery-agreement-tool').open = true;
      loaderEl.remove();
      return {
        partialOpen,
        partialClose,
        completedStream,
        checking, staleStatus, verified, revisedStatus, failedStatus, failedLabel,
        restored,
        finalBodies,
        loaderCount,
        plainText: extractDeliveryAgreement('普通正文').text,
        legacyArtifact: extractDeliveryAgreement(rawContract).contract.artifact,
        aroundText: extractDeliveryAgreement(`合同前\n${rawContract}\n合同后`).text
      };
    });

    assert.equal(result.partialOpen.agreementCount, 0);
    assert.equal(result.partialClose.agreementCount, 0);
    assert.doesNotMatch(result.partialOpen.visibleText, /yan-deliv/i);
    assert.doesNotMatch(result.partialClose.visibleText, /yan-delivery/i);

    assert.equal(result.completedStream.name, 'Yan-Delivery-Agreement ·已完成');
    assert.equal(result.completedStream.icon, 'clock');
    assert.equal(result.completedStream.verification, 'recorded');
    assert.equal(result.completedStream.statusChipPresent, false);
    assert.equal(result.completedStream.labelMode, 'outer');
    assert.equal(result.completedStream.isOuterTool, true);
    assert.equal(result.completedStream.initiallyOpen, false);
    assert.ok(parseFloat(result.completedStream.panelBorderWidth) > 0);
    assert.equal(result.completedStream.contractItems, 1);
    assert.deepEqual(result.completedStream.rows.map(row => row.key), [
      'intent', 'artifact', 'scope', 'direction', 'decisions', 'acceptance'
    ]);
    assert.match(result.completedStream.rows[0].value, /^presentable/u);
    assert.equal(result.completedStream.rows[1].value, 'frontend');
    assert.match(result.completedStream.visibleText, /我们开始实现/u);
    assert.doesNotMatch(result.completedStream.visibleText, /yan-delivery-contract/i);
    assert.deepEqual(result.completedStream.textItems, ['我们开始实现。']);
    assert.equal(result.checking, 'checking');
    assert.equal(result.staleStatus, 'checking');
    assert.equal(result.verified.status, 'verified');
    assert.equal(result.verified.normalized, 'verified');
    assert.equal(result.verified.label, 'Yan-Delivery-Agreement ·已完成');
    assert.match(result.verified.evidence, /午后场景/u);
    assert.equal(result.revisedStatus, 'recorded');
    assert.equal(result.failedStatus, 'failed');
    assert.equal(result.failedLabel, 'Yan-Delivery-Agreement ·错误');

    assert.equal(result.restored.agreementCount, 1);
    assert.equal(result.restored.name, 'Yan-Delivery-Agreement ·已完成');
    assert.equal(result.restored.contractItems, 1);
    assert.equal(result.restored.textContent, '最终完成。');
    assert.equal(result.restored.persistedContract.artifact, 'frontend');
    assert.equal(result.legacyArtifact, 'backend');
    assert.equal(result.restored.verification, 'verified');
    assert.equal(result.restored.persistedContract.decisions, '海面与植被采用统一风向\n主体居中，远景保持简洁');
    assert.doesNotMatch(result.restored.visibleText, /yan-delivery-contract/i);
    assert.equal(result.loaderCount, 1);
    for (const body of result.finalBodies) {
      assert.equal(body.summaryStarted, true);
      assert.deepEqual(body.summaries, ['最终正文。']);
      assert.match(body.visible, /最终正文。/);
      assert.doesNotMatch(body.visible, /过程尾句。|正在整理文件。/);
      assert.deepEqual(body.acceptanceCriteria, []);
    }
    assert.equal(result.plainText, '普通正文');
    assert.equal(result.aroundText, '合同前\n\n合同后');

    fs.mkdirSync(path.join(appRoot, 'output'), { recursive: true });
    await page.locator('.delivery-agreement-tool').screenshot({ path: path.join(appRoot, 'output', 'delivery-agreement.png'), animations: 'disabled' });

    console.log('delivery agreement UI e2e passed');
  } finally {
    if (application) await application.close();
    if (path.resolve(userDataDir).startsWith(path.join(os.tmpdir(), 'yan-delivery-agreement-e2e-'))) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
