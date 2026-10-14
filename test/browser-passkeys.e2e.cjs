'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-passkeys-'));
const until = async predicate => {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Passkey test timed out');
};
(async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<form><input autocomplete="username"><input type="password" autocomplete="current-password"><button type="submit">登录</button></form><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.body.dataset.submitted="yes"}</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://localhost:${server.address().port}`;
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await app.evaluate(({ dialog }) => {
      global.passkeyPrompts = []; global.passkeyResponse = 1;
      dialog.showMessageBox = async (_win, options) => {
        global.passkeyPrompts.push(options.title);
        if (global.passkeyHold) {
          return new Promise(resolve => {
            global.releasePasskeyPrompt = response => resolve({ response });
            options.signal?.addEventListener('abort', () => { global.passkeyDialogAborted = true; resolve({ response: 0 }); }, { once: true });
          });
        }
        return { response: global.passkeyResponse };
      };
    });
    await page.evaluate(async url => {
      await window.yan.browserPasswordSave({ url, username: 'alice', password: 'test-secret' });
      openBrowserUrlInNewTab(url + '/login');
    }, url);
    const guestEval = code => app.evaluate(({ webContents }, code) => {
      const guest = webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL().includes('/login'));
      return guest ? guest.executeJavaScript(code) : null;
    }, code);
    await until(async () => await guestEval('document.body.dataset.submitted') === 'yes');
    assert.equal(await guestEval('typeof window.__yanPasskeyUpgrade'), 'function');
    await app.evaluate(async ({ webContents }) => {
      const guest = webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL().includes('/login'));
      global.passkeyGuest = guest;
      guest.debugger.attach('1.3');
      await guest.debugger.sendCommand('WebAuthn.enable', { enableUI: true });
      const result = await guest.debugger.sendCommand('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true
      } });
      global.authenticatorId = result.authenticatorId;
    });
    const credentials = () => app.evaluate(async () => {
      const result = await global.passkeyGuest.debugger.sendCommand('WebAuthn.getCredentials', { authenticatorId: global.authenticatorId });
      return result.credentials.map(({ credentialId, signCount }) => ({ credentialId, signCount }));
    });
    const create = async (username = 'alice', extra = '') => {
      await guestEval(`window.passkeyResult=null; (async()=>{try {
        const credential=await navigator.credentials.create({mediation:'conditional',publicKey:{
          rp:{id:'localhost',name:'Yan Test'},user:{id:new TextEncoder().encode(${JSON.stringify(username)}),name:${JSON.stringify(username)},displayName:${JSON.stringify(username)}},
          challenge:new Uint8Array(32).fill(17),pubKeyCredParams:[{type:'public-key',alg:-7}],
          authenticatorSelection:{residentKey:'required',userVerification:'required'},timeout:10000},${extra}});
        window.passkeyResult={id:credential.id,publicKey:Array.from(new Uint8Array(credential.response.getPublicKey())),clientData:Array.from(new Uint8Array(credential.response.clientDataJSON))};
      }catch(e){window.passkeyResult={error:e.name}}})()`);
      await until(async () => !!await guestEval('window.passkeyResult'));
      return guestEval('window.passkeyResult');
    };
    // Actual Chromium WebAuthn registration, not a mocked navigator.credentials.
    const registered = await create();
    assert.ok(registered.id, JSON.stringify(registered));
    assert.equal((await credentials()).length, 1);
    const clientData = JSON.parse(Buffer.from(registered.clientData));
    assert.equal(clientData.origin, url); assert.equal(clientData.type, 'webauthn.create');
    assert.equal(clientData.challenge, Buffer.alloc(32, 17).toString('base64url'));
    assert.ok((await app.evaluate(() => global.passkeyPrompts)).includes('创建通行密钥？'));
    assert.equal((await create()).error, 'NotAllowedError', 'one offer per password submission');
    // Real assertion and signature validation against the public key from creation.
    await guestEval(`window.assertion=null;(async()=>{try{const c=await navigator.credentials.get({publicKey:{rpId:'localhost',challenge:new Uint8Array(32).fill(23),timeout:10000,userVerification:'required'}});window.assertion={id:c.id,auth:Array.from(new Uint8Array(c.response.authenticatorData)),client:Array.from(new Uint8Array(c.response.clientDataJSON)),sig:Array.from(new Uint8Array(c.response.signature))}}catch(e){window.assertion={error:e.name}}})()`);
    await until(async () => !!await guestEval('window.assertion'));
    const assertion = await guestEval('window.assertion');
    assert.equal(assertion.id, registered.id, JSON.stringify(assertion));
    const auth = Buffer.from(assertion.auth), client = Buffer.from(assertion.client);
    assert.equal(JSON.parse(client).challenge, Buffer.alloc(32, 23).toString('base64url'));
    assert.equal(JSON.parse(client).origin, url);
    assert.equal(auth.subarray(0, 32).toString('hex'), crypto.createHash('sha256').update('localhost').digest('hex'));
    assert.ok(auth[32] & 4, 'user verification flag');
    assert.ok(crypto.verify('sha256', Buffer.concat([auth, crypto.createHash('sha256').update(client).digest()]),
      crypto.createPublicKey({ key: Buffer.from(registered.publicKey), format: 'der', type: 'spki' }), Buffer.from(assertion.sig)));
    const submit = () => guestEval('document.querySelector("form").requestSubmit()');
    const promptCount = () => app.evaluate(() => global.passkeyPrompts.length);
    await submit(); await page.evaluate(() => window.yan.setConfig({ browserPasswords: { offerPasskeyUpgrade: false } }));
    const count = await promptCount(); assert.equal((await create()).error, 'NotAllowedError');
    assert.equal(await promptCount(), count); assert.equal((await credentials()).length, 1);
    await page.evaluate(() => window.yan.setConfig({ browserPasswords: { offerPasskeyUpgrade: true } }));
    await submit(); assert.equal((await create('different-account')).error, 'NotAllowedError'); assert.equal(await promptCount(), count);
    await app.evaluate(() => { global.passkeyResponse = 0; });
    assert.equal((await create()).error, 'NotAllowedError'); assert.equal((await credentials()).length, 1);
    await submit(); assert.equal((await create('alice', 'signal:AbortSignal.abort()')).error, 'AbortError');
    // Turning the upgrade setting off must not disable a site's ordinary creation.
    await page.evaluate(() => window.yan.setConfig({ browserPasswords: { offerPasskeyUpgrade: false } }));
    await guestEval(`window.manual=null;(async()=>{try{const c=await navigator.credentials.create({publicKey:{rp:{id:'localhost',name:'Yan Test'},user:{id:new Uint8Array([42]),name:'manual',displayName:'manual'},challenge:new Uint8Array(32).fill(5),pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'required'},timeout:10000}});window.manual={id:c.id}}catch(e){window.manual={error:e.name}}})()`);
    await until(async () => !!await guestEval('window.manual'));
    assert.ok((await guestEval('window.manual')).id); assert.equal((await credentials()).length, 2);
    // Exercise Electron's actual discoverable-account selection with two accounts.
    await app.evaluate(() => { global.passkeyResponse = 2; });
    await guestEval(`window.multiple=null;(async()=>{try{const c=await navigator.credentials.get({publicKey:{rpId:'localhost',challenge:new Uint8Array(32).fill(29),timeout:10000}});window.multiple={id:c.id}}catch(e){window.multiple={error:e.name}}})()`);
    await until(async () => !!await guestEval('window.multiple'));
    assert.ok((await guestEval('window.multiple')).id, JSON.stringify(await guestEval('window.multiple')));
    assert.ok((await app.evaluate(() => global.passkeyPrompts)).includes('选择通行密钥'));
    await app.evaluate(() => { global.passkeyResponse = 0; });
    await guestEval(`window.multiple=null;(async()=>{try{const c=await navigator.credentials.get({publicKey:{rpId:'localhost',challenge:new Uint8Array(32).fill(30),timeout:10000}});window.multiple={id:c.id}}catch(e){window.multiple={error:e.name}}})()`);
    await until(async () => !!await guestEval('window.multiple'));
    assert.equal((await guestEval('window.multiple')).error, 'NotAllowedError');
    // Abort while the application consent dialog is still pending.
    await page.evaluate(() => window.yan.setConfig({ browserPasswords: { offerPasskeyUpgrade: true } }));
    await submit(); await guestEval('window.upgradeAbort=new AbortController()');
    await app.evaluate(() => { global.passkeyHold = true; });
    const beforeAbort = await promptCount();
    const aborted = create('alice', 'signal:window.upgradeAbort.signal');
    await until(async () => await promptCount() > beforeAbort);
    await guestEval('window.upgradeAbort.abort()');
    assert.equal((await aborted).error, 'AbortError'); assert.equal((await credentials()).length, 2);
    // A setting changed while consent is open is rechecked before native creation.
    await submit(); const beforeDisable = await promptCount(); const disabled = create();
    await until(async () => await promptCount() > beforeDisable);
    await page.evaluate(() => window.yan.setConfig({ browserPasswords: { offerPasskeyUpgrade: false } }));
    await app.evaluate(() => global.releasePasskeyPrompt(1));
    assert.equal((await disabled).error, 'NotAllowedError'); assert.equal((await credentials()).length, 2);
    await app.evaluate(() => { global.passkeyHold = false; });
    // Navigation closes the pending trusted dialog and cannot create on a stale page.
    await page.evaluate(() => window.yan.setConfig({ browserPasswords: { offerPasskeyUpgrade: true } }));
    await submit(); await app.evaluate(() => { global.passkeyHold = true; global.releasePasskeyPrompt = null; });
    await guestEval(`void navigator.credentials.create({mediation:'conditional',publicKey:{rp:{id:'localhost',name:'Test'},user:{id:new Uint8Array([1]),name:'alice',displayName:'alice'},challenge:new Uint8Array(32),pubKeyCredParams:[{type:'public-key',alg:-7}]}}).catch(()=>{})`);
    await until(() => app.evaluate(() => !!global.releasePasskeyPrompt));
    await guestEval('location.href="/login?navigated=1";void 0');
    await until(async () => await guestEval('location.search') === '?navigated=1' && await guestEval('document.body.dataset.submitted') === 'yes');
    await app.evaluate(() => global.releasePasskeyPrompt(1));
    assert.equal((await credentials()).length, 2);
    // Closing a tab also releases the pending dialog/callback without hanging.
    await app.evaluate(() => { global.releasePasskeyPrompt = null; global.passkeyDialogAborted = false; });
    await guestEval(`void navigator.credentials.create({mediation:'conditional',publicKey:{rp:{id:'localhost',name:'Test'},user:{id:new Uint8Array([1]),name:'alice',displayName:'alice'},challenge:new Uint8Array(32),pubKeyCredParams:[{type:'public-key',alg:-7}]}}).catch(()=>{})`);
    await until(() => app.evaluate(() => !!global.releasePasskeyPrompt));
    await app.evaluate(() => global.passkeyGuest.close());
    await until(() => app.evaluate(() => global.passkeyDialogAborted === true));
    await app.evaluate(() => { global.passkeyHold = false; });
    await page.evaluate(() => window.yan.setConfig({ browserPasswords: { offerPasskeyUpgrade: false } }));
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-browser').click();
    await page.locator('#browserPasswordsManage').click(); await page.locator('#passwordAdvancedTab').click();
    assert.equal(await page.locator('#passwordPasskeyUpgrade').isChecked(), false);
    await page.locator('#passwordPasskeyUpgrade').check();
    await page.waitForFunction(async () => (await window.yan.getConfig()).browserPasswords.offerPasskeyUpgrade === true);
    await until(() => page.locator('#passwordPasskeyUpgrade').isEnabled());
    fs.mkdirSync(path.join(root, 'output/playwright/passwords'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'output/playwright/passwords/passkeys.png') });
    await page.reload(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-browser').click();
    await page.locator('#browserPasswordsManage').click(); await page.locator('#passwordAdvancedTab').click();
    assert.equal(await page.locator('#passwordPasskeyUpgrade').isChecked(), true, 'setting survives reload');
    console.log('Passkeys: native creation, verified assertion signature, multiple-account selection/cancel, matching account gate, one-shot offer, disable/cancel/abort/navigation/tab close, manual creation and persistent settings passed. Virtual authenticator used; physical Windows Hello not exercised.');
  } finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
