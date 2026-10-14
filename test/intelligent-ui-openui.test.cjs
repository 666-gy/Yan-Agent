'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIntelligentUi}=require('../lib/intelligent-ui-creator');
const {validateProgram}=require('../lib/intelligent-ui/openui-library.cjs');
const {budget,trip}=require('./fixtures/intelligent-ui-openui.cjs');
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
