'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQuickSupplierGroups, buildMediaModelList, configuredSupplierModels } = require('../lib/model-roles');

test('unconfigured suppliers never expose bundled or cached models', () => {
  const catalog = [
    { id: 'bundled-model', name: 'Bundled Model' },
    { id: 'cached-model', name: 'Cached Model' }
  ];

  assert.deepEqual(configuredSupplierModels(catalog, false), []);
});

test('configured suppliers expose their model catalog without copying it', () => {
  const catalog = [{ id: 'available-model', name: 'Available Model' }];

  assert.equal(configuredSupplierModels(catalog, true), catalog);
});

test('quick supplier groups isolate configured supplier model catalogs', () => {
  const providers = [{
    providerId: 'openai',
    providerName: 'OpenAI',
    suppliers: [
      {
        supplierId: 'official',
        supplierName: '官方',
        configured: true,
        active: false,
        apiKey: 'must-not-leak',
        models: [{ id: 'gpt-official', name: 'Official GPT' }]
      },
      {
        supplierId: 'relay-a',
        supplierName: '中转站 A',
        configured: true,
        active: true,
        apiKey: 'also-must-not-leak',
        models: [{ id: 'relay-only', name: 'Relay Only' }]
      },
      {
        supplierId: 'relay-b',
        supplierName: '未配置中转站',
        configured: false,
        models: [{ id: 'hidden-model', name: 'Hidden' }]
      }
    ]
  }];

  const groups = buildQuickSupplierGroups({
    providers,
    activeSelection: { providerId: 'openai', modelId: 'relay-only', modelType: 'text' },
    activeProviderId: 'openai',
    activeSupplierId: 'relay-a'
  });

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].suppliers.map(supplier => supplier.supplierId), ['official', 'relay-a']);
  assert.deepEqual(groups[0].suppliers[0].models.map(model => model.id), ['gpt-official']);
  assert.deepEqual(groups[0].suppliers[1].models.map(model => model.id), ['relay-only']);
  assert.equal(groups[0].suppliers[1].selected, true);
  assert.equal(groups[0].suppliers[1].models[0].selected, true);
  assert.equal(JSON.stringify(groups).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(groups).includes('apiKey'), false);
});

test('media catalog keeps identical model IDs isolated by supplier', () => {
  const models = buildMediaModelList({
    providers: [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        supplierId: 'official',
        supplierName: '官方',
        configured: true,
        models: [{ id: 'image-2', name: 'Image 2', modelType: 'image' }]
      },
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        supplierId: 'relay',
        supplierName: '第三方中转',
        configured: true,
        models: [{ id: 'image-2', name: 'Image 2', modelType: 'image' }]
      }
    ],
    media: {
      imageProvider: 'openai',
      imageSupplierId: 'official',
      imageModel: 'image-2'
    }
  });

  assert.deepEqual(models.map(model => model.supplierId), ['official', 'relay']);
  assert.deepEqual(models.map(model => model.selected), [true, false]);
});
