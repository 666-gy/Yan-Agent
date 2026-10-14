const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-rail-'));
(async () => {
 let app;
 try {
 app = await electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:userData}});
 const page=await app.firstWindow(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>window.__YAN_APP_READY__);
 assert.equal(await page.locator('#taskGitPrToggleBtn, #taskGitPrNotify, #taskGitPrOpenBtn').count(), 0);
 await app.evaluate(({ }, repoRoot) => {
   const gh = process.mainModule.require(repoRoot + '/lib/gh-service.js');
   global.__reviewPermission = 'WRITE';
   global.__reviewError = false;
   global.__reviewFetchCount = 0;
   gh.prMerge = async options => { global.__reviewMerge = options; return {merged:true}; };
   gh.reviewProject = async () => {
     global.__reviewFetchCount++;
     if (global.__reviewError) throw new Error('测试：GitHub 未登录');
     return { repository: {nameWithOwner:'yan/example',developer:'yan',url:'https://github.com/yan/example',permission:global.__reviewPermission}, prs: [
       {number:12,title:'修复项目权限检测',url:'https://github.com/yan/example/pull/12',headRefName:'fix/permissions',baseRefName:'main',headRefOid:'abc',author:{login:'yan'},headRepository:{viewerPermission:global.__reviewPermission},mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',isDraft:false},
       {number:13,title:'来自贡献者的改进',url:'https://github.com/yan/example/pull/13',headRefName:'contribution',baseRefName:'main',headRefOid:'def',author:{login:'contributor'},headRepository:{viewerPermission:'READ'},mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',isDraft:false},
       {number:14,title:'尚在开发的草稿',url:'https://github.com/yan/example/pull/14',headRefName:'draft',baseRefName:'main',headRefOid:'ghi',author:{login:'yan'},headRepository:{viewerPermission:'READ'},mergeable:'UNKNOWN',mergeStateStatus:'UNKNOWN',isDraft:true}
     ] };
   };
 }, root);
 await page.setViewportSize({width:1280,height:900});
 const out=path.join(root,'output/playwright/navigation-rail'); fs.mkdirSync(out,{recursive:true});
 assert.equal(await page.locator('#guideBtn,#guideHint,#themeToggle,#apiConfigQuickBtn,#settingsMenu').count(),0);
 assert.deepEqual(await page.locator('#appRail button[data-nav]').evaluateAll(nodes => nodes.map(node => node.dataset.nav)), ['tasks', 'plugins', 'code-review']);
 assert.deepEqual(await page.locator('#appRail button[data-nav]').evaluateAll(nodes => nodes.slice(1).map(node => node.getAttribute('aria-label'))), ['扩展', '代码审查']);
 assert.equal(await page.locator('.sidebar-brand-name').textContent(),'Yan Agent');
 assert.equal(await page.locator('.titlebar-brand-name,.sidebar-brand-version').count(),0);
 assert.equal(await page.locator('#appRail [data-nav="plugins"]').getAttribute('aria-label'), '扩展');
 assert.equal(await page.locator('.plugins-choices,.plugins-toolbar').count(), 0);
 assert.deepEqual(await page.locator('#customizationSidebarNav button span').allTextContents(), ['插件', '智能体', '技能', 'MCP']);
 assert.deepEqual(await page.locator('#customizationSidebarNav svg').evaluateAll(nodes => nodes.map(node => node.dataset.keylineIcon)), ['package-plus', 'command', 'wand-sparkles', 'monitor']);
 assert.equal(await page.locator('#customizationSidebarNav').getAttribute('aria-orientation'), 'vertical');
 for(const theme of ['light','dark']) {
 await page.evaluate(t=>applyTheme(t),theme);
 const previousSessions = await page.evaluate(({workspace, nonGit}) => {
   const hiddenWorkspace = workspace + '/renderer';
   const previous = { sessions: state.sessions, meta: workspaceSidebarMeta };
   workspaceSidebarMeta = { ...workspaceSidebarMeta, [workspaceGroupKey(hiddenWorkspace)]: { hidden: true } };
   state.sessions = [{workspace}, {workspace}, {workspace: nonGit}, {workspace: hiddenWorkspace}];
   renderSessionList();
   return previous;
 }, {workspace: root, nonGit: userData});
 const projectStyle = await page.locator('#sessionList .workspace-name').first().evaluate(el => {
   const style = getComputedStyle(el);
   return [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight];
 });
 const labelStyle = await page.locator('#sessionList .project-section-header .sidebar-list-section-label').evaluate(el => {
   const style = getComputedStyle(el);
   return [style.fontFamily, style.fontSize, style.fontWeight];
 });
 const folderIcon = await page.locator('#sessionList .workspace-icon').first().innerHTML();
 await page.locator('#codeReviewNavBtn').click();
 await page.locator('#codeReviewProjectsRefresh').click();
 await page.waitForFunction(() => document.querySelectorAll('#codeReviewProjectList [data-code-review-workspace]').length === 1);
 assert.equal(await page.locator('.sidebar-brand-name').textContent(), '代码审查');
 assert.equal(await page.locator('#agentSidebarNav').isVisible(), false);
 assert.equal(await page.locator('#sidebarTasksPanel').isVisible(), false);
 assert.equal(await page.locator('#customizationSidebarNav').isVisible(), false);
 assert.equal(await page.locator('#pageCodeReview').isVisible(), true);
 assert.equal(await page.locator('#pageChat').isVisible(), false);
 assert.equal(await page.locator('#pagePlugins').isVisible(), false);
 assert.equal(await page.locator('#codeReviewProjectList [data-code-review-workspace]').isDisabled(), false);
 assert.deepEqual(await page.locator('#codeReviewProjectList .workspace-name').evaluate(el => {
   const style = getComputedStyle(el);
   return [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight];
 }), projectStyle);
 assert.deepEqual(await page.locator('#codeReviewSidebarPanel .sidebar-list-section-label').evaluate(el => {
   const style = getComputedStyle(el);
   return [style.fontFamily, style.fontSize, style.fontWeight];
 }), labelStyle);
 assert.equal(await page.locator('#codeReviewProjectList .workspace-icon').innerHTML(), folderIcon);
 assert.equal(await page.locator('#pageCodeReview .workbench-empty-copy').textContent(), '打开一个项目，查看、审查并合并PR');
 await page.screenshot({path:path.join(out,'code-review-'+theme+'.png')});
 await page.locator('#codeReviewProjectList [data-code-review-workspace]').click();
 try { await page.waitForFunction(() => document.querySelectorAll('.code-review-pr-card').length === 3); }
 catch (error) { console.error(errors, await page.locator('#codeReviewDetailContent').textContent()); throw error; }
 assert.equal(await page.locator('#codeReviewDetailContent .plugin-detail-logo, #codeReviewDetailContent .plugin-detail-subtitle, #codeReviewDetailContent .plugin-examples').count(), 0);
 assert.equal(await page.locator('#codeReviewDetailContent .task-git-pr-state').count(), 0);
 assert.equal(await page.locator('[data-review-action="diff"]:disabled').count(), 3);
 assert.equal(await page.locator('[data-review-action="monitor"]').count(), 1);
 assert.equal(await page.locator('[data-pr-number="12"] [data-review-action="merge"]').isEnabled(), true);
 assert.equal(await page.locator('[data-pr-number="14"] [data-review-action="merge"]').isDisabled(), true);
 assert.equal(await page.locator('.code-review-pr-card').first().evaluate(el => getComputedStyle(el).borderRadius), '0px');
 await page.waitForFunction(() => document.getElementById('app').classList.contains('panel-composer-mode'));
 await page.locator('[data-review-action="create"]').click();
 assert.equal(await page.locator('#taskGitPrDialog').isVisible(), true);
 assert.equal(await page.evaluate(() => currentGitWorkspace()), root);
 assert.equal(await page.evaluate(() => currentMainPage), 'code-review');
 await page.locator('#taskGitPrDialogCloseBtn').click();
 const createBox = await page.locator('[data-review-action="create"]').boundingBox();
 const titleBox = await page.locator('#codeReviewPrTitle').boundingBox();
 assert.ok(createBox.x > titleBox.x + titleBox.width);
 assert.equal(await page.locator('[data-review-action="repository"]').textContent(), '');
 assert.equal(await page.locator('[data-review-action="repository"] svg').count(), 1);
 assert.equal(await page.locator('[data-review-action="directory"] img').getAttribute('src'), 'assets/windows-explorer.png');
 assert.equal(await page.locator('#browserFocusStandbyPill').isVisible(), true);
 const cachedFetchCount = await app.evaluate(() => global.__reviewFetchCount);
 await page.locator('#appRail [data-nav="tasks"]').click();
 assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('panel-composer-mode')), false);
 await page.locator('#codeReviewNavBtn').click();
 await page.waitForFunction(() => document.getElementById('app').classList.contains('panel-composer-mode'));
 await page.locator('#codeReviewProjectList [data-code-review-workspace]').click();
 assert.equal(await app.evaluate(() => global.__reviewFetchCount), cachedFetchCount);
 await page.screenshot({path:path.join(out,'code-review-prs-'+theme+'.png')});
 await app.evaluate(() => { global.__reviewPermission = 'READ'; });
 await page.locator('[data-review-action="refresh"]').click();
 await page.waitForFunction(() => !document.querySelector('[data-review-action="merge"]'));
 assert.equal(await page.locator('[data-review-action="monitor"]').count(), 0);
 assert.equal(await page.locator('[data-review-action="ask"]').count(), 3);
 await app.evaluate(() => { global.__reviewError = true; });
 await page.locator('[data-review-action="refresh"]').click();
 await page.waitForFunction(() => document.querySelector('#codeReviewDetailContent [role="alert"]')?.textContent.includes('GitHub 未登录'));
 await app.evaluate(() => { global.__reviewError = false; global.__reviewPermission = 'WRITE'; });
 await page.locator('[data-review-action="refresh"]').click();
 await page.waitForFunction(() => document.querySelector('[data-review-action="merge"]') && !document.querySelector('[data-review-action="refresh"]').disabled);
 await page.locator('[data-pr-number="12"] [data-review-action="merge"]').click();
 await page.locator('#gitActionDialog').waitFor({state:'visible'});
 await page.locator('#gitActionSubmit').click();
 await page.waitForFunction(() => !document.querySelector('[data-review-action="refresh"]').disabled);
 const merge = await app.evaluate(() => global.__reviewMerge);
 assert.equal(merge.number, 12);
 assert.equal(merge.cwd, root);
 assert.equal(merge.expectedHead, 'abc');
 if (theme === 'light') {
   await page.setViewportSize({width:760,height:760});
   assert.equal(await page.locator('#codeReviewDetailPanel').evaluate(el => el.scrollWidth > el.clientWidth), false);
   await page.screenshot({path:path.join(out,'code-review-prs-narrow.png')});
   await page.setViewportSize({width:1280,height:900});
   await page.locator('[data-pr-number="12"] [data-review-action="ask"]').click();
   await page.waitForFunction(() => currentMainPage === 'code-review' && document.querySelector('#composerInput').textContent.includes('我的问题：'));
   assert.equal(await page.evaluate(() => state.currentSession.workspace), root);
   assert.equal(await page.locator('#composerInput').isVisible(), true);
   assert.equal(await page.locator('#composerInput').count(), 1);
   await page.locator('#modelPill').click();
   assert.equal(await page.locator('#modelQuickMenu').isVisible(), true);
   await page.locator('#modelPill').click();
   await page.evaluate(() => {
     state.currentSession.messages = [{role:'user',content:'测试提问'},{role:'assistant',content:'这是最近一条回复'}];
     renderMessages(state.currentSession.messages);
     setEmptyState(false);
     syncBrowserFocusComposerAvailability();
   });
   await page.locator('#browserFocusChatToggle').click();
   assert.equal(await page.locator('#messages .msg').last().isVisible(), true);
   assert.equal(await page.locator('#messages .msg').first().isVisible(), false);
   await page.screenshot({path:path.join(out,'code-review-composer-expanded.png')});
   await page.locator('#browserFocusComposerCollapse').click();
   assert.equal(await page.locator('#browserFocusMinimizedButton').isVisible(), true);
   await page.locator('#browserFocusMinimizedButton').click();
   assert.equal(await page.locator('#composerInput').isVisible(), true);
   await page.locator('#appRail [data-nav="tasks"]').click();
   await page.locator('#codeReviewNavBtn').click();
   await page.waitForFunction(() => document.getElementById('app').classList.contains('panel-composer-mode'));
   assert.ok((await page.locator('#composerInput').textContent()).includes('我的问题：'));
   const reviewSessionId = await page.evaluate(() => state.currentSession.id);
   const beforeSwitch = await app.evaluate(() => global.__reviewFetchCount);
   await page.evaluate(workspace => {
     state.sessions.push({id:'review-second-project-fixture',workspace:workspace+'/lib',updatedAt:0});
   }, root);
   await page.locator('#codeReviewProjectsRefresh').click();
   await page.waitForFunction(() => document.querySelectorAll('#codeReviewProjectList [data-code-review-workspace]').length === 2);
   await page.locator('#codeReviewProjectList [data-code-review-workspace]').filter({hasText:'lib'}).click();
   await page.waitForFunction(workspace => workspaceGroupKey(state.currentSession.workspace) === workspaceGroupKey(workspace+'/lib') && document.getElementById('app').classList.contains('panel-composer-mode'), root);
   assert.equal(await page.locator('#composerInput').textContent(), '');
   await page.locator('#codeReviewProjectList [data-code-review-workspace]').filter({hasText:'Yan Agent'}).click();
   await page.waitForFunction(id => state.currentSession.id === id && document.getElementById('app').classList.contains('panel-composer-mode'), reviewSessionId);
   assert.ok((await page.locator('#composerInput').textContent()).includes('我的问题：'));
   assert.equal(await app.evaluate(() => global.__reviewFetchCount), beforeSwitch + 1);
   await page.evaluate(() => {
     window.__reviewOriginalSubmit = submitMessage;
     submitMessage = async text => {
       window.__reviewSubmitted = {text,page:currentMainPage,workspace:state.currentSession.workspace};
       return {ok:true};
     };
   });
   await page.locator('#browserFocusStandbyPill').click();
   await page.locator('#sendBtn').click();
   await page.waitForFunction(() => !!window.__reviewSubmitted);
   const submitted = await page.evaluate(() => window.__reviewSubmitted);
   assert.equal(submitted.page, 'code-review');
   assert.equal(submitted.workspace, root);
   assert.ok(submitted.text.includes('我的问题：'));
   await page.evaluate(() => { submitMessage = window.__reviewOriginalSubmit; });
   await page.evaluate(workspace => {
     state.sessions = state.sessions.filter(session => session.id !== 'review-second-project-fixture');
     workspaceSidebarMeta[workspaceGroupKey(workspace+'/lib')] = {hidden:true};
   }, root);
   await page.locator('#codeReviewProjectsRefresh').click();
 }
 await page.locator('[data-review-action="back"]').click();
 await page.locator('#sidebarToggle').click();
 await page.locator('#codeReviewNavBtn').click();
 assert.equal(await page.locator('#sidebar').isVisible(), true);
 await page.evaluate(previous => { state.sessions = previous.sessions; workspaceSidebarMeta = previous.meta; renderSessionList(); }, previousSessions);
 await page.locator('#appRail [data-nav="tasks"]').click();
 assert.equal(await page.locator('#codeReviewSidebarPanel').isVisible(), false);
 assert.equal(await page.locator('#pageCodeReview').isVisible(), false);
 await page.screenshot({path:path.join(out,theme+'.png')});
 assert.equal((await page.locator('#appRail').boundingBox()).width,48);
 assert.equal(await page.locator('.app-rail-button').first().evaluate(e=>getComputedStyle(e).borderRadius),'50%');
 for(const nav of ['packages','skills','mcp','tasks']) {
 if (nav === 'tasks') await page.locator('#appRail [data-nav="tasks"]').click();
 else {
   await page.locator('#appRail [data-nav="plugins"]').click();
   assert.equal(await page.locator('#pagePlugins').isVisible(),true);
   assert.equal(await page.locator('#sidebar').isVisible(),true, 'Customize reuses the visible application sidebar');
   assert.equal(await page.locator('.sidebar-brand-name').textContent(), '扩展');
   assert.equal(await page.locator('#agentSidebarNav').isVisible(),false);
   assert.equal(await page.locator('#sidebarTasksPanel').isVisible(),false);
   assert.equal(await page.locator('#sidebar #customizationSidebarNav').isVisible(),true);
   await page.locator(`[data-plugin-page="${nav}"]`).click();
   const panel = await page.locator('#pagePlugins').boundingBox();
   const sidebar = await page.locator('#sidebar').boundingBox();
   assert.ok(panel.x >= sidebar.x + sidebar.width);
   assert.equal(await page.locator(`[data-plugin-page="${nav}"]`).getAttribute('aria-selected'),'true');
   await page.screenshot({path:path.join(out,'plugins-'+nav+'-'+theme+'.png')});
   assert.equal(await page.locator('#appRail [data-nav="plugins"]').getAttribute('aria-current'),'page');
   await page.locator('#sidebarToggle').click();
   assert.equal(await page.locator('#sidebar').isVisible(),false);
   assert.equal(await page.locator('#sidebar').getAttribute('inert'),'');
   assert.equal(await page.locator('#sidebarToggle').getAttribute('aria-expanded'),'false');
   assert.ok(Math.abs((await page.locator('#pagePlugins').boundingBox()).x - 48) < 1);
   assert.equal(await page.locator('#pagePlugins').isVisible(),true);
   await page.keyboard.press('Control+b');
   assert.equal(await page.locator('#sidebar').isVisible(),true);
   assert.equal(await page.locator(`[data-plugin-page="${nav}"]`).getAttribute('aria-selected'),'true');
 }
 assert.equal(await page.locator('#page'+({packages:'PluginPackages',skills:'Skills',mcp:'Mcp',tasks:'Chat'}[nav])).isVisible(),true);
 }
 assert.equal(await page.locator('.sidebar-brand-name').textContent(),'Yan Agent');
 assert.equal(await page.locator('#agentSidebarNav').isVisible(),true);
 assert.equal(await page.locator('#customizationSidebarNav').isVisible(),false);
 await page.locator('#settingsBtn').click();
 assert.equal(await page.locator('#settingsOverlay').isVisible(),true);
 assert.equal((await page.locator('#settingsOverlay').boundingBox()).x,48);
 await page.locator('#appRail [data-nav="tasks"]').click();
 assert.equal(await page.locator('#pageChat').isVisible(),true);
 await page.locator('#sidebarToggle').click();
 assert.equal(await page.locator('#sidebar').isVisible(),false);
 assert.equal((await page.locator('#pageChat').boundingBox()).x,48);
 await page.locator('#sidebarToggle').click();
 }
 await page.locator('#appRail [data-nav="plugins"]').click();
 await page.locator('#pluginsPackagesTab').focus(); await page.keyboard.press('ArrowDown');
 assert.equal(await page.locator('#pluginsAgentsTab').getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowDown');
 assert.equal(await page.locator('#pluginsSkillsTab').getAttribute('aria-selected'),'true');
 await page.keyboard.press('End'); assert.equal(await page.locator('#pluginsMcpTab').getAttribute('aria-selected'),'true');
 await page.keyboard.press('Home'); assert.equal(await page.locator('#pluginsPackagesTab').getAttribute('aria-selected'),'true');
 await page.setViewportSize({width:760,height:760});
 await page.screenshot({path:path.join(out,'customize-narrow.png')});
 await page.locator('#sidebarToggle').click();
 assert.equal(await page.locator('#pagePluginPackages').evaluate(el=>el.scrollWidth>el.clientWidth),false);
 await page.screenshot({path:path.join(out,'customize-collapsed.png')});
 await page.locator('#appRail [data-nav="plugins"]').click();
 assert.equal(await page.locator('#sidebar').isVisible(),true, 'the active rail entry can restore hidden navigation');
 await page.locator('#settingsBtn').click();
 await page.locator('#appRail [data-nav="plugins"]').click();
 assert.equal(await page.locator('#pagePluginPackages').isVisible(),true);
 assert.equal(await page.locator('#customizationSidebarNav').isVisible(),true);
 await page.setViewportSize({width:1280,height:900});
 await page.locator('#appRail [data-nav="tasks"]').click();
 const handle=await page.locator('#leftResizeHandle').boundingBox();
 await page.mouse.move(handle.x+2,handle.y+100); await page.mouse.down(); await page.mouse.move(350,handle.y+100); await page.mouse.up();
 assert.ok(Math.abs((await page.locator('#sidebar').boundingBox()).width-302)<=8, 'sidebar follows drag relative to the fixed rail');
 assert.equal((await page.locator('#appRail').boundingBox()).width,48);
 await page.evaluate(()=>{openRightSidebarTool('browser'); setBrowserFocusMode(true);});
 const browser=await page.locator('#rightSidebar').boundingBox(); assert.ok(browser.x>=350);
 await page.evaluate(()=>{ setBrowserFocusMode(false); setLeftSidebarOpen(false); setBrowserFocusMode(true); });
 await page.waitForFunction(()=>Math.abs(document.getElementById('rightSidebar').getBoundingClientRect().x-48)<1);
 assert.deepEqual(errors,[]);
 console.log('PASS navigation rail: Customize sidebar, three pages, Keyline icons, vertical keyboard navigation, collapse/reopen, themes, settings, resize, browser focus, no renderer errors');
 } finally {
   const child=app?.process(); const stopped=child&&child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve();
   if(app) await app.close(); await stopped;
   assert.equal(path.dirname(userData),path.resolve(os.tmpdir())); await fs.promises.rm(userData,{recursive:true,force:true,maxRetries:10,retryDelay:250});
 }
})().catch(e=>{console.error(e);process.exitCode=1});

