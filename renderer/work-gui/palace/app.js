(() => {
  'use strict';
  const $=s=>document.querySelector(s),root=$('#experience');
  const chapters=[
    ['第一境 · 观局','云顶天宫','云起万重阙，一览众事生。','全景 · 宫阙群'],
    ['第二境 · 入境','步入云阙','拾阶而上，万事自此启程。','低机位 · 南天门'],
    ['第三境 · 天工','天工开物','心有所执，手有所成。','近景 · 主代理工作区'],
    ['第四境 · 协同','众工同序','东西两阙，同赴一事。','侧向长镜 · 协作院落'],
    ['第五境 · 藏卷','百技归藏','藏诸技艺，通达万机。','Skill · MCP · 藏经阁'],
    ['第六境 · 归阙','事成归卷','待云开处，见一事终成。','中轴 · 成果与交付']
  ];
  const buttons=[...document.querySelectorAll('[data-shot]')];let current=0,touring=false,dusk=false,immersive=false,tourAt=performance.now(),lastFocus=null;
  let api=null;const pins=new Map();
  const starsButton=document.createElement('button');starsButton.id='stars-button';starsButton.type='button';starsButton.textContent='观星阁';starsButton.title='瞭望天际 · 一观星河';starsButton.addEventListener('click',()=>root.classList.contains('star-view')?selectShot(0):showDetail('stars'));$('#pond-button').before(starsButton);
  for(const site of window.Tiangong.SITES){const b=document.createElement('button');b.className='hotspot'+(site.id==='hall'?' primary':'');b.setAttribute('aria-label',`查看${site.name}`);b.innerHTML='<span class="pin"></span><span class="label">'+site.name+'</span>';b.addEventListener('click',()=>showDetail(site.id));$('#hotspots').append(b);pins.set(site.id,b);}
  function selectShot(index,{keepTour=false,keepDetail=false}={}){
    root.classList.remove('pond-view','star-view');$('#stars-button').textContent='观星阁';if(!keepTour)stopTour();if(!keepDetail)closeDetail(false);current=index;api?.setShot(index);tourAt=performance.now();
    const c=chapters[index];$('#chapter-index').textContent=c[0];$('#chapter-title').textContent=c[1];$('#chapter-description').textContent=c[2];$('#lens-caption').textContent=c[3];$('#scene-number').textContent=String(index+1).padStart(2,'0');
    buttons.forEach((b,i)=>{b.classList.toggle('active',i===index);if(i===index)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});
    $('#announcement').textContent=c[0]+'，'+c[1];
  }
  function showDetail(id){
    const site=Tiangong.SITES.find(x=>x.id===id);if(!site)return;
    stopTour();if(id==='stars'){closeDetail(false);api?.focusStars();root.classList.remove('pond-view');root.classList.add('star-view');$('#chapter-title').textContent='一观星河';$('#chapter-index').textContent='远岛 · 观星阁';$('#chapter-description').textContent='瞭望天际，星河万里。';$('#lens-caption').textContent='拖动环顾四周 · 滚轮调整视野';$('#stars-button').textContent='返回天宫';$('#world').focus();return;}window.TiangongPanels.open(id);
  }
  function closeDetail(restore=true){$('#detail').hidden=true;root.classList.remove('detail-open');$('.status').inert=immersive;$('.status').removeAttribute('aria-hidden');if(restore)lastFocus?.focus({preventScroll:true});}
  function stopTour(){touring=false;$('#tour').setAttribute('aria-pressed','false');$('#tour-icon').textContent='▷';$('#tour-progress').style.transform='scaleX(0)';}
  function setImmersive(value){immersive=value;root.classList.toggle('immersive',value);$('#restore-ui').hidden=!value;document.querySelectorAll('.chrome').forEach(el=>el.inert=value);$('#hotspots').inert=value;if(value){closeDetail(false);$('#restore-ui').focus();}else $('#hide-ui').focus();}
  buttons.forEach((b,i)=>b.addEventListener('click',()=>{root.classList.remove('pond-view');selectShot(i);}));
  $('.brand').addEventListener('click',e=>{e.preventDefault();selectShot(0);});
  $('#close-detail').addEventListener('click',()=>closeDetail());$('#open-task').addEventListener('click',()=>showDetail('hall'));
  $('#hide-ui').addEventListener('click',()=>setImmersive(true));$('#restore-ui').addEventListener('click',()=>setImmersive(false));
  $('#ambience').addEventListener('click',()=>{dusk=!dusk;api?.setDusk(dusk);$('#ambience').innerHTML=(dusk?'暮色':'晨光')+' <span>◐</span>';$('#ambience').setAttribute('aria-label',dusk?'切换晨光':'切换暮色');});
  $('#quality').addEventListener('change',e=>api?.setQuality(e.target.value));
  $('#tour').addEventListener('click',()=>{if(touring)stopTour();else{closeDetail(false);touring=true;tourAt=performance.now();$('#tour').setAttribute('aria-pressed','true');$('#tour-icon').textContent='Ⅱ';}});
  window.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||window.TiangongPanels?.isOpen()||document.querySelector('.stargazing')?.open||document.querySelector('#palace-entry'))return;if(e.key.toLowerCase()==='h')setImmersive(!immersive);if(e.key==='Escape'){if(immersive)setImmersive(false);else if(root.classList.contains('star-view'))selectShot(0);else closeDetail();stopTour();}if(/^[1-6]$/.test(e.key))selectShot(Number(e.key)-1);});
  $('#pond-button').addEventListener('click',()=>{stopTour();closeDetail(false);root.classList.remove('star-view');$('#stars-button').textContent='观星阁';api?.focusPond();window.dispatchEvent(new Event('tiangong:lotus'));});
  window.addEventListener('tiangong:lotus',()=>{stopTour();$('#chapter-title').textContent='风过莲池';$('#chapter-description').textContent='水光潋滟，荷影相依。';$('#chapter-index').textContent='庭前 · 观荷';$('#lens-caption').textContent='涟漪 · 倒影 · 花叶';root.classList.add('pond-view');});
  $('.shots').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?5:(current+(e.key==='ArrowRight'?1:5))%6;selectShot(index);buttons[index].focus();});
  let clock=0;const tick=now=>{clock=requestAnimationFrame(tick);if(document.hidden){tourAt=now;return;}if(touring){const t=(now-tourAt)/12000;$('#tour-progress').style.transform=`scaleX(${Math.min(t,1)})`;if(t>=1)selectShot((current+1)%6,{keepTour:true});}};clock=requestAnimationFrame(tick);
  function boot(){
    try{
      api=Tiangong.create($('#world'),sites=>sites.forEach(site=>{const b=pins.get(site.id);b.style.left=site.x+'px';b.style.top=site.y+'px';b.hidden=!site.visible||($('#detail').hidden===false)||(current!==0&&site.shot!==current);b.classList.toggle('primary',current===0?site.id==='hall':site.shot===current); }));
      api.setQuality($('#quality').value);
      root.dataset.sceneReady='true';
      requestAnimationFrame(()=>requestAnimationFrame(()=>{root.classList.add('ready');$('#loading').classList.add('leaving');setTimeout(()=>$('#loading').hidden=true,1400);}));
    }catch(error){console.error('[Tiangong]',error);$('#loading').hidden=true;$('#error').hidden=false;}
  }
  setTimeout(boot,80);
  $('#world').addEventListener('webglcontextlost',e=>{e.preventDefault();$('#error').hidden=false;stopTour();});
  window.addEventListener('message',e=>{if(e.source!==window.parent||e.data?.source!=='yan-palace-host')return;if(e.data.kind==='pause'){api?.setPaused(true);window.TiangongPanels?.close();}if(e.data.kind==='resume')api?.setPaused(false);});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(clock);api?.dispose();});
})();
