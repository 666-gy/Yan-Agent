'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decorateModels } = require('../lib/model-capabilities');
const {
  GLM_FREE_VISION_RELAY_MODELS,
  SENSENOVA_VISION_RELAY_MODELS,
  SILICONFLOW_VISION_RELAY_MODELS,
  VISION_RELAY_PRESET_ORDER,
  buildQuickSupplierGroups,
  buildMediaModelList,
  configuredSupplierModels
} = require('../lib/model-roles');
const {
  GLM_OFFICIAL_SUPPLEMENTAL_MODELS,
  SENSENOVA_OFFICIAL_SUPPLEMENTAL_MODELS,
  getOfficialSupplementalModels,
  summarizeModelCatalog
} = require('../lib/provider-model-catalog');

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

test('GLM keeps API-discovered and official supplemental catalogs separate', () => {
  const summary = summarizeModelCatalog([
    { id: 'glm-5.3', name: 'GLM-5.3' },
    { id: 'glm-5-turbo', name: 'GLM-5 Turbo' }
  ], getOfficialSupplementalModels('glm'));

  assert.equal(summary.modelCount, 2);
  assert.equal(summary.supplementalModelCount, GLM_OFFICIAL_SUPPLEMENTAL_MODELS.length);
  assert.equal(summary.totalModelCount, 2 + GLM_OFFICIAL_SUPPLEMENTAL_MODELS.length);
  assert.deepEqual(summary.apiModels.map(model => model.id), ['glm-5.3', 'glm-5-turbo']);
  assert.deepEqual(summary.selectableModels.slice(0, 2).map(model => model.id), ['glm-5.3', 'glm-5-turbo']);
  assert.ok(summary.selectableModels.some(model => model.id === 'glm-4.7-flash' && model.modelType === 'text'));
  assert.ok(summary.selectableModels.some(model => model.id === 'glm-4.6v-flash' && model.capabilities?.vision === true));
  assert.ok(summary.selectableModels.some(model => model.id === 'glm-image' && model.modelType === 'image'));
  assert.ok(summary.selectableModels.some(model => model.id === 'cogvideox-flash' && model.modelType === 'video'));
});

test('an API-returned GLM model overrides its supplemental duplicate and count', () => {
  const summary = summarizeModelCatalog([
    { id: 'glm-4.7-flash', name: 'GLM 4.7 Flash from API' }
  ], getOfficialSupplementalModels('glm'));
  const model = summary.selectableModels.find(item => item.id === 'glm-4.7-flash');

  assert.equal(model.name, 'GLM 4.7 Flash from API');
  assert.equal(model.source, 'api');
  assert.equal(summary.supplementalModelCount, GLM_OFFICIAL_SUPPLEMENTAL_MODELS.length - 1);
  assert.equal(summary.totalModelCount, GLM_OFFICIAL_SUPPLEMENTAL_MODELS.length);
});

test('OpenAI-compatible connections do not inherit the GLM supplement', () => {
  assert.deepEqual(getOfficialSupplementalModels('openai'), []);
  assert.deepEqual(getOfficialSupplementalModels('agnes'), []);
});

test('vision relay keeps a free GLM to SenseNova to Agnes to SiliconFlow order', () => {
  assert.deepEqual(VISION_RELAY_PRESET_ORDER, ['glm', 'sensenova', 'agnes', 'siliconflow']);
  assert.deepEqual(GLM_FREE_VISION_RELAY_MODELS.map(model => model.id), [
    'glm-4.6v-flash',
    'glm-4.1v-thinking-flash',
    'glm-4v-flash'
  ]);
  assert.equal(GLM_FREE_VISION_RELAY_MODELS.some(model => model.id === 'glm-5v-turbo'), false);
  assert.deepEqual(SENSENOVA_VISION_RELAY_MODELS.map(model => model.id), [
    'sensenova-6.8-flash-lite'
  ]);
  assert.deepEqual(SILICONFLOW_VISION_RELAY_MODELS.map(model => model.id), [
    'Qwen/Qwen3.5-4B',
    'deepseek-ai/DeepSeek-OCR',
    'PaddlePaddle/PaddleOCR-VL-1.5'
  ]);
});

test('SenseNova registers its multimodal chat and image-generation models separately', () => {
  const summary = summarizeModelCatalog([], getOfficialSupplementalModels('sensenova'));
  const relayModel = summary.selectableModels.find(model => model.id === 'sensenova-6.8-flash-lite');
  const imageModel = summary.selectableModels.find(model => model.id === 'sensenova-u1-fast');

  assert.equal(summary.supplementalModelCount, SENSENOVA_OFFICIAL_SUPPLEMENTAL_MODELS.length);
  assert.equal(relayModel.modelType, 'text');
  assert.equal(relayModel.capabilities.vision, true);
  assert.equal(imageModel.modelType, 'image');
  assert.equal(SENSENOVA_VISION_RELAY_MODELS.some(model => model.id === imageModel.id), false);
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

test('Agnes connection catalogs preserve text, image, and video roles', () => {
  const ids = [
    'agnes-2.0-flash',
    'agnes-image-2.0-flash',
    'agnes-2.5-flash',
    'agnes-2.5-pro-alpha',
    'agnes-image-2.1-flash',
    'agnes-video-2.5',
    'agnes-2.5-pro',
    'agnes-video-v2.0'
  ];
  const catalog = decorateModels('agnes', ids.map(id => ({ id })));
  const quick = buildQuickSupplierGroups({
    providers: [{
      providerId: 'conn-agnes',
      providerName: 'Agnes',
      suppliers: [{
        supplierId: 'official',
        supplierName: 'Agnes',
        configured: true,
        active: true,
        models: catalog
      }]
    }],
    activeSelection: { providerId: 'conn-agnes', modelId: 'agnes-2.0-flash', modelType: 'text' },
    activeProviderId: 'conn-agnes',
    activeSupplierId: 'official'
  });
  const quickModels = quick[0].suppliers[0].models;
  assert.deepEqual(quickModels.map(model => model.modelType), [
    'text', 'image', 'text', 'text', 'image', 'video', 'text', 'video'
  ]);

  const media = buildMediaModelList({
    providers: [{
      providerId: 'conn-agnes',
      providerName: 'Agnes',
      supplierId: 'official',
      supplierName: 'Agnes',
      configured: true,
      models: catalog
    }]
  });
  assert.deepEqual(media.map(model => model.modelType), ['image', 'image', 'video', 'video']);
});
