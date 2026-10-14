'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { installPet, listPets, readPet, deletePet } = require('../lib/pet-store');
const png = fs.readFileSync(path.join(__dirname, '../renderer/assets/logo-light.png'));

test('pet publication supports bytes and generated assets without a workspace', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pet-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = installPet(root, { name: 'Test pet', layout: 'static', png_base64: png.toString('base64') });
  assert.equal(readPet(root, first.pet.id, true).spriteDataUrl, `data:image/png;base64,${png.toString('base64')}`);
  const assetId = 'a'.repeat(32);
  fs.mkdirSync(path.join(root, 'generated-images'));
  fs.writeFileSync(path.join(root, 'generated-images', `${assetId}.png`), png);
  const second = installPet(root, { name: 'Animated pet', layout: 'sprite', source_asset_id: assetId });
  assert.notEqual(first.pet.id, second.pet.id);
  assert.equal(listPets(root).length, 5);
  assert.equal(fs.readdirSync(path.join(root, 'pets')).some(name => name.startsWith('.staging')), false);
  assert.equal(readPet(root, '../config'), null);
  for (const id of ['orb', 'claude', 'deepseek', '../pets', 'custom-../../config']) {
    assert.throws(() => deletePet(root, id));
  }
  deletePet(root, first.pet.id);
  assert.equal(readPet(root, first.pet.id), null);
  assert.ok(readPet(root, second.pet.id));
  assert.equal(listPets(root).length, 4);
  assert.throws(() => deletePet(root, first.pet.id), /不存在/);
});

test('functional pets publish without forced artwork and retain their data binding', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pet-widget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data_source = { url: 'https://balance.example/account', value_path: ['data', 'balance'], connection_id: 'account' };
  const installed = installPet(root, { name: 'Balance', layout: 'widget', data_source });
  const pet = readPet(root, installed.pet.id, true);
  assert.equal(pet.layout, 'widget'); assert.equal(pet.spriteDataUrl, undefined);
  assert.deepEqual(pet.dataSource.value_path, ['data', 'balance']);
  assert.equal(fs.existsSync(path.join(root, 'pets', pet.id, 'sprite.png')), false);
  assert.throws(() => installPet(root, { name: 'Invalid', layout: 'widget' }), /data_source/);
  deletePet(root, pet.id); assert.equal(readPet(root, pet.id), null);
});

test('web pets publish their own frontend without artwork and validate stored content', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pet-web-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const frontend = { html: '<h1>Balance</h1>', css: 'h1{color:red}', js: 'window.ready=true', width: 320, height: 140 };
  const { pet } = installPet(root, { name: 'Web balance', layout: 'web', frontend });
  assert.deepEqual(readPet(root, pet.id, true).frontend, frontend);
  assert.deepEqual(readPet(root, pet.id).viewport, { width: 320, height: 140 });
  assert.equal(readPet(root, pet.id).frontend, undefined);
  assert.throws(() => installPet(root, { name: 'Web', layout: 'web' }), /frontend.html/);
  assert.throws(() => installPet(root, { name: 'Web', layout: 'web', frontend: { ...frontend, width: 900 } }), /width/);
  assert.throws(() => installPet(root, { name: 'Web', layout: 'web', frontend: { ...frontend, js: 'x'.repeat(512 * 1024) } }), /512/);
  fs.writeFileSync(path.join(root, 'pets', pet.id, 'frontend.json'), '{invalid');
  assert.equal(readPet(root, pet.id), null);
});

test('invalid pet packages are rejected before publishing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pet-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = { name: 'Test', layout: 'static', png_base64: png.toString('base64') };
  assert.throws(() => installPet(root, { ...base, name: '' }), /名称/);
  assert.throws(() => installPet(root, { ...base, source_asset_id: '../file' }), /id/);
  assert.throws(() => installPet(root, { ...base, source_asset_id: 'b'.repeat(32) }), /不存在/);
  assert.throws(() => installPet(root, { ...base, png_base64: Buffer.from('not an image').toString('base64') }), /PNG/);
  assert.throws(() => installPet(root, { ...base, png_base64: png.subarray(0, 40).toString('base64') }), /PNG/);
  const oversized = Buffer.from(png); oversized.writeUInt32BE(9000, 16);
  assert.throws(() => installPet(root, { ...base, png_base64: oversized.toString('base64') }), /尺寸/);
  assert.equal(listPets(root).length, 3);
});
