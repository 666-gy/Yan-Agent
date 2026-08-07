'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const sourceConfigPath = path.resolve(String(
  process.env.YAN_E2E_CONFIG_PATH
    || path.join(process.env.APPDATA || '', 'yan-agent', 'YanData', 'config.json')
));
const targetPath = path.resolve(String(
  process.env.YAN_E2E_TARGET_PATH
    || path.join(process.env.USERPROFILE || '', 'Desktop', 'bicycle-race-3d.html')
));
const timeoutMs = Math.max(30_000, Math.min(600_000, Number(process.env.YAN_E2E_MODEL_TIMEOUT_MS) || 300_000));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-model-e2e-'));
const screenshotPath = path.join(os.tmpdir(), `yan-browser-model-${Date.now()}.png`);

function prepareIsolatedConfig() {
  assert.ok(fs.existsSync(sourceConfigPath), `Yan config is missing: ${sourceConfigPath}`);
  assert.ok(fs.existsSync(targetPath), `Browser test page is missing: ${targetPath}`);
  const config = JSON.parse(fs.readFileSync(sourceConfigPath, 'utf8'));
  config.workspace = '';
  config.agent = { ...(config.agent || {}), accessMode: 'full', workMode: 'normal' };
  const targetDir = path.join(userDataDir, 'YanData');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  return {
    provider: String(config.api?.provider || ''),
    model: String(config.api?.model || '')
  };
}

async function captureTargetPage(page) {
  const dataUrl = await page.evaluate(async expectedPath => {
    const controllers = [...browserTabControllers.values()];
    const controller = controllers.find(item => {
      const current = String(item.webview?.getURL?.() || item.currentUrl || '');
      return current.includes(expectedPath.split('\\').join('/'));
    }) || controllers.at(-1);
    if (!controller?.webview?.capturePage) return '';
    const image = await controller.webview.capturePage();
    return image?.toDataURL?.() || '';
  }, targetPath);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return '';
  fs.writeFileSync(screenshotPath, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
  return screenshotPath;
}

(async () => {
  const selection = prepareIsolatedConfig();
  let application;
  const startedAt = Date.now();
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
      typeof executeBrowserAgentCommand === 'function'
      && typeof window.yan?.openCodeStartRun === 'function'
    ));

    const prompt = [
      `只使用 Yan 内置浏览器打开本地网页 ${targetPath}。`,
      '点击“开始比赛”，等待 4000ms，只持续按住一次上方向键 1800ms。',
      '随后调用一次内置浏览器截图，再读取一次页面；依据截图工具返回的视觉报告以及页面速度和时间判断赛车是否真的前进，然后立即结束。',
      '不要继续加速、不要跑完整圈、不要修改任何文件、不要使用外部浏览器，也不要把事件到达或 Canvas 颜色变化单独当成测试成功。'
    ].join('\n');
    const runId = `browser-model-e2e-${Date.now()}`;
    const outcome = await page.evaluate(async ({ runId: id, prompt: taskPrompt, timeout }) => {
      const eventTypes = [];
      return new Promise(async (resolve, reject) => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          removeEvent?.();
          removeCompleted?.();
          resolve({ ...value, eventTypes });
        };
        const removeEvent = window.yan.onOpenCodeEvent(detail => {
          if (detail?.runId !== id) return;
          const type = String(detail.event?.type || '');
          if (type && eventTypes.length < 500) eventTypes.push(type);
        });
        const removeCompleted = window.yan.onOpenCodeCompleted(detail => {
          if (detail?.runId !== id) return;
          finish({ start: { ok: true, runId: id }, result: detail.result || {} });
        });
        const timer = setTimeout(async () => {
          try { await window.yan.openCodeCancelRun(id); } catch {}
          reject(new Error(`Real model browser test timed out after ${timeout}ms`));
        }, timeout);
        try {
          const start = await window.yan.openCodeStartRun({
            runId: id,
            yanSessionId: id,
            title: 'Real DeepSeek built-in browser test',
            prompt: taskPrompt,
            attachments: [],
            selectedSkills: [],
            history: [],
            workspace: '',
            workMode: 'normal'
          });
          if (!start?.ok) finish({ start, result: null });
        } catch (error) {
          reject(error);
        }
      });
    }, { runId, prompt, timeout: timeoutMs });

    assert.equal(outcome.start?.ok, true, outcome.start?.error || 'OpenCode run failed to start');
    assert.ok(outcome.result, 'OpenCode run returned no result');
    const capturedScreenshotPath = await captureTargetPage(page);
    const completedVisualScreenshot = (outcome.result.toolCalls || []).find(call => {
      if (String(call.name || '') !== 'yan_browser_browser_screenshot' || !call.ok) return false;
      try {
        const parsed = JSON.parse(String(call.output || ''));
        return parsed.visualEvidence?.available === true;
      } catch {
        return false;
      }
    });
    assert.ok(completedVisualScreenshot, 'No browser screenshot returned a successful visual relay report.');
    const tools = (outcome.result.toolCalls || []).map(call => ({
      name: String(call.name || ''),
      status: String(call.status || ''),
      ok: !!call.ok,
      args: call.args || {},
      output: (() => {
        const raw = String(call.output || '');
        if (String(call.name || '') !== 'yan_browser_browser_screenshot') return raw.slice(0, 900);
        try {
          const parsed = JSON.parse(raw);
          return JSON.stringify({
            ok: parsed.ok,
            capturedAt: parsed.capturedAt,
            captureState: parsed.captureState,
            visualEvidence: parsed.visualEvidence ? {
              ...parsed.visualEvidence,
              report: String(parsed.visualEvidence.report || '').slice(0, 1800)
            } : null
          });
        } catch {
          return raw.slice(0, 900);
        }
      })()
    }));
    process.stdout.write(`${JSON.stringify({
      ok: outcome.result.status === 'done',
      provider: selection.provider,
      model: selection.model,
      durationMs: Date.now() - startedAt,
      status: outcome.result.status,
      text: String(outcome.result.text || ''),
      error: String(outcome.result.error || ''),
      usage: outcome.result.usage || {},
      tools,
      eventTypes: outcome.eventTypes,
      screenshotPath: capturedScreenshotPath
    })}\n`);
    if (outcome.result.status !== 'done') process.exitCode = 1;
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
