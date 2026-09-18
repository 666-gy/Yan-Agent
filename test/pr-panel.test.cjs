'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../renderer/renderer.js'),'utf8');
function setup(){
 const nodes=new Map(),pending=[];let workspace='A';
 const state={ghAvailable:true,items:[],workspace:'A',version:0,diffVersion:0};
 const ctx={taskGitPrState:state,currentGitWorkspace:()=>workspace,api:{ghPrList:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),ghPrDiff:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},$:id=>{if(!nodes.has(id))nodes.set(id,{classList:{toggle(){},remove(){},add(){}},textContent:'',innerHTML:''});return nodes.get(id)},toast(){},escapeAttr:s=>s,escapeHtml:s=>s};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function refreshTaskGitPrs()'),source.indexOf('async function createTaskGitPr(')),ctx);
 return {ctx,state,nodes,pending,switchTo:value=>workspace=value};
}
test('stale PR lists and errors cannot replace a different repository',async()=>{
 for(const reject of [false,true]){
 const s=setup(),a=s.ctx.refreshTaskGitPrs();s.switchTo('B');const b=s.ctx.refreshTaskGitPrs();
 s.pending[1].resolve({prs:[{number:2,title:'B'}]});await b;
 if(reject)s.pending[0].reject(new Error('old error'));else s.pending[0].resolve({prs:[{number:1,title:'A'}]});await a;
 assert.equal(s.state.items[0].title,'B');assert.equal(s.state.error,'');
 }
});
test('latest diff wins even when the older request finishes last',async()=>{
 const s=setup(),a=s.ctx.viewTaskGitPrDiff(null,1),b=s.ctx.viewTaskGitPrDiff(null,2);
 s.pending[1].resolve({diff:'second'});await b;s.pending[0].resolve({diff:'first'});await a;
 assert.equal(s.nodes.get('#taskGitPrDiffCode').textContent,'second');
});
test('PR list failure remains visible and gh detection can recover',async()=>{
 const s=setup();s.ctx.api.ghPrList=async()=>({ok:false,error:'authentication required'});
 await s.ctx.refreshTaskGitPrs();assert.match(s.nodes.get('#taskGitPrList').innerHTML,/authentication required/);
 s.state.ghAvailable=false;let count=0;s.ctx.api.ghDetect=async()=>{count++;return {ghPath:'gh'};};
 s.ctx.api.ghPrList=async()=>({prs:[]});await s.ctx.refreshTaskGitPrs();assert.equal(count,1);assert.equal(s.state.ghAvailable,true);
});
test('clicking old repository rows does not request a PR in the new repository',async()=>{
 const s=setup();s.switchTo('B');await s.ctx.viewTaskGitPrDiff(null,1);assert.equal(s.pending.length,0);
});
