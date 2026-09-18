/* User-owned annotations. The guest supplies bounded metadata, never host UI or commands. */
(() => {
  window.YanApplyAnnotation=function(request){
    const element=window.__yanAnnotationTargets?.get(request.id);
    if(location.href!==request.url||!element?.isConnected)return {ok:false,error:'选定元素已失效，请重新注释'};
    const allowed={color:'color',background:'background-color',opacity:'opacity',fontFamily:'font-family',fontSize:'font-size',fontWeight:'font-weight'};
    const styles=request.styles||{};
    if(request.text===undefined&&!Object.keys(styles).length)return {ok:false,error:'没有提供修改内容，请按用户注释传入 text 或 styles'};
    for(const [key,value] of Object.entries(styles)){if(!allowed[key]||typeof value!=='string'||value.length>300||!CSS.supports(allowed[key],value))return {ok:false,error:'无效样式 '+key};}
    if(request.text!==undefined){
      if(typeof request.text!=='string'||request.text.length>4000)return {ok:false,error:'无效文字'};
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),nodes=[];let node;
      while((node=walker.nextNode()))if(node.textContent.trim()&&!node.parentElement.closest('svg,script,style,[aria-hidden="true"]'))nodes.push(node);
      if(nodes.length>1)return {ok:false,error:'目标包含多段文字，请选择具体文字元素，以免破坏其他内容'};
      if(nodes.length)nodes[0].textContent=request.text;
      else if(!element.children.length)element.textContent=request.text;
      else return {ok:false,error:'目标没有可安全替换的文字，请选择具体文字元素'};
    }
    for(const [key,value] of Object.entries(styles))element.style.setProperty(allowed[key],value,'important');
    const computed=getComputedStyle(element);
    return {ok:true,scope:'local-page-preview',text:element.textContent?.slice(0,4000),styles:Object.fromEntries(Object.keys(styles).map(key=>[key,computed.getPropertyValue(allowed[key])])),output:'已修改原注释元素并读取结果；刷新页面会失效。'};
  };
  function inspectPoint(x,y,annotationId) {
    let el=document.elementFromPoint(x*innerWidth,y*innerHeight);
    while(el?.shadowRoot?.elementFromPoint){const child=el.shadowRoot.elementFromPoint(x*innerWidth,y*innerHeight);if(!child||child===el)break;el=child;}
    if(!el)return null;
    const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
    const parts=[];let current=el;
    for(let i=0;current&&i<7;i++,current=current.parentElement){
      if(current.id){parts.unshift('#'+CSS.escape(current.id));break;}
      let part=current.localName;const parent=current.parentElement;
      if(parent){const siblings=[...parent.children].filter(n=>n.localName===current.localName);if(siblings.length>1)part+=':nth-of-type('+(siblings.indexOf(current)+1)+')';}
      parts.unshift(part);
    }
    const sensitive=el.matches('input,textarea,[contenteditable="true"]')||el.closest('[contenteditable="true"]');
    if(annotationId){const targets=window.__yanAnnotationTargets ||= new Map();targets.set(annotationId,el);
    if(targets.size>40)targets.delete(targets.keys().next().value);}
    return {annotationId,url:location.href,title:document.title.slice(0,200),tag:el.localName,selector:parts.join(' > '),shadow:el.getRootNode()!==document,
      text:sensitive?'':String(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,300),
      control:el.matches('input,select,textarea')?{type:el.type||el.localName,checked:el.checked===true,value:el.matches('input[type="password"]')?'':String(el.value||'').slice(0,120),options:el.localName==='select'?[...el.options].slice(0,12).map(o=>({text:o.textContent,value:o.value,selected:o.selected})):[]}:null,
      rect:{x:rect.x/innerWidth,y:rect.y/innerHeight,width:rect.width/innerWidth,height:rect.height/innerHeight},
      size:Math.round(rect.width)+' × '+Math.round(rect.height),styles:{font:style.fontSize+' '+style.fontFamily,color:style.color,background:style.backgroundColor,opacity:style.opacity,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,padding:style.padding,display:style.display}};
  }
  window.YanBrowserAnnotations={init(controller,{onAdd,notify=()=>{}}={}){
    const {panel,webview,root}=controller;
    const button=document.createElement('button');button.type='button';button.className='tool-panel-nav-btn browser-annotate-btn';button.dataset.browserAction='annotate';button.title='注释网页';button.setAttribute('aria-label','注释网页');button.setAttribute('aria-pressed','false');
    const icon=document.querySelector('[data-rs-dock-tool="interjection"] svg');if(icon)button.append(icon.cloneNode(true));
    const settingsWrap=root.querySelector('[data-browser-settings-wrap]');const actions=document.createElement('div');actions.className='browser-toolbar-actions';settingsWrap.before(actions);actions.append(button,settingsWrap);
    const layer=document.createElement('div');layer.className='browser-annotation-layer';layer.hidden=true;layer.tabIndex=-1;
    layer.innerHTML=`<div class="browser-annotation-box"></div><div class="browser-annotation-info" role="status"></div><form class="browser-annotation-editor" hidden>
      <div class="annotation-pill"><button type="button" data-note="settings" aria-label="注释参数设置" aria-expanded="false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7h7m4 0h7M3 17h3m4 0h11"/><circle cx="12" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button><textarea rows="1" maxlength="4000" aria-label="网页注释内容" placeholder="添加评论..."></textarea><button class="annotation-confirm" type="submit" aria-label="加入对话" disabled><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 12 4 4 8-10"/></svg></button></div>
      <section class="annotation-options" hidden aria-label="元素参数"><header><span class="annotation-target"></span><span aria-hidden="true">⠿</span></header><div class="annotation-fields">
      <label>文本颜色<span class="annotation-color"><i></i><input data-style="color" aria-label="文本颜色"></span></label>
      <label>背景<span class="annotation-color"><i></i><input data-style="background" aria-label="背景"></span></label>
      <label>Opacity<input data-style="opacity" type="number" min="0" max="1" step="0.05" aria-label="Opacity"></label><hr>
      <label>字体<input data-style="fontFamily" aria-label="字体" list="annotation-fonts"></label><datalist id="annotation-fonts"><option value="sans-serif"><option value="serif"><option value="Microsoft YaHei"><option value="SimSun"></datalist>
      <label>字号<span class="annotation-unit"><input data-style="fontSize" type="number" min="1" max="999" aria-label="字号"><span>px</span></span></label>
      <label>字重<select data-style="fontWeight" aria-label="字重"><option>100</option><option>200</option><option>300</option><option>400</option><option>500</option><option>600</option><option>700</option><option>800</option><option>900</option></select></label>
      </div><footer><button type="button" data-note="cancel-settings">取消</button><button type="button" class="annotation-confirm" data-note="confirm-settings" aria-label="确认参数">✓</button></footer></section></form>`;
    panel.append(layer);
    const box=layer.querySelector('.browser-annotation-box'),info=layer.querySelector('.browser-annotation-info'),form=layer.querySelector('form'),input=form.querySelector('textarea'),options=form.querySelector('.annotation-options');
    let active=false,disposed=false,epoch=0,busy=false,pending=null,selected=null,styleChanges={};
    const resize=()=>{const a=panel.getBoundingClientRect(),b=webview.getBoundingClientRect();Object.assign(layer.style,{left:(b.left-a.left)+'px',top:(b.top-a.top)+'px',width:b.width+'px',height:b.height+'px'});if(selected)paint(selected);};
    function paint(data){const r=data.rect,w=layer.clientWidth,h=layer.clientHeight;Object.assign(box.style,{left:r.x*w+'px',top:r.y*h+'px',width:r.width*w+'px',height:r.height*h+'px'});info.replaceChildren();for(const [label,value] of [[data.tag,data.size.replace(' × ','x')],['颜色',data.styles.color],['字体',data.styles.font]]){const row=document.createElement('div'),key=document.createElement('span'),val=document.createElement('strong');key.textContent=label;val.textContent=value;val.title=value;row.append(key,val);info.append(row);}Object.assign(info.style,{left:Math.max(8,Math.min(w-300,r.x*w))+'px',top:Math.max(8,Math.min(h-90,(r.y+r.height)*h+8))+'px'});box.hidden=false;}
    function closeEditor(){selected=null;styleChanges={};form.hidden=true;options.hidden=true;form.classList.remove('settings-open');info.hidden=false;input.value='';form.querySelector('[type=submit]').disabled=true;}
    function stop(){active=false;epoch++;pending=null;layer.hidden=true;panel.classList.remove('annotation-active');button.setAttribute('aria-pressed','false');closeEditor();}
    async function sample(point,choose=false){
      if(!choose&&selected)return;
      const token=epoch;try{const data=await webview.executeJavaScript('('+inspectPoint.toString()+')('+point.x+','+point.y+','+JSON.stringify(choose?crypto.randomUUID():null)+')');if(!active||disposed||token!==epoch||!data||(!choose&&selected))return;
        paint(data);if(choose){selected=data;info.hidden=true;form.hidden=false;form.querySelector('.annotation-target').textContent='<'+data.tag+'>';styleChanges={};form.style.left=Math.max(8,Math.min(layer.clientWidth-376,point.x*layer.clientWidth))+'px';form.style.top=Math.max(8,Math.min(layer.clientHeight-76,point.y*layer.clientHeight+14))+'px';input.focus();}
      }catch{if(active&&token===epoch){stop();notify('当前页面暂时无法注释，请等待加载完成后重试');}}
    }
    async function hover(){if(busy)return;busy=true;try{while(pending&&active){const point=pending;pending=null;await sample(point);}}finally{busy=false;}}
    button.addEventListener('click',()=>{if(active){stop();return;}if(controller.agentControlActive||!controller.domReady){notify('请等待页面就绪或结束 Agent 操控');return;}active=true;epoch++;layer.hidden=false;box.hidden=true;info.textContent='将鼠标移到元素上，点击添加注释';panel.classList.add('annotation-active');button.setAttribute('aria-pressed','true');resize();layer.focus();});
    layer.addEventListener('pointermove',e=>{if(e.target.closest('form'))return;const r=layer.getBoundingClientRect();pending={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};void hover();});
    layer.addEventListener('wheel',e=>{if(e.target.closest('form'))return;e.preventDefault();epoch++;pending=null;closeEditor();box.hidden=true;info.textContent='滚动后选择元素';const scale=e.deltaMode===1?16:e.deltaMode===2?layer.clientHeight:1;void webview.executeJavaScript('window.scrollBy('+Number(e.deltaX*scale)+','+Number(e.deltaY*scale)+')').catch(()=>{});},{passive:false});
    layer.addEventListener('click',e=>{if(e.target.closest('form'))return;e.preventDefault();pending=null;epoch++;closeEditor();const r=layer.getBoundingClientRect();void sample({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height},true);});
    layer.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(selected)closeEditor();else stop();}if(e.target===input&&e.key==='Enter'&&!e.shiftKey&&selected){e.preventDefault();e.stopPropagation();form.requestSubmit();}});
    function updateSubmit(){form.querySelector('[type=submit]').disabled=!input.value.trim()&&!Object.keys(styleChanges).length;}
    input.addEventListener('input',()=>{updateSubmit();input.style.height='26px';input.style.height=Math.min(120,input.scrollHeight)+'px';});
    // The pill is draggable like the native browser annotation composer.
    let drag=null;
    for(const pill of [form.querySelector('.annotation-pill'),options.querySelector('header')]){
    pill.addEventListener('pointerdown',e=>{
      if(e.target.closest('textarea,button'))return;
      e.preventDefault();pill.setPointerCapture?.(e.pointerId);
      drag={x:e.clientX,y:e.clientY,left:parseFloat(form.style.left)||0,top:parseFloat(form.style.top)||0};
      form.classList.add('annotation-dragging');
    });
    pill.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;form.style.left=Math.max(8,Math.min(layer.clientWidth-form.offsetWidth-8,drag.left+dx))+'px';form.style.top=Math.max(8,Math.min(layer.clientHeight-form.offsetHeight-8,drag.top+dy))+'px';});
    const endDrag=()=>{if(!drag)return;drag=null;form.classList.remove('annotation-dragging');};
    pill.addEventListener('pointerup',endDrag);pill.addEventListener('pointercancel',endDrag);
    pill.addEventListener('lostpointercapture',endDrag);
    }
    function hideSettings(){options.hidden=true;form.classList.remove('settings-open');form.querySelector('[data-note="settings"]').setAttribute('aria-expanded','false');}
    form.querySelector('[data-note="settings"]').onclick=()=>{
      if(!options.hidden){hideSettings();return;}options.hidden=false;form.classList.add('settings-open');form.querySelector('[data-note="settings"]').setAttribute('aria-expanded','true');
      for(const field of options.querySelectorAll('[data-style]')){const key=field.dataset.style;field.value=key==='fontSize'?parseFloat(styleChanges[key]||selected.styles[key]):styleChanges[key]||selected.styles[key];const swatch=field.previousElementSibling;if(swatch)swatch.style.background=field.value;}
      form.style.top=Math.max(8,Math.min(parseFloat(form.style.top),layer.clientHeight-380))+'px';
    };
    options.addEventListener('input',e=>{const swatch=e.target.previousElementSibling;if(swatch&&e.target.closest('.annotation-color'))swatch.style.background=e.target.value;});
    form.querySelector('[data-note="cancel-settings"]').onclick=hideSettings;
    function collectStyles(){
      const changes={};for(const field of options.querySelectorAll('[data-style]')){if(!field.checkValidity()){field.reportValidity();return;}const key=field.dataset.style;const value=key==='fontSize'?field.value+'px':field.value.trim();if(value!==selected.styles[key])changes[key]=value;}
      styleChanges=changes;return true;
    }
    form.querySelector('[data-note="confirm-settings"]').onclick=()=>{
      if(!collectStyles())return;hideSettings();updateSubmit();if(Object.keys(styleChanges).length||input.value.trim())form.requestSubmit();else input.focus();
    };
    let sending=false;
    form.addEventListener('submit',async e=>{e.preventDefault();if(sending||!selected)return;if(!options.hidden&&!collectStyles())return;if(!input.value.trim()&&!Object.keys(styleChanges).length)return;
      sending=true;const target=selected;form.querySelector('[type=submit]').disabled=true;
      try{const result=await onAdd?.({comment:input.value.trim(),requestedStyles:{...styleChanges},...target});if(result?.ok===false)throw new Error(result.error||'发送失败');if(selected===target)closeEditor();notify('注释已发送');}
      catch(error){notify(error.message||'注释发送失败，内容已保留');}
      finally{sending=false;updateSubmit();}
    });
    const observer=new ResizeObserver(resize);observer.observe(webview);
    const navigation=e=>{if(e.isMainFrame!==false)stop();};webview.addEventListener('did-start-navigation',navigation);
    return {stop,dispose(){disposed=true;stop();observer.disconnect();webview.removeEventListener('did-start-navigation',navigation);layer.remove();actions.before(settingsWrap);actions.remove();}};
  }};
})();
