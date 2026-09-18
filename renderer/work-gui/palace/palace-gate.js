/* Tang-inspired timber gate. Two heavy leaves pivot inward on real hinges. */
(() => {
  'use strict';
  const T=window.THREE,root=document.createElement('section');root.id='palace-entry';root.setAttribute('aria-label','天宫入口');
  root.innerHTML='<canvas aria-hidden="true"></canvas><div class="entry-vignette"></div><div class="entry-heading"><span>YAN AGENT · WORK GUI</span><h1>云顶天宫</h1><p>入阙 · 开物 · 成事</p></div><button class="entry-open" disabled><span>正在启阙</span><i>双扉向内，万象徐开</i></button><p class="entry-caption">朱门承天光，云阙待君来。</p>';
  document.body.append(root);const main=document.querySelector('#experience');main.inert=true;
  const button=root.querySelector('button'),canvas=root.querySelector('canvas');let renderer,scene,camera,leaves=[],raf=0,opened=false,start=0,done=false;
  const materials=[],geometries=[],textures=[];
  function finish(){if(done)return;done=true;cancelAnimationFrame(raf);root.remove();main.inert=false;renderer?.dispose();renderer?.forceContextLoss();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());window.removeEventListener('resize',resize);window.dispatchEvent(new Event('tiangong:entered'));document.querySelector('.brand')?.focus();}
  function material(color,roughness,metalness=0,map=null){const m=new T.MeshStandardMaterial({color,roughness,metalness,map});materials.push(m);return m;}
  function grain(){const c=document.createElement('canvas');c.width=512;c.height=1024;const ctx=c.getContext('2d');ctx.fillStyle='#a3634e';ctx.fillRect(0,0,512,1024);let seed=1928;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};for(let i=0;i<2600;i++){const x=rnd()*512;ctx.strokeStyle=`rgba(28,10,5,${.03+rnd()*.13})`;ctx.lineWidth=.3+rnd()*1.2;ctx.beginPath();ctx.moveTo(x,-20);ctx.bezierCurveTo(x+8,250,x-8,650,x+3,1040);ctx.stroke();}for(let i=1;i<7;i++){ctx.fillStyle='#50291c';ctx.fillRect(i*512/7,0,1.5,1024);}const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;textures.push(t);return t;}
  function mesh(g,m,parent,x=0,y=0,z=0){geometries.push(g);const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  function box(p,w,h,d,x,y,z,m){return mesh(new T.BoxGeometry(w,h,d),m,p,x,y,z);}
  function sphere(p,x,y,z,r,m,scale=[1,1,1]){const o=mesh(new T.SphereGeometry(r,16,12),m,p,x,y,z);o.scale.set(...scale);return o;}
  function torus(p,x,y,z,r,tube,m){return mesh(new T.TorusGeometry(r,tube,12,56),m,p,x,y,z);}
  function stroke(p,pts,r,m){const c=new T.CatmullRomCurve3(pts.map(v=>new T.Vector3(...v)));return mesh(new T.TubeGeometry(c,40,r,7,false),m,p);}
  function resize(){if(!renderer)return;const w=root.clientWidth,h=root.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.position.z=w/h<.75?13.7:10.6;camera.updateProjectionMatrix();if(!opened)renderer.render(scene,camera);}
  function build(){
    renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
    scene=new T.Scene();camera=new T.PerspectiveCamera(39,1,.1,100);camera.position.set(0,3.05,10.6);camera.lookAt(0,2.9,0);
    const world=new T.Group();scene.add(world);
    const wood=material('#75372b',.53,0,grain()),edge=material('#4b251e',.52),gold=material('#a27b40',.3,.8),darkGold=material('#59432d',.48,.65),stone=material('#545651',.9),ink=material('#172220',.6);
    scene.add(new T.HemisphereLight('#e6dfcd','#25211d',2.1));const sun=new T.DirectionalLight('#ffdaa1',4.4);sun.position.set(-3,7,6);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-5,right:5,top:7,bottom:-2,near:.1,far:20});sun.shadow.normalBias=.015;scene.add(sun);const rim=new T.PointLight('#aec9cb',28,18);rim.position.set(3,5,-1);scene.add(rim);
    // The two leaves fill the opening; side architecture remains monumental.
    for(const side of [-1,1]){
      box(world,3.8,9,.65,side*4.6,3,-.35,ink);box(world,.38,6,.52,side*2.5,3,.02,edge);box(world,.075,5.9,.065,side*2.29,3,.35,gold);
      mesh(new T.CylinderGeometry(.27,.32,5.7,32),wood,world,side*2.82,3,.3);box(world,.73,.4,.83,side*2.82,.28,.3,stone);box(world,.55,.16,.65,side*2.82,.56,.3,gold);
      for(let j=0;j<3;j++){box(world,.65+j*.23,.17,.8,side*2.82,5.6+j*.2,.25,wood);box(world,.8+j*.24,.06,.83,side*2.82,5.69+j*.2,.27,gold);}
      const hinge=new T.Group();hinge.position.set(side*2.25,.43,0);world.add(hinge);leaves.push({hinge,side});const leaf=new T.Group();leaf.position.x=-side*1.12;hinge.add(leaf);
      box(leaf,2.24,4.88,.19,0,2.44,.03,wood);
      for(const x of [-1.075,1.075]){box(leaf,.11,4.88,.075,x,2.44,.162,edge);box(leaf,.018,4.76,.025,x,2.44,.212,gold);}
      for(const y of [.09,4.79]){box(leaf,2.24,.18,.08,0,y,.16,edge);box(leaf,2.11,.023,.03,0,y,.218,gold);}
      for(let row=0;row<7;row++)for(let col=0;col<5;col++){
        const x=-.84+col*.42,y=.55+row*.625;
        torus(leaf,x,y,.185,.052,.008,darkGold);sphere(leaf,x,y,.199,.046,gold,[1,1,.6]);
      }
      // Cast-bronze animal-mask backplate, raised brows, muzzle and hanging ring.
      const x=-side*.40,y=2.60;
      const plate=mesh(new T.CylinderGeometry(.25,.25,.035,8),darkGold,leaf,x,y,.22);plate.rotation.x=Math.PI/2;
      sphere(leaf,x,y+.02,.25,.17,gold,[1.13,1,.32]);
      for(const s of [-1,1]){
        stroke(leaf,[[x+s*.018,y+.07,.31],[x+s*.075,y+.13,.31],[x+s*.145,y+.07,.29],[x+s*.16,y+.13,.27]],.019,gold);
        sphere(leaf,x+s*.070,y+.035,.31,.028,ink,[1,.55,.4]);sphere(leaf,x+s*.07,y+.04,.324,.012,gold);
        stroke(leaf,[[x+s*.09,y-.03,.31],[x+s*.17,y-.09,.28],[x+s*.15,y-.15,.26]],.012,gold);
      }
      sphere(leaf,x,y-.028,.326,.042,gold,[.8,1,.6]);torus(leaf,x,y-.20,.34,.136,.024,gold);
      for(const yy of [.35,2.44,4.52])mesh(new T.CylinderGeometry(.047,.047,.25,16),gold,hinge,0,yy,.12);
    }
    box(world,5.25,.42,.75,0,5.57,0,wood);box(world,5.5,.09,.85,0,5.82,.03,gold);box(world,4.48,.2,.48,0,.33,.1,stone);
    for(let i=0;i<17;i++){const x=(i-8)*.34;box(world,.25,.15,.44,x,6.12,.06,edge);box(world,.37,.08,.62,x,6.22,.05,wood);}
    // Gilded lotus medallions and a broad, gently lifted Tang-style eave.
    for(const x of [-1.85,1.85]){torus(world,x,5.57,.41,.115,.013,gold);for(let j=0;j<8;j++){const a=j*Math.PI/4;sphere(world,x+.075*Math.sin(a),5.57+.075*Math.cos(a),.42,.034,gold,[.6,1,.25]);}}
    box(world,6.4,.15,1.1,0,6.35,-.05,edge);for(let i=0;i<43;i++){const x=(i-21)*.15;const y=6.42+.10*Math.pow(Math.abs(x)/3.2,6);const tile=mesh(new T.CylinderGeometry(.075,.075,1.20,10,1,true),ink,world,x,y,.06);tile.rotation.x=Math.PI/2;torus(world,x,y,.66,.069,.009,darkGold);}
    const plaque=document.createElement('canvas');plaque.width=1024;plaque.height=256;const ctx=plaque.getContext('2d');ctx.fillStyle='#172220';ctx.fillRect(0,0,1024,256);ctx.strokeStyle='#b89656';ctx.lineWidth=4;ctx.strokeRect(12,12,1000,232);ctx.font='120px SimSun';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#d6b16b';ctx.fillText('雲  頂  天  宮',512,137);const tx=new T.CanvasTexture(plaque);tx.colorSpace=T.SRGBColorSpace;textures.push(tx);const pm=material('#ffffff',.53,0,tx);box(world,2.3,.58,.1,0,5.62,.44,pm);
    resize();window.addEventListener('resize',resize);button.disabled=false;button.querySelector('span').textContent='推 门 入 阙';
  }
  function open(){if(opened)return;opened=true;window.TiangongEntryAudio?.playOnce();button.disabled=true;button.querySelector('span').textContent='天门已启';root.classList.add('opening');start=performance.now();const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduced){finish();return;}
    function tick(now){const t=Math.min(1,(now-start)/2600),ease=t*t*t*(t*(t*6-15)+10);for(const {hinge,side} of leaves)hinge.rotation.y=side*ease*1.43;renderer?.render(scene,camera);root.style.setProperty('--entry-fade',String(Math.max(0,(t-.68)/.32)));if(t<1)raf=requestAnimationFrame(tick);else finish();}raf=requestAnimationFrame(tick);
  }
  button.addEventListener('click',open);canvas.addEventListener('click',()=>{if(!button.disabled)open();});
  try{build();}catch(e){console.error('[palace-entry]',e);root.classList.add('entry-fallback');button.disabled=false;button.querySelector('span').textContent='进入天宫';}
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);renderer?.dispose();});
})();
