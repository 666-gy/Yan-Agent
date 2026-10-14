'use strict';
window.YanWebAdditions = (() => {
  const sheet = document.querySelector('#addContentSheet');
  const add = document.querySelector('#composerAddButton');
  const status = document.querySelector('#addSheetStatus');
  const input = document.querySelector('#composerInput');
  const selections = new Map();
  let skills = [], view = 'home', loadVersion = 0;
  const skillCache = { loaded: false, data: [] };
  const directoryCache = new Map();
  function setStatus(text = '') { status.textContent = text; status.hidden = !text; }
  function currentWorkspace() { return window.YanWebComposerContext?.().workspace; }
  function changeView(next) {
    view = next; sheet.dataset.view=next; ++loadVersion;
    document.querySelector('#addSheetHome').hidden = next !== 'home';
    document.querySelector('#addSheetSkills').hidden = next !== 'skills';
    document.querySelector('#addSheetFiles').hidden = next !== 'files';
    document.querySelector('#addSheetBack').hidden = next === 'home';
    document.querySelector('#addSheetTitle').textContent = {home:'添加至聊天',skills:'你的技能',files:'当前项目的文件'}[next];
    setStatus();
  }
  function close() { sheet.close(); add.focus({preventScroll:true}); }
  add.addEventListener('click', () => { changeView('home'); sheet.showModal(); document.querySelector('#addSheetClose').focus(); });
  document.querySelector('#addSheetClose').addEventListener('click', close);
  document.querySelector('#addSheetBack').addEventListener('click', () => { const previous=view;changeView('home'); document.querySelector('[data-add="'+(previous === 'files' ? 'files' : 'skills')+'"]').focus(); });
  sheet.addEventListener('click', event => { if (event.target !== sheet) return; const rect=sheet.getBoundingClientRect(); if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close(); });
  sheet.addEventListener('cancel', event => { event.preventDefault(); if(view==='home')close(); else changeView('home'); });
  window.addEventListener('hashchange', () => { if(sheet.open)sheet.close(); clear(); });
  function icon(path) { const image=document.createElement('img'); image.src=path; image.alt=''; return image; }
  function toggleSelection(item) {
    if(selections.has(item.key)) remove(item.key); else selections.set(item.key,item);
    renderSelections();
  }
  function remove(key) { const item=selections.get(key); if(item?.preview)URL.revokeObjectURL(item.preview); selections.delete(key); }
  function renderSelections() {
    const holder=document.querySelector('#composerSelections'); holder.replaceChildren(); holder.hidden=!selections.size;
    for(const item of selections.values()){
      const chip=document.createElement('div'); chip.className='composer-selection';
      const image=icon(item.preview||item.icon); if(!item.preview)image.className='selection-icon';
      const label=document.createElement('span'); label.textContent=item.name;
      const button=document.createElement('button'); button.type='button';button.textContent='×';button.setAttribute('aria-label','移除'+item.name);
      button.addEventListener('click',()=>{remove(item.key);renderSelections();if(view==='skills')renderSkills();syncFileSelections();});
      chip.append(image,label,button);holder.append(chip);
    }
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function renderSkills() {
    const list=document.querySelector('#sheetSkillsList');list.replaceChildren();
    const query=document.querySelector('#skillSearch').value.trim().toLocaleLowerCase();
    const filtered=skills.filter(skill=>[skill.name,skill.id,...(skill.aliases||[])].some(value=>String(value).toLocaleLowerCase().includes(query)));
    for(const skill of filtered){
      const row=document.createElement('button');row.type='button';row.className='sheet-row';row.setAttribute('aria-pressed',String(selections.has('skill:'+skill.id)));
      const label=document.createElement('span');label.textContent=skill.name;
      row.append(icon('vendor/keyline-book-open.svg'),label);
      if(selections.has('skill:'+skill.id)){const check=document.createElement('span');check.className='sheet-check';check.textContent='✓';row.append(check);}
      row.addEventListener('click',()=>{toggleSelection({key:'skill:'+skill.id,type:'skill',id:skill.id,name:skill.name,icon:'vendor/keyline-book-open.svg'});renderSkills();});list.append(row);
    }
    setStatus(filtered.length?'':query?'没有找到匹配的技能':'暂无可用技能');
  }
  document.querySelector('#skillSearch').addEventListener('input',renderSkills);
  async function openSkills() {
    changeView('skills');const version=loadVersion;document.querySelector('#skillSearch').value='';document.querySelector('#sheetSkillsList').replaceChildren();
    if (skillCache.loaded) { skills=skillCache.data; renderSkills(); return; }
    setStatus('加载技能…');
    try{const response=await fetch('/api/skills',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(version!==loadVersion)return;skills=data.skills;skillCache.data=skills;skillCache.loaded=true;renderSkills();}
    catch{if(version===loadVersion)setStatus('无法读取技能，请返回后重试');}
  }
  function syncFileSelections() { for(const button of document.querySelectorAll('[data-project-file]'))button.setAttribute('aria-pressed',String(selections.has(button.dataset.projectFile))); }
  function fileRows(entries, container, workspace, version) {
    for(const entry of entries){
      if(entry.directory){
        const folder=document.createElement('details');folder.className='file-tree-folder';
        const summary=document.createElement('summary');summary.className='sheet-row';
        const glyph=document.createElement('span');glyph.className='folder-icon';glyph.innerHTML='<span class="folder-closed">'+window.YanWebFolderIcons.folder+'</span><span class="folder-open">'+window.YanWebFolderIcons.folderOpen+'</span>';
        const label=document.createElement('span');label.textContent=entry.name;
        const caret=document.createElement('i');caret.dataset.lucide='chevron-right';caret.className='folder-caret';summary.append(glyph,label,caret);
        const children=document.createElement('div');children.className='file-tree-children';folder.append(summary,children);container.append(folder);
        let loaded=false,loading=false;
        folder.addEventListener('toggle',async()=>{
          if(!folder.open||loaded||loading)return;loading=true;
          const note=document.createElement('p');note.className='sheet-status';note.textContent='加载文件…';children.append(note);
          try{const data=await fetchDirectory(workspace,entry.path);if(version!==loadVersion)return;children.replaceChildren();fileRows(data.entries,children,workspace,version);loaded=true;if(!data.entries.length){note.textContent='此文件夹为空';children.append(note);}}
          catch{note.textContent='无法读取目录，收起后可重试';}finally{loading=false;}
        });
      }else{
        const key='file:'+workspace+':'+entry.path;
        const row=document.createElement('button');row.type='button';row.className='sheet-row';row.dataset.projectFile=key;row.setAttribute('aria-pressed',String(selections.has(key)));
        const label=document.createElement('span');label.textContent=entry.name;row.append(icon('vendor/keyline-file.svg'),label);
        row.addEventListener('click',()=>{toggleSelection({key,type:'project-file',workspace,path:entry.path,name:entry.name,icon:'vendor/keyline-file.svg'});syncFileSelections();});container.append(row);
      }
    }
    window.lucide?.createIcons();
  }
  async function fetchDirectory(workspace,path='') {
    const cacheKey=String(workspace||'')+'\0'+path;
    if(directoryCache.has(cacheKey)) return directoryCache.get(cacheKey);
    const params=new URLSearchParams({path});if(workspace!==undefined)params.set('workspace',workspace);
    const response=await fetch('/api/project-files?'+params,{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();directoryCache.set(cacheKey,data);return data;
  }
  async function openFiles(){
    changeView('files');const version=loadVersion;const container=document.querySelector('#sheetFileTree');container.replaceChildren();setStatus('加载项目文件…');
    try{const data=await fetchDirectory(currentWorkspace());if(version!==loadVersion)return;fileRows(data.entries,container,data.workspace,version);setStatus(data.noWorkspace?'当前任务未关联项目':!data.entries.length?'项目中暂无文件':data.truncated?'此目录仅显示前 1000 项':'');}
    catch{if(version===loadVersion)setStatus('无法读取项目文件，请返回后重试');}
  }
  const photos=document.querySelector('#devicePhotos');
  photos.addEventListener('change',()=>{
    for(const file of photos.files){if(!file.type.startsWith('image/'))continue;const key='photo:'+file.name+':'+file.size+':'+file.lastModified;if(selections.has(key))continue;selections.set(key,{key,type:'photo',file,name:file.name,preview:URL.createObjectURL(file)});}
    photos.value='';renderSelections();close();
  });
  function optimize(){
    if(!input.value.trim()){setStatus('先在输入框里写下你想做的事');return;}
    const original=input.value,context=window.YanWebComposerContext?.();let response=null;
    window.dispatchEvent(new CustomEvent('yanweb:optimize-prompt',{detail:{text:original,...context,respondWith(value){response=Promise.resolve(value);}}}));
    if(!response){setStatus('当前预览尚未接入提示词优化执行');return;}
    const button=document.querySelector('[data-add="optimize"]');button.disabled=true;setStatus('正在优化你的提示词…');
    response.then(text=>{if(typeof text!=='string'||!text.trim())throw Error();if(input.value!==original)return;input.value=text;renderSelections();close();}).catch(()=>setStatus('优化失败，请重试')).finally(()=>{button.disabled=false;});
  }
  document.querySelector('#addSheetHome').addEventListener('click',event=>{
    const action=event.target.closest('[data-add]')?.dataset.add;
    if(action==='skills')openSkills();else if(action==='files')openFiles();else if(action==='photos')photos.click();else if(action==='optimize')optimize();
  });
  function clear(){for(const key of selections.keys())remove(key);renderSelections();}
  function payload(){return{skills:[...selections.values()].filter(item=>item.type==='skill').map(({id,name})=>({id,name})),photos:[...selections.values()].filter(item=>item.type==='photo').map(item=>item.file),projectFiles:[...selections.values()].filter(item=>item.type==='project-file').map(({workspace,path,name})=>({workspace,path,name}))};}
  return{payload,clear,hasContent:()=>selections.size>0};
})();
