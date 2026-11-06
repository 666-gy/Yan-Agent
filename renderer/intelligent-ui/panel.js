import {isTool,fromCall,projectTimeline} from './protocol.js';
import {panelKey,savedPanels,savePanel} from './state-store.js';
import {loadOpenUi,loadMap} from './runtime-loader.js';

const controllers = new WeakMap();
const sources = new WeakMap();
const language=()=>window.YanIntelligentUiI18n.normalizeLanguage(document.documentElement.dataset.language || document.documentElement.lang);
const copy=key=>window.YanIntelligentUiI18n.translate(language(),key);
const online=()=>typeof state==='undefined' || state.config?.permissions?.allowNetwork!==false;

class Panel {
  constructor(element) {this.element=element;this.surface=element.querySelector('.intelligent-ui-surface');this.status=element.querySelector('.intelligent-ui-status');}
  setStatus(key){this.status.textContent=copy(key);}
  dispose(){this.cancelled=true; if(this.frame){sources.delete(this.frame.contentWindow);this.frame.remove();} this.surface.replaceChildren();}
  update(item) {
    this.element.querySelector('h3').textContent=item.title;
    this.element.querySelector('.intelligent-ui-purpose').textContent=item.purpose || '';
    const fingerprint=JSON.stringify([item.id,item.revision,item.format,item.html,item.code,item.resources,item.handoff,item.status,item.title,language(),document.documentElement.dataset.theme,online()]);
    if(this.fingerprint===fingerprint)return;
    this.dispose();this.cancelled=false;this.fingerprint=fingerprint;this.item=item;this.summary='';
    this.element.dataset.state=item.status;
    this.setStatus('status.'+item.status);
    if(!item.html && !item.code)return;
    const frame=document.createElement('iframe');this.frame=frame;
    frame.className='intelligent-ui-frame';frame.title=item.title;
    frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
    frame.style.colorScheme=document.documentElement.dataset.theme==='dark'?'dark':'light';
    frame.onload=()=>this.initialize(frame,item,fingerprint);
    frame.src=new URL('intelligent-ui-host.html',document.baseURI).href;
    this.surface.append(frame);
    if(item.handoff===true && item.format==='openui') {
      const button=document.createElement('button');this.handoff=button;
      button.className='intelligent-ui-handoff';button.textContent=copy('handoff.ready');button.disabled=true;
      button.onclick=()=>this.prepareDraft();this.surface.append(button);
    } else this.handoff=null;
  }
  async initialize(frame,item,fingerprint) {
    try {
      const key=await panelKey(item).catch(()=>null);
      const resources=online()?item.resources:null;
      const [openui,runtime]=await Promise.all([
        item.format==='openui'?loadOpenUi():null,
        resources?.map?loadMap().catch(()=>{this.setStatus('status.mapLoadFailed');return null;}):null
      ]);
      if(this.cancelled || this.fingerprint!==fingerprint || !frame.isConnected)return;
      this.key=key;sources.set(frame.contentWindow,this);
      const saved=key?savedPanels().find(record=>record.key===key):null;
      frame.contentWindow.postMessage({type:'yan-ui-render',html:item.html,format:item.format,code:item.code,
        state:saved?JSON.parse(saved.json):null,resources,runtime,openui:openui?.script,openuiCss:openui?.css,
        title:item.title,lang:language(),dark:document.documentElement.dataset.theme==='dark'},'*');
    } catch {if(this.fingerprint===fingerprint)this.setStatus('status.openuiLoadFailed');}
  }
  prepareDraft() {
    if(!this.summary || !this.frame.isConnected)return;
    const text=this.item.title+'\n'+this.summary;
    if(typeof getComposerText==='function' && typeof setComposerText==='function') {
      const draft=getComposerText();setComposerText((draft?draft+'\n\n':'')+text);
      const input=document.getElementById('composerInput');input?.dispatchEvent(new Event('input',{bubbles:true}));input?.focus();
    } else {
      let output=this.surface.querySelector('.intelligent-ui-result');
      if(!output){output=document.createElement('pre');output.className='intelligent-ui-result';output.tabIndex=0;this.surface.append(output);}
      output.textContent=text;output.focus();
    }
    this.handoff.textContent=copy('handoff.prepared');
  }
  receive(data) {
    if(data.type==='yan-ui-size' && Number.isFinite(data.height))this.frame.style.height=Math.max(1,Math.min(20000,Math.ceil(data.height)))+'px';
    else if(data.type==='yan-ui-error')this.setStatus('status.runtimeError');
    else if(data.type==='yan-ui-summary' && this.item.format==='openui' && typeof data.text==='string' && data.text.length<=8000) {
      this.summary=data.text;
      if(this.handoff){this.handoff.disabled=!this.summary;this.handoff.textContent=copy('handoff.ready');}
    } else if(data.type==='yan-ui-state' && Number.isSafeInteger(data.requestId)) {
      const ok=savePanel(this.key,data.json);
      this.frame.contentWindow.postMessage({type:'yan-ui-state-result',requestId:data.requestId,ok},'*');
    }
  }
}
function create() {
  const element=document.createElement('section');element.className='intelligent-ui-output';
  element.innerHTML='<header class="intelligent-ui-heading"><h3></h3><span class="intelligent-ui-status" role="status"></span></header><p class="intelligent-ui-purpose"></p><div class="intelligent-ui-surface"></div>';
  controllers.set(element,new Panel(element));return element;
}
function update(element,item) {let panel=controllers.get(element);if(!panel){panel=new Panel(element);controllers.set(element,panel);}panel.update(item);}
addEventListener('message',event=>{const panel=sources.get(event.source);if(panel?.frame.isConnected && event.data && typeof event.data==='object')panel.receive(event.data);});
window.YanIntelligentUi={isTool,fromCall,projectTimeline,create,update};
