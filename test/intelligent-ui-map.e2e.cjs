'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { createIntelligentUi } = require('../lib/intelligent-ui-creator');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-map-ui-'));
// Expose the actual MapLibre instance to the test, without adding a production API.
const inspectMap = `<script>if(window.maplibregl){const NativeMap=window.maplibregl.Map;window.maplibregl.Map=class extends NativeMap{constructor(...args){super(...args);window.__testMap=this;}};}</script>`;
const html = inspectMap + fs.readFileSync(path.join(__dirname, 'fixtures/intelligent-ui-map.html'), 'utf8');
const resources = { map: true, images: [
  'https://upload.wikimedia.org/wikipedia/commons/a/a1/Yan_fixture_waterfront.png',
  'https://upload.wikimedia.org/wikipedia/commons/b/b2/Yan_fixture_park.png'
] };
// Deterministic network stubs exercise real MapLibre rendering and interaction.
// The empty basemap and tiny images are explicitly test fixtures, not evidence of
// real geographic coverage, photographic content, or online service availability.
const mockStyle = {version:8,name:'Interaction test fixture',sources:{fixture:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers:[
  {id:'background',type:'background',paint:{'background-color':'#e5ece7'}},
  {id:'fixture-line',type:'line',source:'fixture'}
]};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOxkAAAAASUVORK5CYII=', 'base64');

(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [process.cwd()], env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.setViewportSize({width:1100,height:900});
    const requests = [];
    let mapNetworkAvailable = true;
    await page.context().route('https://**/*', async route => {
      const url = route.request().url();
      requests.push(url);
      if (url === 'https://tiles.openfreemap.org/styles/positron') {
        if(mapNetworkAvailable)await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mockStyle),headers:{'access-control-allow-origin':'*'}});
        else await route.abort();
      } else if (resources.images.includes(url)) {
        await route.fulfill({status:200,contentType:'image/png',body:png,headers:{'access-control-allow-origin':'*'}});
      } else await route.abort();
    });
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanIntelligentUi);
    const active = { intelligentUiAllowed:true,intelligentUiNetworkAllowed:true };
    const startArgs = {task_id:'map-e2e',action:'start',title:'地点与行程',purpose:'在地图选择地点并保留行程。',placement:'final'};
    const started = createIntelligentUi(active,startArgs.task_id,startArgs);
    const renderArgs = {task_id:startArgs.task_id,action:'render',html,resources};
    const rendered = createIntelligentUi(active,startArgs.task_id,renderArgs);
    await page.evaluate(async ({startArgs,started,renderArgs,rendered}) => {
      if(!state.currentSession)await newSession();
      setEmptyState(false);document.documentElement.dataset.theme='light';
      window.mapTimeline=[
        {type:'tool_call',callId:'map-start',name:'yan_session_intelligent_ui_creator',args:startArgs},
        {type:'tool_result',callId:'map-start',name:'yan_session_intelligent_ui_creator',output:JSON.stringify(started),ok:true},
        {type:'tool_call',callId:'map-render',name:'yan_session_intelligent_ui_creator',args:renderArgs},
        {type:'tool_result',callId:'map-render',name:'yan_session_intelligent_ui_creator',output:JSON.stringify(rendered),ok:true}
      ];
      window.mapBody=appendMessage('assistant','').querySelector('.msg-body');mapBody.id='map-test-message';
      renderAgentRunBody(mapBody,{status:'done',summaryStarted:true,timeline:mapTimeline,modelId:'deepseek-v4'});
    },{startArgs,started,renderArgs,rendered});
    const panel = page.locator('#map-test-message .intelligent-ui-output');
    const ui = page.frameLocator('#map-test-message .intelligent-ui-frame').frameLocator('iframe');
    await ui.locator('body[data-map-ready=true]').waitFor();
    assert.equal(await ui.locator('.maplibregl-map').count(),1);
    await ui.locator('.yan-mini-map[data-loaded=true]').waitFor();
    assert.ok(requests.includes('https://tiles.openfreemap.org/styles/positron'),'map requests the granted vector style');
    assert.match(await ui.locator('.yan-map-attribution').textContent(),/OpenStreetMap.*OpenMapTiles.*OpenFreeMap/);
    assert.equal(await ui.locator('#photo').evaluate(image=>image.complete && image.naturalWidth>0),true,'declared image loads');
    assert.equal(await ui.locator('.yan-map-marker-icon').count(),3);

    const beforeZoom = await ui.locator('body').evaluate(()=>window.__testMap.getZoom());
    await ui.locator('.yan-map-zoom button[aria-label="放大"]').click();
    assert.ok(await ui.locator('body').evaluate(()=>window.__testMap.getZoom())>beforeZoom,'zoom changes the actual camera');
    await ui.locator('.maplibregl-canvas').scrollIntoViewIfNeeded();
    const beforePan=await ui.locator('body').evaluate(()=>window.__testMap.getCenter().toArray());
    const canvas=await ui.locator('.maplibregl-canvas').boundingBox();
    await page.mouse.move(canvas.x+60,canvas.y+60);await page.mouse.down();
    await page.mouse.move(canvas.x+140,canvas.y+100,{steps:6});await page.mouse.up();
    assert.notDeepEqual(await ui.locator('body').evaluate(()=>window.__testMap.getCenter().toArray()),beforePan,'pointer drag pans the map');
    await ui.locator('#fit').click();
    await ui.locator('.yan-map-marker-icon[title="公园测试点"]').click();
    assert.equal(await ui.locator('#place-name').textContent(),'公园测试点');
    assert.equal(await ui.locator('#photo').getAttribute('src'),resources.images[1]);
    await ui.locator('#keep').click();
    await ui.locator('#save-status[data-saved=true]').waitFor();
    assert.equal(await ui.locator('#saved-list').textContent(),'行程：公园测试点');

    const restore=async()=>{
      await page.evaluate(()=>{
        mapBody.replaceChildren();
        renderAgentRunBody(mapBody,{status:'done',summaryStarted:true,timeline:JSON.parse(JSON.stringify(mapTimeline)),modelId:'deepseek-v4'});
      });
      await ui.locator('body[data-map-ready=true]').waitFor();
    };
    await restore();
    assert.equal(await ui.locator('#place-name').textContent(),'公园测试点','history restores selected place');
    assert.equal(await ui.locator('#saved-list').textContent(),'行程：公园测试点','history restores itinerary');
    await ui.locator('.yan-mini-map[data-loaded=true]').waitFor();
    await ui.locator('#route').click();
    assert.equal(await ui.locator('#place-name').textContent(),'测试连线');
    assert.equal(await ui.locator('body').evaluate(()=>window.__testMap.getPaintProperty('yan-ui-route-0','line-width')),7,'route selection highlights route geometry');
    await ui.locator('body').evaluate(()=>new Promise(resolve=>{const map=window.__testMap;if(map.loaded())resolve();else map.once('idle',resolve);}));
    assert.ok(await ui.locator('body').evaluate(()=>window.__testMap.queryRenderedFeatures({layers:['yan-ui-route-0']}).length>0),'the actual canvas renders supplied route geometry');
    assert.match(await ui.locator('#place-detail').textContent(),/不代表道路/);
    await ui.locator('#fit').click();
    await ui.locator('.yan-map-marker-icon').nth(2).click();
    assert.equal(await ui.locator('#place-name').textContent(),'<img src=x onerror="window.labelInjected=true">');
    assert.equal(await ui.locator('.yan-map-popup img').count(),0,'marker labels are literal text');
    assert.equal(await ui.locator('body').evaluate(()=>window.labelInjected),undefined);
    await ui.locator('#fit').click();
    await ui.locator('body').evaluate(()=>new Promise(resolve=>{const map=window.__testMap;if(map.loaded())resolve();else map.once('idle',resolve);}));
    const linePoint=await ui.locator('body').evaluate(()=>{
      const point=window.__testMap.project([-122.4089,37.80675]);
      return {x:point.x,y:point.y};
    });
    await ui.locator('.maplibregl-canvas').click({position:linePoint});
    assert.equal(await ui.locator('#place-name').textContent(),'测试连线','clicking the actual rendered route selects its details');

    // An approved image does not grant general images, fetch or remote script execution.
    const security=await ui.locator('body').evaluate(async()=>{
      const load=(kind,url)=>new Promise(resolve=>{
        const node=document.createElement(kind);node.onload=()=>{node.remove();resolve(true);};node.onerror=()=>{node.remove();resolve(false);};node.src=url;document.body.append(node);
      });
      let fetchBlocked=false,parentBlocked=false;
      try{await fetch('https://upload.wikimedia.org/wikipedia/commons/a/a1/Yan_fixture_waterfront.png');}catch{fetchBlocked=true;}
      try{void parent.document;}catch{parentBlocked=true;}
      return {fetchBlocked,parentBlocked,remoteScript:await load('script','https://upload.wikimedia.org/remote.js'),generalImage:await load('img','https://example.com/photo.png'),undeclaredImage:await load('img','https://upload.wikimedia.org/wikipedia/commons/x/xx/not-declared.png'),node:typeof require,host:typeof window.yan};
    });
    assert.deepEqual(security,{fetchBlocked:true,parentBlocked:true,remoteScript:false,generalImage:false,undeclaredImage:false,node:'undefined',host:'undefined'});
    assert.equal(requests.some(url=>url.includes('remote.js') || url.includes('not-declared') || url.includes('example.com')),false,'CSP blocks ungranted requests before network');
    for(const width of [320,414,760]){
      await panel.evaluate((element,width)=>{element.style.width=width+'px';},width);
      await ui.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.ok(await ui.locator('body').evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`map panel fits ${width}px`);
    }
    await ui.locator('#fit').click();
    await ui.locator('.yan-map-marker-icon[title="公园测试点"]').click();
    fs.mkdirSync('output/playwright/intelligent-ui',{recursive:true});
    await panel.screenshot({path:'output/playwright/intelligent-ui/map-mocked.png'});

    // Capability identity contributes to state identity, even if content/revision are unchanged.
    await ui.locator('#save-status[data-saved=true]').waitFor();
    await page.evaluate(()=>{
      const call=mapTimeline[2],result=mapTimeline[3];
      const item=YanIntelligentUi.fromCall(call,result,'done');
      item.resources={map:true,images:[]};
      YanIntelligentUi.update(document.querySelector('#map-test-message .intelligent-ui-output'),item);
    });
    await ui.locator('body[data-map-ready=true]').waitFor();
    assert.equal(await ui.locator('#saved-list').textContent(),'行程为空','resource changes reset persisted state identity');

    // Network failure reports the unavailable map while preserving working choices.
    mapNetworkAvailable=false;
    await restore();
    await ui.locator('.yan-map-status[data-state=error]').waitFor();
    assert.equal(await ui.locator('.yan-map-status').isVisible(),true,'map failures are visible');
    assert.equal(await ui.locator('#saved-list').textContent(),'行程：公园测试点','map fetch failure preserves the itinerary');
    assert.equal(await ui.locator('.yan-map-marker-icon').count(),3,'known places stay selectable when the map source fails');

    // Current user network preferences can remove historical online capabilities.
    const requestCount=requests.length;
    await page.evaluate(()=>{state.config.permissions={...state.config.permissions,allowNetwork:false};});
    await restore();
    assert.equal(await ui.locator('#offline-note').isVisible(),true);
    assert.equal(await ui.locator('.maplibregl-map').count(),0);
    assert.equal(await ui.locator('body').evaluate(()=>window.yanUi.capabilities.map),false);
    assert.equal(await ui.locator('#place-name').textContent(),'公园测试点','disabled map retains selected place');
    assert.equal(await ui.locator('#saved-list').textContent(),'行程：公园测试点');
    assert.equal(requests.length,requestCount,'offline history makes no image/tile requests');
    assert.equal(await page.locator('webview').count(),0);
    console.log('PASS real MapLibre camera and route rendering with mocked background/photos, linked details, itinerary restoration, literal labels, resource isolation, manifest state identity, network failures and offline history');
  } finally {
    await app?.close();
    await fs.promises.rm(userData,{recursive:true,force:true,maxRetries:30,retryDelay:200});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
