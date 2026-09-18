'use strict';

// AGI 模式对比实测：同一任务、同一模型，normal 与 agi 各跑一次真实运行。
// 产物：每次 run 的 sidepath brief、工具调用序列、delivery verdict、时长；
// 汇总写入 output/agi-live-test-report.json。
//
// 用法:
//   node scripts/agi-live-test.cjs                     # normal + agi 各一次
//   node scripts/agi-live-test.cjs --mode agi          # 只跑 agi
//   node scripts/agi-live-test.cjs --task "自定义任务"  # 覆盖默认任务
//
// 直接驱动 lib/opencode-sidecar（不经 Electron 主进程），使用真实用户配置的
// 模型与密钥；每次 run 使用独立的临时 dataDir，不触碰正在运行的 Yan 实例。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { OpenCodeSidecar, buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const { sidepathCeiling } = require('../lib/agi/reasoning-sidepath');

const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(process.env.APPDATA, 'yan-agent', 'YanData', 'config.json');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const MODES = argOf('--mode', 'normal,agi').split(',').map(item => item.trim()).filter(Boolean);
const TASK = argOf('--task', '写一个单文件 HTML 番茄钟计时器：25 分钟倒计时、开始/暂停/重置三个按钮、环形进度动画、结束时有提示动画。直接交付一个完整的 timer.html。');

function loadProviderConfig() {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const agentModel = cfg.agentModel || {};
  const modelId = agentModel.modelId || cfg.api?.model;
  const providerConfigs = cfg.api?.providerConfigs || {};
  // providerConfigs 的 key 才是内核侧 provider id（conn-xxx 是 UI 连接层 id）。
  const usable = Object.entries(providerConfigs).filter(([, value]) => value?.apiKey && value?.baseUrl);
  if (!usable.length) throw new Error('providerConfigs 里没有同时具备 apiKey+baseUrl 的供应商');
  const [providerKey, providerConfig] = usable.find(([key]) => /deepseek/i.test(key)) || usable[0];
  return {
    providerId: providerKey,
    modelId,
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    capabilities: agentModel.capabilities || {},
    permissions: cfg.permissions || { allowFileRead: true, allowFileWrite: true, allowShell: true, allowNetwork: true }
  };
}

async function runOnce(mode, provider, runIndex) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `yan-agi-live-${mode}-`));
  const workspace = path.join(dataDir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const sidecar = new OpenCodeSidecar({
    appRoot: repoRoot,
    dataDir: path.join(dataDir, 'data'),
    log: { info: () => {}, warn: () => {}, error: console.error },
    maxKernels: 1
  });
  const events = [];
  const runtimeConfig = buildOpenCodeConfig({
    providerId: provider.providerId,
    providerName: provider.providerId,
    modelId: provider.modelId,
    modelName: provider.modelId,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    capabilities: provider.capabilities,
    mcpServers: [],
    enableSubagents: false,
    accessMode: 'request'
  });
  const runId = `agi-live-${mode}-${crypto.randomUUID().slice(0, 8)}`;
  const request = {
    runId,
    prompt: TASK,
    workspace,
    directory: workspace,
    hasUserWorkspace: true,
    providerId: provider.providerId,
    modelId: provider.modelId,
    workMode: mode,
    history: [],
    utility: false,
    skillOnly: false,
    accessMode: 'request',
    enableSubagents: false,
    permissions: provider.permissions,
    reasoningSidepath: {
      required: true,
      followupRound: false,
      ceiling: sidepathCeiling({ workMode: mode })
    }
  };
  const onEvent = event => {
    const type = String(event?.type || '');
    if (type.startsWith('yan.')) {
      events.push({ type, data: event.data || event.properties || {} });
    }
  };
  const startedAt = Date.now();
  try {
    await sidecar.start(runtimeConfig);
    const result = await sidecar.run(request, onEvent);
    const elapsedMs = Date.now() - startedAt;
    const sidepath = result?.sidepath || null;
    const brief = sidepath?.brief || null;
    const review = result?.delivery?.review || null;
    const summary = {
      mode,
      runId,
      elapsedMs,
      status: result?.status || '',
      textHead: String(result?.text || '').replace(/\s+/g, ' ').slice(0, 240),
      sidepath: sidepath ? {
        required: sidepath.required === true,
        mode: sidepath.mode || '',
        hasBrief: Boolean(brief),
        methods: brief?.methods || [],
        relations: (brief?.relations || []).length,
        constraints: (brief?.constraints || []).length,
        candidates: (brief?.candidates || []).length,
        verificationChecks: (brief?.verification || []).length,
        userIntent: String(brief?.userIntent || '').slice(0, 80),
        blocked: Number(sidepath.blocked) || 0,
        degraded: sidepath.degraded === true,
        errors: sidepath.errors || []
      } : null,
      delivery: result?.delivery ? {
        intent: result.delivery.intent || '',
        artifact: result.delivery.artifact || '',
        verdict: review?.verdict || null,
        criteriaStatuses: review?.criteria
          ? Object.fromEntries(Object.entries(review.criteria).map(([field, item]) => [field, item.status]))
          : null,
        reviewDropped: Boolean(result.delivery.reviewIssues?.blockSeen),
        failure: String(result.delivery.failure || '')
      } : null,
      artifactAudit: result?.artifactAudit
        ? { files: (result.artifactAudit.files || []).map(entry => ({ ok: entry.ok, missing: entry.missing })), interjected: result.artifactAudit.interjected }
        : null,
      yanEvents: events.map(event => event.type),
      briefFull: brief
    };
    fs.writeFileSync(path.join(dataDir, 'summary.json'), JSON.stringify(summary, null, 2));
    return { summary, dataDir };
  } finally {
    try { sidecar.close(); } catch {}
  }
}

(async () => {
  const provider = loadProviderConfig();
  console.log(`[agi-live] provider=${provider.providerId} model=${provider.modelId} baseUrl=${provider.baseUrl}`);
  console.log(`[agi-live] task: ${TASK}`);
  const report = [];
  for (const [index, mode] of MODES.entries()) {
    console.log(`\n===== run ${index + 1}/${MODES.length}: workMode=${mode} =====`);
    try {
      const { summary, dataDir } = await runOnce(mode, provider, index);
      const { briefFull, ...rest } = summary;
      console.log(JSON.stringify(rest, null, 1));
      console.log(`[agi-live] artifacts: ${dataDir}`);
      report.push(summary);
    } catch (error) {
      console.error(`[agi-live] run ${mode} failed: ${error?.message || error}`);
      report.push({ mode, error: String(error?.message || error) });
    }
  }
  const reportPath = path.join(repoRoot, 'output', 'agi-live-test-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n[agi-live] report written: ${reportPath}`);
})().catch(error => {
  console.error('[agi-live] fatal:', error);
  process.exit(1);
});
