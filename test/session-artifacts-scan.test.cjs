'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { purgeSessionArtifacts } = require('../lib/session-artifacts');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-artifact-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionsDir = path.join(root, 'sessions');
  const filesDir = path.join(root, 'uploads');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'generated-images'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  return { root, sessionsDir, filesDir, workspace };
}

test('shared paths and generated assets are preserved, then removed when unreferenced', (t) => {
  const { root, sessionsDir, filesDir, workspace } = fixture(t);
  const file = path.join(filesDir, 'shared image.png');
  fs.writeFileSync(file, 'image');
  const asset = 'a'.repeat(32);
  const assetFile = path.join(root, 'generated-images', `${asset}.png`);
  fs.writeFileSync(assetFile, 'asset');
  const record = { id: 'sess_target0001', workspace,
    messages: [{ role: 'user', content: 'target', attachment: { path: file } }] };
  const cleanupPlan = { paths: [file], assets: [asset], workspaces: [workspace] };
  fs.writeFileSync(path.join(sessionsDir, 'sess_target0001.json'), JSON.stringify(record));
  fs.writeFileSync(path.join(sessionsDir, 'sess_other0001.json'), JSON.stringify({ id: 'sess_other0001', workspace,
    messages: [{ role: 'user', content: 'shared', attachment: { path: file }, generatedImageId: asset }] }));

  purgeSessionArtifacts({ sessionsDir, filesDir, record, cleanupPlan });
  assert.equal(fs.existsSync(file), true, 'a path referenced by another session must survive');
  assert.equal(fs.existsSync(assetFile), true, 'a generated asset referenced by another session must survive');

  fs.rmSync(path.join(sessionsDir, 'sess_other0001.json'));
  purgeSessionArtifacts({ sessionsDir, filesDir, record, cleanupPlan });
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(assetFile), false);
});

test('a file URL with an encoded basename still protects the shared file', (t) => {
  const { sessionsDir, filesDir, workspace } = fixture(t);
  const file = path.join(filesDir, 'shared image.png');
  fs.writeFileSync(file, 'image');
  const record = { id: 'sess_target0002', workspace,
    messages: [{ role: 'user', content: 'target', attachment: { path: file } }] };
  const url = 'file:///' + file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  fs.writeFileSync(path.join(sessionsDir, 'sess_target0002.json'), JSON.stringify(record));
  fs.writeFileSync(path.join(sessionsDir, 'sess_other0002.json'), JSON.stringify({ id: 'sess_other0002', workspace,
    messages: [{ role: 'user', content: 'url', attachment: { localPath: url } }] }));

  purgeSessionArtifacts({ sessionsDir, filesDir, record, cleanupPlan: { paths: [file], assets: [], workspaces: [workspace] } });
  assert.equal(fs.existsSync(file), true);
});
