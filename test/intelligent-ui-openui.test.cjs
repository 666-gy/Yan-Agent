'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIntelligentUi}=require('../lib/intelligent-ui-creator');
const {validateProgram,prompt}=require('../lib/intelligent-ui/openui-library.cjs');
const {normalizeLanguage,translate}=require('../lib/intelligent-ui/i18n.cjs');
const {budget,trip,dashboard}=require('./fixtures/intelligent-ui-openui.cjs');
test('OpenUI validates registered trees and keeps HTML compatibility',()=>{
 const active={intelligentUiAllowed:true};
 const result=createIntelligentUi(active,'t',{task_id:'t',action:'start',title:'规划',purpose:'调整并保留方案',placement:'final',format:'openui'});
 assert.match(result.openui_contract,/Budget/);
 const args={task_id:'t',action:'render',format:'openui',code:budget};
 assert.equal(createIntelligentUi(active,'t',args).intelligent_ui.format,'openui');
 assert.equal(active.intelligentUi.handoff,false);
 assert.equal(createIntelligentUi(active,'t',{...args,handoff:true}).intelligent_ui.handoff,true);
 assert.equal(createIntelligentUi(active,'t',args).intelligent_ui.handoff,false,'each render defaults back to no handoff');
 assert.throws(()=>createIntelligentUi(active,'t',{...args,handoff:'yes'}),/handoff/);
 const revision=active.intelligentUi.revision;
 for(const code of ['root = App([Budget("x", "x", "¥", -1, [])])','root = App([Option("x", "x", "x")])','root = App([Note("x")])\nunused = Note("hidden")','root = App([Query("https://example.com")])','root = App([Note("x")])\n$foo = 1','root = App([Note("x")','root = App([Note("x"), Note("y")]); evil()']){
  assert.throws(()=>createIntelligentUi(active,'t',{...args,code}),undefined,code);
 }
 assert.throws(()=>createIntelligentUi(active,'t',{...args,html:'<p>x</p>'}),/混用/);
 assert.equal(active.intelligentUi.revision,revision);
 assert.equal(createIntelligentUi(active,'t',{task_id:'t',action:'render',html:'<b>old</b>'}).intelligent_ui.format,'html');
});
test('Trip requires map permission and exact photo declarations',()=>{
 assert.throws(()=>validateProgram(trip,{map:false,images:[]}),/map/);
 assert.equal(validateProgram(trip,{map:true,images:[]}).root.typeName,'App');
 assert.throws(()=>validateProgram(trip.replace('"旧金山滨水地标", ""','"旧金山滨水地标", "https://images.pexels.com/photo.jpg"'),{map:true,images:[]}),/image/);
});

test('Table, Chart, Form and Stack validate as bounded static components',()=>{
 const resources={map:false,images:[]};
 assert.equal(validateProgram(dashboard,resources).root.typeName,'App');
 for(const name of ['Table','Chart','Form','Stack'])assert.ok(prompt.includes(name),name);
 assert.throws(()=>validateProgram(dashboard.replace('[120, 85]','[120]'),resources),/labels.*values|长度/);
 assert.throws(()=>validateProgram(dashboard.replace('["基础", "¥99", "120 ms"]','["基础", "¥99"]'),resources),/单元格|列数/);
 assert.throws(()=>validateProgram(dashboard.replace('"tier", "方案"','"name", "方案"'),resources),/id 不能重复/);
 assert.throws(()=>validateProgram(dashboard.replace('"text", "例如：官网改版", true, []','"text", "例如：官网改版", true, ["a"]'),resources),/select/);
 assert.throws(()=>validateProgram('root = App([s])\ns = Stack("row", [inner])\ninner = Stack("column", [Note("x")])',resources),/子组件类型|参数无效/);
});

