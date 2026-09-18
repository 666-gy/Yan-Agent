'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-resource-lifecycle-'));

function windowsProcesses() {
  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine | ConvertTo-Json -Compress'
  ], { encoding: 'utf8', windowsHide: true });
  const parsed = JSON.parse(output || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

function descendantsOf(rootPid) {
  const processes = windowsProcesses();
  const descendants = new Set([Number(rootPid)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (descendants.has(Number(process.ParentProcessId)) && !descendants.has(Number(process.ProcessId))) {
        descendants.add(Number(process.ProcessId));
        changed = true;
      }
    }
  }
  return processes.filter(process => descendants.has(Number(process.ProcessId)));
}

async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

function skillWriteTimes() {
  const root = path.join(userDataDir, 'YanData', 'skills');
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name === 'SKILL.md' || entry.name === '.yan-skill.json') {
        files.push([path.relative(root, target), fs.statSync(target).mtimeMs]);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left[0].localeCompare(right[0]));
}

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
        YAN_E2E_USER_DATA_DIR: userDataDir,
        YAN_OPENCODE_IDLE_RELEASE_MS: '1500'
      }
    });
    const rootPid = application.process().pid;
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.currentSession && document.querySelector('#composerInput'));
    await page.waitForFunction(() => !document.querySelector('#settingsOverlay'));

    assert.equal(descendantsOf(rootPid).some(process => String(process.Name).toLowerCase() === 'opencode.exe'), false);

    const coldStartProcesses = descendantsOf(rootPid);
    const coldStartProcess = coldStartProcesses.find(process => Number(process.ProcessId) === Number(rootPid));
    const firstTimes = skillWriteTimes();
    await page.waitForTimeout(10_000);
    const coldEndProcesses = descendantsOf(rootPid);
    const coldEndProcess = coldEndProcesses.find(process => Number(process.ProcessId) === Number(rootPid));
    assert.deepEqual(skillWriteTimes(), firstTimes, 'idle Skill manifests changed after startup');
    const persistedConfig = JSON.parse(fs.readFileSync(path.join(userDataDir, 'YanData', 'config.json'), 'utf8'));
    assert.equal((persistedConfig.skills || []).some(skill => Object.hasOwn(skill, 'prompt')), false);
    assert.equal((persistedConfig.customSkills || []).some(skill => Object.hasOwn(skill, 'prompt')), false);

    await page.locator('#composerInput').click();
    assert.equal(await waitFor(() => descendantsOf(rootPid)
      .some(process => String(process.Name).toLowerCase() === 'opencode.exe'), 12_000), true, 'composer did not prewarm OpenCode');
    const warmProcesses = descendantsOf(rootPid);
    const warmRuntimeProcesses = warmProcesses.filter(process => (
      String(process.Name).toLowerCase() === 'opencode.exe'
      || /yan-(?:skills|media|browser|session|harness)-mcp|codegraph|playwright/i.test(String(process.CommandLine || ''))
    ));
    assert.ok(warmRuntimeProcesses.some(process => String(process.Name).toLowerCase() === 'opencode.exe'));
    assert.equal(await waitFor(() => !descendantsOf(rootPid)
      .some(process => String(process.Name).toLowerCase() === 'opencode.exe'), 12_000), true, 'idle OpenCode process was not released');
    const livePidsAfterRelease = new Set(windowsProcesses().map(process => Number(process.ProcessId)));
    assert.deepEqual(
      warmRuntimeProcesses.filter(process => livePidsAfterRelease.has(Number(process.ProcessId))).map(process => process.ProcessId),
      [],
      'OpenCode or MCP runtime process survived idle release'
    );

    await page.locator('#settingsBtn').click();
    await page.locator('#settingsOverlay:not(.hidden)').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#settingsOverlay')?.isConnected), true);
    await page.locator('#closeSettings').click();
    await page.waitForFunction(() => !document.querySelector('#settingsOverlay'));

    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({
      ok: true,
      coldOpenCode: false,
      prewarm: true,
      idleReleased: true,
      releasedRuntimeProcesses: warmRuntimeProcesses.length,
      skillWritesStable: firstTimes.length,
      settingsDetached: true,
      mainRssStartMb: Math.round((Number(coldStartProcess?.WorkingSetSize) || 0) / 1024 / 1024),
      mainRssEndMb: Math.round((Number(coldEndProcess?.WorkingSetSize) || 0) / 1024 / 1024),
      processTreeRssStartMb: Math.round(coldStartProcesses.reduce((sum, process) => sum + (Number(process.WorkingSetSize) || 0), 0) / 1024 / 1024),
      processTreeRssEndMb: Math.round(coldEndProcesses.reduce((sum, process) => sum + (Number(process.WorkingSetSize) || 0), 0) / 1024 / 1024)
    }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
