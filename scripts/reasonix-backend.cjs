'use strict';
// Paired desktop integration; pairing links are read from stdin, never argv.
const fs = require('fs');
const path = require('path');
const { connect, installation, pair } = require('../lib/external-agents/reasonix');
const { atomic } = require('../lib/external-agents/storage');
const { ExternalAgentService } = require('../lib/external-agents/service');
const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const dataDir = option('data-dir') || path.join(process.env.APPDATA || '', 'yan-agent', 'YanData');
const configFile = path.join(dataDir, 'config.json');
async function main() {
  if (!args.some(arg => ['--enable', '--probe', '--test', '--pair'].includes(arg))) throw new Error('使用 --enable、--probe、--pair 或 --test；可指定 --executable=绝对路径 和 --workspace=绝对路径');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const executable = option('executable') || config.externalAgents?.providers?.reasonix?.executable;
  installation(executable);
  if (args.includes('--enable')) {
    config.externalAgents = { ...config.externalAgents, enabled: true, providers: {
      ...config.externalAgents?.providers, reasonix: { enabled: true, executable }
    } };
    atomic(configFile, config);
    console.log('Reasonix 后端已启用；重启 Yan 以载入新工具与配置。');
  }
  if (args.includes('--pair')) {
    await pair(fs.readFileSync(0, 'utf8'), { dataDir });
    console.log('RS 桌面配对成功');
  }
  const workspace = fs.realpathSync(option('workspace') || process.cwd());
  if (args.includes('--probe')) {
    const client = await connect(executable, { dataDir });
    try {
      const runtimes = await client.request('/runtimes');
      console.log(JSON.stringify({ connected: true, transport: 'reasonix-desktop', desktopRuntimes: runtimes.length }));
    } finally { client.close(); }
  }
  if (args.includes('--test')) {
    const service = new ExternalAgentService({ dataDir, loadConfig: () => JSON.parse(fs.readFileSync(configFile, 'utf8')) });
    try {
      const marker = `YAN_REASONIX_TEST_${Date.now()}`;
      const context = { sessionId: marker, runId: marker, workspace, readOnly: true };
      const job = await service.delegate(context, { provider: 'reasonix', session_mode: 'new', request_key: marker,
        read_only: true, title: 'Reasonix 后端连通测试', prompt: `只回复“${marker} 中文完整返回😀”。不要使用工具，不修改文件。` });
      console.log(JSON.stringify({ job_id: job.job_id, expected: marker }));
      for (;;) {
        const result = service.result(context, job.job_id);
        if (result.terminal) {
          console.log(JSON.stringify(result));
          if (result.status !== 'succeeded' || !result.output.includes(marker)) throw new Error('Reasonix 测试未成功；保留原 job_id，不会自动重发');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally { service.close(); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
