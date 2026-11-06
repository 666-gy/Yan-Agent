/* Shared Intelligent UI copy. Works in Node (require) and as a browser script. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YanIntelligentUiI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ZH = Object.freeze({
    'common.overview': '总览',
    'common.optional': '可选',
    'choice.summary': '{label}：{value}',
    'budget.summary': '{label}：{items}；合计 {total}；预算 {limit}',
    'budget.item': '{label} {quantity}{unit}',
    'budget.over': '超出 {amount}',
    'budget.left': '剩余 {amount}',
    'budget.quantity': '{label}数量',
    'trip.summary': '行程：{stops}',
    'trip.empty': '尚未保留地点',
    'trip.add': '加入行程',
    'trip.remove': '移出行程',
    'trip.photoUnavailable': '照片暂不可用',
    'trip.mapUnavailable': '地图暂不可用，仍可保留地点。',
    'trip.routeMissing': '仅展示地点，未计算道路路线。',
    'trip.reorderNote': '调整地点顺序不会重算道路路线。',
    'trip.moveUp': '上移{name}',
    'trip.moveDown': '下移{name}',
    'trip.removePlace': '移除{name}',
    'table.empty': '没有可显示的条目',
    'chart.summary': '{label}：{values}',
    'chart.point': '{label} {value}{unit}',
    'form.progress': '已填写 {filled}/{total}',
    'form.required': '必填',
    'form.invalidNumber': '请输入有效数字',
    'form.summary': '{label}：{values}',
    'form.pair': '{label}={value}',
    'form.empty': '尚未填写',
    'form.selectPlaceholder': '请选择',
    'save.unavailable': '本地保存暂不可用',
    'status.creating': '正在创建',
    'status.ready': '可交互',
    'status.error': '创建失败',
    'status.incomplete': '未完成',
    'status.runtimeError': '界面运行出错',
    'status.openuiLoadFailed': 'OpenUI 组件加载失败',
    'status.mapLoadFailed': '地图组件加载失败',
    'handoff.ready': '带回对话',
    'handoff.prepared': '已准备结果',
    'frame.title': '交互内容'
  });

  const EN = Object.freeze({
    'common.overview': 'Overview',
    'common.optional': 'Optional',
    'choice.summary': '{label}: {value}',
    'budget.summary': '{label}: {items}; total {total}; budget {limit}',
    'budget.item': '{label} {quantity}{unit}',
    'budget.over': '{amount} over',
    'budget.left': '{amount} left',
    'budget.quantity': '{label} quantity',
    'trip.summary': 'Itinerary: {stops}',
    'trip.empty': 'No places kept yet',
    'trip.add': 'Add to itinerary',
    'trip.remove': 'Remove from itinerary',
    'trip.photoUnavailable': 'Photo unavailable',
    'trip.mapUnavailable': 'Map unavailable; you can still keep places.',
    'trip.routeMissing': 'Places only; no road route calculated.',
    'trip.reorderNote': 'Reordering does not recalculate the road route.',
    'trip.moveUp': 'Move {name} up',
    'trip.moveDown': 'Move {name} down',
    'trip.removePlace': 'Remove {name}',
    'table.empty': 'No rows to show',
    'chart.summary': '{label}: {values}',
    'chart.point': '{label} {value}{unit}',
    'form.progress': '{filled} of {total} filled',
    'form.required': 'Required',
    'form.invalidNumber': 'Enter a valid number',
    'form.summary': '{label}: {values}',
    'form.pair': '{label}={value}',
    'form.empty': 'Nothing filled yet',
    'form.selectPlaceholder': 'Select',
    'save.unavailable': 'Local saving is unavailable',
    'status.creating': 'Creating',
    'status.ready': 'Interactive',
    'status.error': 'Creation failed',
    'status.incomplete': 'Incomplete',
    'status.runtimeError': 'Interface error',
    'status.openuiLoadFailed': 'OpenUI components failed to load',
    'status.mapLoadFailed': 'Map component failed to load',
    'handoff.ready': 'Bring back to chat',
    'handoff.prepared': 'Result ready',
    'frame.title': 'Interactive content'
  });

  const DICTIONARIES = Object.freeze({ zh: ZH, en: EN });

  function normalizeLanguage(value) {
    return String(value || '').trim().toLowerCase().startsWith('en') ? 'en' : 'zh';
  }

  function translate(lang, key, params) {
    const dictionary = DICTIONARIES[normalizeLanguage(lang)];
    const template = dictionary[key] ?? DICTIONARIES.zh[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
  }

  function translator(lang) {
    const language = normalizeLanguage(lang);
    return (key, params) => translate(language, key, params);
  }

  return Object.freeze({ DICTIONARIES, normalizeLanguage, translate, translator });
});