test('historical notes validate structure without rejecting explanatory wording',()=>{
 const resources={map:false,images:[]};
 assert.equal(validateProgram('root = App([t])\nt = Table("对比", ["a", "b"], [["1", "2"]])',resources).root.typeName,'App','note is optional');
 assert.equal(validateProgram('root = App([t])\nt = Table("对比", ["a", "b"], [["1", "2"]], "单位：元")',resources).root.typeName,'App','a unit note is allowed');
 assert.equal(validateProgram('root = App([t])\nt = Table("对比", ["a", "b"], [["1", "2"]], "示例数据，可调整数量。")',resources).root.typeName,'App');
 assert.equal(validateProgram('root = App([n])\nn = Note("填写后自动保存在本机，不会自动发送给 Agent。")',resources).root.typeName,'App');
 assert.equal(validateProgram('root = App([Note("甲"), Note("乙")])',resources).root.typeName,'App');
 assert.throws(()=>validateProgram('root = App([Note("'+'x'.repeat(201)+'")])',resources),/参数无效/);
});

test('runtime i18n normalizes language and interpolates copy',()=>{
 assert.equal(normalizeLanguage('en-US'),'en');
 assert.equal(normalizeLanguage('zh-CN'),'zh');
 assert.equal(normalizeLanguage(undefined),'zh');
 assert.equal(translate('zh','budget.over',{amount:'¥1'}),'超出 ¥1');
 assert.equal(translate('en','form.progress',{filled:2,total:3}),'2 of 3 filled');
 assert.equal(translate('en','trip.moveUp',{name:'Ferry'}),'Move Ferry up');
 assert.equal(translate('zh','unknown.key'),'unknown.key');
});


test('official OpenUI catalog accepts reactive calculations and bounded local state',()=>{
 const code='root = Stack([FormControl("数量", Input("quantity", "", "number", null, $qty)), TextContent("总计 " + ($qty * 280))])\n$qty = "3"';
 const result=validateProgram(code);
 assert.equal(result.root.typeName,'Stack');
 assert.equal(result.stateDeclarations.$qty,'3');
 assert.equal(result.root.hasDynamicProps,true);
 assert.match(prompt,/Root is Stack/);
 for(const invalid of [
  'root = Stack([MissingComponent("x")])',
  'root = Stack([TextContent("ok")])\nunused = TextContent("hidden")',
  'root = Stack([TextContent(q)])\nq = Query("fetch", {})',
  'root = Stack([TextContent("x")',
  'root = Stack([TextContent("x")])\n' + Array.from({length:65},(_,i)=>'$x'+i+' = 0').join('\n')
 ]) assert.throws(()=>validateProgram(invalid),undefined,invalid.slice(0,90));
});

test('official map adapter retains geographic permission boundaries',()=>{
 const code='root = Stack([Map("trip", [{id:"one",name:"地点",lat:37,lng:-122,image:"https://images.pexels.com/photo.jpg"}], [])])';
 assert.throws(()=>validateProgram(code,{map:false,images:[]}),/map/);
 assert.throws(()=>validateProgram(code,{map:true,images:[]}),/image/);
 assert.equal(validateProgram(code,{map:true,images:['https://images.pexels.com/photo.jpg']}).root.typeName,'Stack');
 assert.throws(()=>validateProgram(code.replace('lat:37','lat:99'),{map:true,images:[]}),/Map/);
});


test('backend native validation loads without frontend packages (packaged Node/MCP path)',()=>{
 const {execFileSync}=require('node:child_process');
 const output=execFileSync(process.execPath,['-e',`
  const Module=require('node:module');const load=Module._load;
  Module._load=function(name,...args){if(name==='react'||name==='react-dom'||name.startsWith('@openuidev/react-'))throw new Error('Frontend dependency in backend: '+name);return load.call(this,name,...args);};
  const {validateProgram}=require('./lib/intelligent-ui/openui-library.cjs');
  console.log(validateProgram('root = Stack([TextContent("offline")])').root.typeName);
 `],{cwd:require('node:path').join(__dirname,'..'),encoding:'utf8'});
 assert.equal(output.trim(),'Stack');
});
