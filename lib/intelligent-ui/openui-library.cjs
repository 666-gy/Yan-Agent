'use strict';
const { createParser } = require('@openuidev/lang-core');
const { mapProps } = require('./map-schema.cjs');
const catalog = require('./catalog.generated.json');
const legacy = require('./legacy-library.cjs');
const componentNames = new Set(catalog.components);
const parser = createParser(catalog.schema, catalog.root);
function validateProgram(code, resources = {map:false,images:[]}) {
  if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code, 'utf8') > 65536 || code.trim().startsWith('`')) {
    throw new Error('OpenUI code 必须是不带围栏、至多 64 KiB 的程序。');
  }
  // App is the original Yan catalog, retained solely for saved programs.
  if (/\bApp\s*\(/.test(code.replace(/"(?:\\.|[^"\\])*"/g, '""'))) return legacy.validateProgram(code, resources);
  const result = parser.parse(code);
  if (!result.root || result.root.typeName !== 'Stack' || result.meta.incomplete || result.meta.errors?.length || result.meta.unresolved?.length || result.meta.orphaned?.length) {
    throw new Error('OpenUI 程序无效：' + JSON.stringify(result.meta).slice(0,1400));
  }
  if (result.queryStatements?.length || result.mutationStatements?.length) throw new Error('OpenUI 不开放 Query 或 Mutation；请先用现有工具获取数据。');
  if (Object.keys(result.stateDeclarations || {}).length > 64) throw new Error('OpenUI 状态过多。');
  let count = 0, coordinates = 0;
  const mapNames = new Set();
  const walk = (value, depth = 0) => {
    if (++count > 16000 || depth > 40) throw new Error('OpenUI 内容过于复杂。');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('OpenUI 数字必须有限。');
    if (value == null || typeof value !== 'object') return;
    if (value.type === 'element') {
      if (!componentNames.has(value.typeName) || value.partial) throw new Error('OpenUI 组件无效。');
      if (value.typeName === 'Map') {
        const checked = mapProps.safeParse(value.props);
        if (!checked.success) throw new Error('Map 参数必须是已核实的静态数据：' + checked.error.message.slice(0,800));
        const p = checked.data;
        if (!resources.map) throw new Error('Map 需要 resources.map=true。');
        if (mapNames.has(p.name)) throw new Error('Map.name 不能重复。');
        mapNames.add(p.name);
        const ids = [...p.places, ...p.routes].map(item => item.id);
        if (new Set(ids).size !== ids.length) throw new Error('地图条目 id 不能重复。');
        for (const item of p.places) if (item.image && !resources.images?.includes(item.image)) throw new Error('Map image 必须在 resources.images 中声明。');
        for (const item of p.routes) coordinates += item.coordinates.length;
        if (coordinates > 2000) throw new Error('路线坐标总数不能超过 2000。');
      }
    }
    for (const field of Object.values(value)) walk(field, depth + 1);
  };
  walk(result.root); walk(result.stateDeclarations);
  return result;
}
const prompt = catalog.prompt;
module.exports = {validateProgram,prompt,makeLibrary:legacy.makeLibrary};
