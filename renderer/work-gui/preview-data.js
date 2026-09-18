// Isolated visual fixture. Production index.html never loads this file.
const previewNow = Date.now();
const previewSnapshot = {
  activeRunId: 'preview-run',
  sessions: [{id:'preview',title:'演示 · 搭建项目工作区'}, {id:'preview-review',title:'演示 · 检查界面细节'}],
  runs: [
    {runId:'preview-run',sessionId:'preview',title:'演示 · 搭建项目工作区',status:'running',startedAt:previewNow-90000,finishedAt:0,toolCalls:8},
    {runId:'preview-run-review',sessionId:'preview-review',title:'演示 · 检查界面细节',status:'completed',startedAt:previewNow-120000,finishedAt:previewNow-20000,toolCalls:4}
  ],
  agents: [
    {id:'main',kind:'main',runId:'preview-run',name:'Yan Agent',role:'',state:'working',zone:'workshop',tool:'edit',label:'修改页面',text:'正在把工作区与任务状态连接起来。',startedAt:previewNow-90000,toolCount:8},
    {id:'sub:read',kind:'sub',runId:'preview-run',name:'Research Agent',role:'researcher',state:'working',zone:'library',tool:'read',label:'阅读项目资料',startedAt:previewNow-60000,toolCount:6},
    {id:'sub:test',kind:'sub',runId:'preview-run',name:'Test Agent',role:'tester',state:'working',zone:'forge',tool:'bash',label:'运行验收测试',startedAt:previewNow-45000,toolCount:3},
    {id:'sub:design',kind:'sub',runId:'preview-run',name:'Build Agent',role:'builder',state:'working',zone:'studio',tool:'image',label:'创作图像',startedAt:previewNow-30000,toolCount:2},
    {id:'sub:rest',kind:'sub',runId:'preview-run-review',name:'Review Agent',role:'reviewer',state:'done',zone:'hall',startedAt:previewNow-100000,toolCount:4}
  ],
  recentEvents: [],
  home: {
    dayPhase:'day',
    buildings:[
      {id:'skill:code',kind:'skill',name:'代码工坊',level:2,uses:4},
      {id:'skill:design',kind:'skill',name:'设计工坊',level:1,uses:2},
      {id:'mcp:browser',kind:'mcp',name:'浏览器港口',level:1,uses:0}
    ],
    memory:{count:3,recent:[{title:'演示记录：中文工作区'}]},
    achievements:[{id:'first-voyage',title:'首航'}]
  }
};
const api = {
  workGuiSnapshot: async () => previewSnapshot,
  onWorkGuiEvent: () => () => {}
};
function loadSession() { return Promise.reject(new Error('Preview session')); }
function showWindowView() {}
function setLeftSidebarOpen() {}
function switchSidebarNav() {}
function toast(message) { console.info(message); }
