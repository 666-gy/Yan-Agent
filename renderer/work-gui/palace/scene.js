/* 云顶天宫 / V1. Original procedural architecture, deterministic materials.
   Three.js MIT. Geometry is instanced by material; no per-tile draw calls. */
(() => {
  'use strict';
  const T = window.THREE;
  const SHOTS = [
    {pos:[118,79,145],target:[0,12,-4],fov:43},
    {pos:[0,13,100],target:[0,17,-24],fov:49},
    {pos:[53,30,40],target:[0,18,-13],fov:43},
    {pos:[91,48,18],target:[-5,13,-2],fov:47},
    {pos:[-62,27,-3],target:[-34,12,-24],fov:46},
    {pos:[0,43,84],target:[0,21,-24],fov:40}
  ];
  const SITES = [
    {id:'hall',name:'天工殿',sub:'主代理 · 实现与编排',point:[0,31,-20],shot:2},
    {id:'east',name:'协作东阙',sub:'子代理 · 并行执行',point:[34,19,-1],shot:3},
    {id:'stars',name:'观星阁',sub:'瞭望天际 · 一观星河',point:[110,32,-100],shot:3},
    {id:'library',name:'藏经阁',sub:'Skill · MCP 管理',point:[-34,22,-25],shot:4},
    {id:'gate',name:'南天门',sub:'任务入口 · 接收与分派',point:[0,18,45],shot:1},
    {id:'return',name:'归卷台',sub:'交付 · 成果归档',point:[0,8,21],shot:5}
  ];
  window.Tiangong = {SHOTS,SITES};
  window.Tiangong.create = function(canvas,onProject) {
    if(!T) throw new Error('Three.js missing');
    let seed=74319; const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    const renderTimer=window.TiangongGpuTimer?.(renderer);
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
    const scene=new T.Scene();scene.background=new T.Color('#9caaa6');scene.fog=new T.FogExp2('#b2b7aa',.0028);
    const camera=new T.PerspectiveCamera(43,1,.5,1800);
    const ambient=new T.HemisphereLight('#d1dfe2','#8a8772',2.0);scene.add(ambient);
    const sun=new T.DirectionalLight('#ffddad',3.4);sun.position.set(-95,135,5);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-115,right:115,top:115,bottom:-115,near:1,far:360});
    sun.shadow.normalBias=.12;sun.shadow.bias=-.0002;scene.add(sun);
    const rim=new T.DirectionalLight('#9ab5bc',.9);rim.position.set(70,25,-100);scene.add(rim);
    const objects=new T.Group();scene.add(objects);const geometries=new Map(),mats=new Map(),textures=[];
    const gbox=new T.BoxGeometry(1,1,1),gcyl=new T.CylinderGeometry(1,1,1,12),gsphere=new T.SphereGeometry(1,8,6);
    // Roof channels have no visible end caps. Keep full cylinders for columns.
    const gtile=new T.CylinderGeometry(1,1,1,5,1,true);
    function tex(kind){
      const el=document.createElement('canvas');el.width=el.height=512;const ctx=el.getContext('2d');
      ctx.fillStyle=kind==='stone'?'#a8a69a':kind==='wood'?'#b7a595':'#a49e87';ctx.fillRect(0,0,512,512);
      const im=ctx.getImageData(0,0,512,512);
      for(let y=0;y<512;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4,n=(rand()-.5)*26+Math.sin(x*.15+y*.024)*3;for(let c=0;c<3;c++)im.data[i+c]+=n;}
      ctx.putImageData(im,0,0);
      if(kind==='stone'){
        for(let row=0;row<8;row++)for(let col=-1;col<5;col++){
          const x=col*128+(row%2)*64,y=row*64;ctx.strokeStyle='rgba(48,47,43,.36)';ctx.lineWidth=2;ctx.strokeRect(x,y,128,64);
          ctx.strokeStyle='rgba(230,221,198,.25)';ctx.lineWidth=1;ctx.strokeRect(x+2,y+2,124,60);
        }
      }else if(kind==='wood'){
        for(let i=0;i<220;i++){const x=rand()*512;ctx.strokeStyle=`rgba(25,12,5,${rand()*.18})`;ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x+8,150,x-7,360,x+rand()*8,512);ctx.stroke();}
      }
      const t=new T.CanvasTexture(el);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(kind==='stone'?5:2,kind==='stone'?5:2);t.colorSpace=T.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.push(t);return t;
    }
    const stoneTex=tex('stone'),woodTex=tex('wood'),tileTex=tex('tile');
    const mat=(name,color,roughness=.8,metalness=0,map=null)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness,map});mats.set(name,m);return m;};
    const M={stone:mat('stone','#c6c0b1',.92,0,stoneTex),edge:mat('edge','#aaa592',.89),white:mat('white','#d1cbbb',.78),
      red:mat('red','#843e32',.7,0,woodTex),dark:mat('dark','#282a25',.86),gold:mat('gold','#aa8953',.46,.48),
      roof:mat('roof','#52615e',.72,.08,tileTex),tile:mat('tile','#3e514e',.66,.09),window:mat('window','#3a3328',.7),
      rock:mat('rock','#626c65',.99),leaf:mat('leaf','#394e40',.98),trunk:mat('trunk','#5c5242',.97),
      lamp:mat('lamp','#d5a564',.5),ink:mat('ink','#292d28',.8),water:mat('water','#63837d',.18,.5)};
    M.lamp.emissive=new T.Color('#efaf5b');M.lamp.emissiveIntensity=.8;
    M.roof.side=T.DoubleSide;
    M.stone.bumpMap=stoneTex;M.stone.bumpScale=.22;M.red.bumpMap=woodTex;M.red.bumpScale=.065;
    // CC0 photographic maps are embedded to retain double-click / offline use.
    function photoMap(key,repeat,color=false){
      const url=window.TIANGONG_TEXTURES?.[key];if(!url)return null;
      const texture=new T.TextureLoader().load(url,()=>{renderer.shadowMap.needsUpdate=true;});
      texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(...repeat);
      texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      if(color)texture.colorSpace=T.SRGBColorSpace;textures.push(texture);return texture;
    }
    const rockColor=photoMap('rock_color',[5,4],true),rockNormal=photoMap('rock_normal',[5,4]);
    if(rockColor){M.rock.map=rockColor;M.rock.color.set('#b4b8a7');M.rock.normalMap=rockNormal;M.rock.normalScale.set(.8,.8);}
    const stoneColor=photoMap('stone_color',[4,2],true),stoneNormal=photoMap('stone_normal',[4,2]);
    if(stoneColor){M.edge.map=stoneColor;M.edge.normalMap=stoneNormal;M.edge.normalScale.set(.4,.4);}
    function mesh(parent,geo,material,x=0,y=0,z=0,sx=1,sy=1,sz=1){const m=new T.Mesh(geo,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
    function box(p,x,y,z,w,h,d,m=M.stone){return mesh(p,gbox,m,x,y,z,w,h,d);}
    function cyl(p,x,y,z,r,h,m=M.red){return mesh(p,gcyl,m,x,y,z,r,h,r);}
    function ball(p,x,y,z,r,m=M.gold,sx=1,sy=1,sz=1){return mesh(p,gsphere,m,x,y,z,r*sx,r*sy,r*sz);}
    function rod(p,a,b,r,m=M.gold){const start=new T.Vector3(...a),end=new T.Vector3(...b),length=start.distanceTo(end),o=m===M.tile?mesh(p,gtile,m,0,0,0,r,length,r):cyl(p,0,0,0,r,length,m);o.position.copy(start).add(end).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.sub(start).normalize());return o;}
    function group(x,y,z,parent=objects){const g=new T.Group();g.position.set(x,y,z);parent.add(g);return g;}
    function rail(p,ax,az,bx,bz,y=0){
      const length=Math.hypot(bx-ax,bz-az),n=Math.ceil(length/2.8);
      for(let i=0;i<=n;i++){const t=i/n,x=ax+(bx-ax)*t,z=az+(bz-az)*t;box(p,x,y+.8,z,.3,1.6,.3,M.white);ball(p,x,y+1.72,z,.24,M.white);}
      for(const h of [.42,1.2])rod(p,[ax,y+h,az],[bx,y+h,bz],.1,M.white);
    }
    function terrace(p,w,d,h=2){
      box(p,0,h/2,0,w,h,d);box(p,0,h-.05,0,w+1,.3,d+1,M.white);box(p,0,.25,0,w+1.1,.45,d+1.1,M.edge);
      rail(p,-w/2,-d/2,w/2,-d/2,h);rail(p,-w/2,-d/2,-w/2,d/2,h);rail(p,w/2,-d/2,w/2,d/2,h);
      rail(p,-w/2,d/2,-4,d/2,h);rail(p,4,d/2,w/2,d/2,h);
      const steps=Math.round(h/.25);for(let i=0;i<steps;i++)box(p,0,(i+1)*.125,d/2+(steps-i)*.44,8,(i+1)*.25,.6);
    }
    // Curved hip roof: long ridge contracts smoothly to upturned corners.
    function roof(p,w,d,y,rise,trim=true){
      const geo=new T.BufferGeometry(),verts=[],uv=[],idx=[];const halfW=w/2,halfD=d/2,ridge=Math.max(0,(w-d)*.44),N=24;
      const surface=(side,u,t)=>{
        const along=u*(ridge+(halfW-ridge)*t), across=t*halfD;
        const yy=y+rise*(1-t)*(1-t)+.52*Math.pow(t,8)+.50*Math.pow(Math.abs(u)*t,8);
        return side<2?[along,yy,(side===0?1:-1)*across]:[(side===2?1:-1)*(ridge+(halfW-ridge)*t),yy,u*across];
      };
      for(let side=0;side<4;side++){
        const offset=verts.length/3;
        for(let row=0;row<=N;row++)for(let col=0;col<=N;col++){verts.push(...surface(side,col/N*2-1,row/N));uv.push(col/N,row/N);}
        for(let row=0;row<N;row++)for(let col=0;col<N;col++){const a=offset+row*(N+1)+col,b=a+N+1;idx.push(a,b,a+1,b,b+1,a+1);}
      }
      geo.setAttribute('position',new T.Float32BufferAttribute(verts,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
      const rmesh=new T.Mesh(geo,M.roof);rmesh.castShadow=true;rmesh.receiveShadow=true;p.add(rmesh);
      // Shared cylinders are tiled along the actual curved surface.
      for(let side=0;side<4;side++)for(let col=0;col<=Math.round(w/.65);col++){
        const u=col/Math.round(w/.65)*2-1;
        for(let j=0;j<10;j++){let a=surface(side,u,j/10),b=surface(side,u,(j+1)/10);a[1]+=.10;b[1]+=.10;rod(p,a,b,.10,M.tile);}
      }
      for(let side=0;side<4;side++){
        let prev=surface(side,-1,1);for(let j=1;j<=24;j++){const next=surface(side,j/24*2-1,1);rod(p,prev,next,.12,M.gold);prev=next;}
      }
      rod(p,[-ridge,y+rise+.25,0],[ridge,y+rise+.25,0],.23,M.gold);
      if(trim)for(const sx of [-1,1]){
        for(let j=0;j<6;j++)ball(p,sx*(ridge-.2+j*.23),y+rise+.3+j*.22,0,.22-j*.017,M.gold,1,1.2,.75);
        for(const sz of [-1,1]){
          for(let j=0;j<5;j++){const t=1-j*.065,a=surface(sz===1?0:1,sx,t);ball(p,a[0],a[1]+.27,a[2],.12,M.gold,1,1.7,1);}
        }
      }
    }
    function plaque(p,label,y,z,w){
      const c=document.createElement('canvas');c.width=512;c.height=160;const ctx=c.getContext('2d');ctx.fillStyle='#202c29';ctx.fillRect(0,0,512,160);ctx.strokeStyle='#bba268';ctx.lineWidth=5;ctx.strokeRect(10,10,492,140);ctx.font='76px SimSun, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#d9c48e';ctx.fillText(label,256,85);
      const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;textures.push(tx);const pl=new T.Mesh(new T.PlaneGeometry(w,w*160/512),new T.MeshStandardMaterial({map:tx,roughness:.7}));pl.position.set(0,y,z);p.add(pl);
    }
    function palace(x,z,w,d,height,label,double=true,base=0){
      const p=group(x,base,z);terrace(p,w+7,d+7,2.3);const floor=2.5;
      box(p,0,floor+height/2,0,w-3,height,d-3,M.red);
      const bays=Math.max(3,Math.round(w/4));
      for(let i=0;i<=bays;i++){
        const px=-w/2+i*w/bays;
        for(const sign of [-1,1]){
          cyl(p,px,floor+height/2,sign*d/2,.3,height,M.red);cyl(p,px,floor+.2,sign*d/2,.46,.4,M.white);
          for(let j=0;j<3;j++){box(p,px,floor+height-.8+j*.25,sign*d/2,1.05+j*.38,.22,.4,M.gold);box(p,px,floor+height-.7+j*.25,sign*d/2,.38,.18,1.1+j*.38,M.red);}
        }
        if(i<bays){
          const wx=px+w/bays/2;box(p,wx,floor+height*.48,d/2-.6,w/bays-.65,height*.77,.2,M.window);
          for(let j=0;j<7;j++)box(p,wx-w/bays*.36+j*w/bays*.12,floor+height*.48,d/2-.42,.045,height*.75,.06,M.gold);
          for(let j=0;j<5;j++)box(p,wx,floor+height*.17+j*height*.15,d/2-.40,w/bays-.7,.045,.06,M.gold);
          for(const side of [-1,1]){ball(p,wx+side*.24,floor+height*.41,d/2-.30,.10,M.gold);}
        }
      }
      for(const sign of [-1,1])box(p,0,floor+height-.5,sign*d/2,w+1,.4,.38,M.gold);
      // Side elevations stay legible when the camera approaches the library.
      for(const side of [-1,1])for(let j=0;j<3;j++){
        const zz=(j-1)*d*.23;box(p,side*(w-3)/2,floor+height*.48,zz,.10,height*.66,d*.19,M.window);
        for(let k=0;k<5;k++)box(p,side*((w-3)/2+.08),floor+height*.48,zz+(k-2)*d*.034,.08,height*.66,.04,M.gold);
        for(let k=0;k<4;k++)box(p,side*((w-3)/2+.08),floor+height*.22+k*height*.17,zz,.08,.04,d*.19,M.gold);
      }
      for(const sign of [-1,1]){
        for(let i=0;i<bays;i++){
          const xx=-w/2+(i+.5)*w/bays;
          for(let k=0;k<3;k++){
            const cx=xx+(k-1)*.42,cy=floor+height-.95,zz=sign*(d/2+.045);
            rod(p,[cx-.19,cy,zz],[cx,cy+.24,zz],.027,M.gold);
            rod(p,[cx,cy+.24,zz],[cx+.19,cy,zz],.027,M.gold);
            rod(p,[cx+.19,cy,zz],[cx,cy-.24,zz],.027,M.gold);
            rod(p,[cx,cy-.24,zz],[cx-.19,cy,zz],.027,M.gold);
          }
        }
        for(let i=0;i<=bays;i++){
          const xx=-w/2+i*w/bays;
          rod(p,[xx,floor+height-1.15,sign*d/2],[xx,floor+height-.70,sign*(d/2+.65)],.095,M.red);
          rod(p,[xx,floor+height-.70,sign*(d/2+.65)],[xx,floor+height-.35,sign*(d/2+1.05)],.075,M.gold);
          cyl(p,xx,floor+.1,sign*d/2,.53,.19,M.edge);
        }
      }
      roof(p,w+5,d+5,floor+height,4.2);
      if(double){
        box(p,0,floor+height+4,0,w*.69,3.1,d*.55,M.red);
        for(const sign of [-1,1]){
          for(let i=0;i<=bays;i++){
            const xx=-w*.345+i*w*.69/bays;cyl(p,xx,floor+height+4,sign*d*.285,.17,3,M.red);
            box(p,xx,floor+height+4.9,sign*d*.285,1.1,.2,.7,M.gold);
            if(i<bays){const cx=xx+w*.345/bays;box(p,cx,floor+height+4,sign*d*.282,w*.69/bays-.25,2.1,.1,M.window);
              for(let j=0;j<4;j++)box(p,cx+(j-1.5)*.36,floor+height+4,sign*d*.29,.035,2.1,.06,M.gold);}
          }
          box(p,0,floor+height+5.1,sign*d*.29,w*.72,.17,.2,M.gold);
          box(p,0,floor+height+2.6,sign*d*.29,w*.72,.17,.2,M.gold);
        }
        roof(p,w*.82,d*.79,floor+height+5.3,3.8);
      }
      plaque(p,label,floor+height-1.7,d/2+.09,Math.min(5,w*.32));
      for(const sign of [-1,1]){const lx=sign*(w/2-1);cyl(p,lx,floor+height-1.7,d/2+.6,.36,.8,M.lamp);for(const h of [-.4,.4])cyl(p,lx,floor+height-1.7+h,d/2+.6,.39,.055,M.gold);rod(p,[lx,floor+height-2.14,d/2+.6],[lx,floor+height-2.6,d/2+.6],.03,M.red);rod(p,[lx,floor+height,d/2+.6],[lx,floor+height-1.2,d/2+.6],.025,M.gold);}
      return p;
    }
    // Main mountain and raised courtyards. Sculpted ridges continue below cloud level.
    function mountain(x,y,z,r,h,color=M.rock,peak=false){
      const geo=new T.CylinderGeometry(peak?r*.018:r*.9,peak?r*.8:r*.20,h,48,26,false),pos=geo.attributes.position;
      for(let i=0;i<pos.count;i++){
        const xx=pos.getX(i),yy=pos.getY(i),zz=pos.getZ(i),a=Math.atan2(zz,xx),level=(yy+h/2)/h;
        const ridge=.12*Math.sin(a*7+level*3)+.09*Math.sin(a*13-level*2)+.035*Math.sin(a*31+level*7);
        const band=.08*Math.sin(level*44+a*2)+.035*Math.sin(level*127);
        const f=1+ridge+band;pos.setX(i,xx*f);pos.setZ(i,zz*f);pos.setY(i,yy+Math.sin(a*9+level*10)*r*.045);
      }
      geo.computeVertexNormals();mesh(objects,geo,color,x,y,z);
    }
    mountain(0,-36,-6,65,64);box(objects,0,-1,-6,102,4,128);box(objects,0,1.2,-6,104,.65,130,M.white);
    // Individually weathered paving blocks, laid in staggered courses.
    const paving=Array.from({length:5},(_,i)=>mat('paving'+i,new T.Color('#9d9d90').multiplyScalar(.91+i*.037),.95,0,stoneTex));
    for(let row=0;row<42;row++)for(let col=0;col<17;col++){
      const x=-48+col*6+(row%2)*.4,z=-68+row*3;
      box(objects,x,1.56,z,5.91,.10,2.94,paving[Math.floor(rand()*paving.length)]);
    }
    // Pavement, sunken lotus courtyards, repeated balustrades.
    const lotusSystem=window.TiangongLotus?.create(scene,renderer);
    rail(objects,-51,-70,51,-70,1.5);rail(objects,-51,-70,-51,57,1.5);rail(objects,51,-70,51,57,1.5);
    rail(objects,-51,57,-8,57,1.5);rail(objects,8,57,51,57,1.5);
    const upper=group(0,1.5,-22);terrace(upper,64,55,4.2);
    palace(0,-25,30,18,8.2,'天 工 殿',true,5.7);
    palace(-34,-25,14,12,7.8,'藏 经 阁',true,1.5);
    palace(34,-25,14,12,7.8,'东 藏 楼',true,1.5);
    palace(-34,0,16,10,5.5,'西 阙',false,1.5);
    palace(34,0,16,10,5.5,'东 阙',false,1.5);
    palace(0,45,25,9,6.5,'南 天 门',true,1.5);
    // Long axial approach rising out of the clouds.
    for(let i=0;i<36;i++)box(objects,0,1.3-i*.17,61+i*.8,13,.25,.9,M.stone);
    for(const sx of [-1,1]){rod(objects,[sx*6.3,3,61],[sx*6.3,-3,89],.16,M.white);for(let j=0;j<12;j++)cyl(objects,sx*6.3,2-j*.51,61+j*2.4,.17,1.6,M.white);}
    // A bronze armillary and incense burner anchor human scale.
    const altar=group(0,1.5,20);terrace(altar,12,11,.65);cyl(altar,0,1.2,0,1.8,.8,M.gold);
    for(let i=0;i<3;i++){const t=i*Math.PI*2/3;cyl(altar,Math.sin(t)*1.3,.7,Math.cos(t)*1.3,.18,1.2,M.gold);}
    cyl(altar,0,1.8,0,2,.32,M.gold);roof(altar,4.8,4.8,3,1.2,false);
    for(const sx of [-1,1])for(const sz of [-1,1])cyl(altar,sx*1.3,2.35,sz*1.3,.10,1.2,M.gold);
    // Covered galleries tie the subsidiary halls to the inner court.
    for(const sx of [-1,1]){
      const p=group(sx*24,1.5,-45);box(p,0,.6,0,4,1.2,27);
      for(let i=0;i<8;i++)for(const side of [-1,1])cyl(p,side*1.6,3.2,-12+i*3.4,.18,5,M.red);
      const r=group(0,0,0,p);r.rotation.y=Math.PI/2;roof(r,29,6,5.9,1.5,false);
    }
    function pine(x,y,z,size=1){
      const p=group(x,y,z);p.scale.setScalar(size);rod(p,[0,0,0],[.4,5.5,0],.21,M.trunk);
      for(let j=0;j<5;j++){const theta=j*2.4,r=1.8+(5-j)*.18,yy=2+j*.8,xx=Math.sin(theta)*r,zz=Math.cos(theta)*r;
        rod(p,[.2,yy-1,0],[xx,yy,zz],.10,M.trunk);
        for(let k=0;k<6;k++)ball(p,xx+(rand()-.5)*2,yy+rand()*.35,zz+(rand()-.5)*1.8,.9,M.leaf,1,.27,1);
      }
    }
    for(const x of [-46,46])for(let i=0;i<5;i++)pine(x,1.6,-55+i*22,1+rand()*.25);
    for(const x of [-18,18])pine(x,1.6,30,.9);
    const observatories=[];
    // Outlying sanctuaries occupy actual distant geometry, not a backdrop.
    for(const [x,z,r,h] of [[-120,-75,27,60],[110,-100,32,90],[-77,-180,37,120],[65,-230,40,115],[180,-210,39,145]]){
      const yy=4+rand()*19;mountain(x,yy-h/2,z,r,h);const p=palace(x,z,r*.50,r*.34,5,'观 星 阁',true,yy);p.scale.setScalar(.9);
      observatories.push({x,y:yy,z,r});if(x===110)SITES.find(s=>s.id==='stars').point=[x,yy+20,z];
      pine(x-r*.3,yy,z+4,1.5);
    }
    // Distant crags layered against the horizon.
    const farMountain=mat('far-mountains','#8ba09b',1);
    for(let i=0;i<26;i++){
      const a=i/26*Math.PI*2,r=300+rand()*150,h=65+rand()*110;
      rand(); // Preserve seeded placement after replacing individual materials.
      mountain(Math.sin(a)*r,-70+h*.15,Math.cos(a)*r,18+rand()*30,h,farMountain,true);
    }
    // Warm lanterns along the arrival axis.
    for(const x of [-11,11])for(const z of [5,15,28,37]){
      cyl(objects,x,2.7,z,.16,2.4,M.gold);box(objects,x,4,z,.7,.8,.7,M.lamp);roof(group(x,0,z),1.5,1.5,4.5,.5,false);
    }
    // Batch shared static geometry. All meshes keep their world transforms.
    objects.updateMatrixWorld(true);const batches=new Map(),remove=[];
    objects.traverse(o=>{if(!o.isMesh || ![gbox,gcyl,gsphere,gtile].includes(o.geometry))return;const key=o.geometry.uuid+o.material.uuid;if(!batches.has(key))batches.set(key,{geo:o.geometry,mat:o.material,items:[]});batches.get(key).items.push(o.matrixWorld.clone());remove.push(o);});
    const instanceCount=remove.length;
    for(const o of remove)o.removeFromParent();for(const b of batches.values()){const m=new T.InstancedMesh(b.geo,b.mat,b.items.length);b.items.forEach((matrix,i)=>{m.setMatrixAt(i,matrix);if(b.mat===M.tile){const v=.94+.12*((Math.sin(matrix.elements[12]*19+matrix.elements[14]*31)*43758.5453)%1+1)/2;m.setColorAt(i,new T.Color(v,v,v*.985));}});m.castShadow=true;m.receiveShadow=true;m.computeBoundingSphere();m.matrixAutoUpdate=false;scene.add(m);}
    remove.length=0;batches.clear();
    // Unique roofs and rock meshes can still share one draw per material.
    if(window.TiangongMergeGeometries){
      const groups=new Map();objects.traverse(o=>{if(!o.isMesh)return;const key=o.material.uuid;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);});
      for(const list of groups.values())if(list.length>1){const source=list.map(o=>o.geometry.clone().applyMatrix4(o.matrixWorld)),merged=window.TiangongMergeGeometries(source,false);source.forEach(g=>g.dispose());if(!merged)continue;const combined=new T.Mesh(merged,list[0].material);combined.castShadow=true;combined.receiveShadow=true;combined.matrixAutoUpdate=false;scene.add(combined);for(const o of list){o.geometry.dispose();o.removeFromParent();}}
    }
    objects.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;});objects.updateMatrixWorld(true);objects.matrixWorldAutoUpdate=false;
    // Gradient atmosphere with a broad scattering halo around the sun.
    const skyMat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{night:{value:0}},vertexShader:`varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`varying vec3 v;uniform float night;void main(){vec3 d=normalize(v);float h=smoothstep(-.12,.8,d.y);vec3 col=mix(vec3(.70,.73,.68),vec3(.27,.40,.46),h);float s=max(0.,dot(d,normalize(vec3(-.65,.42,-.2))));col+=vec3(.34,.22,.10)*pow(s,12.)+vec3(.65,.49,.27)*pow(s,400.);col=mix(col,vec3(.08,.12,.18)+col*.28,night);gl_FragColor=vec4(col,1.);}`});
    scene.add(new T.Mesh(new T.SphereGeometry(1200,32,16),skyMat));
    const galaxy=window.TiangongGalaxy.create(scene);
    // Layered noise cloud sheets: soft density, self-shaped lighting, slow advection.
    // Prebaked periodic density and lighting. Preserve four advecting layers
    // but replace 60 procedural noise evaluations per pixel with texture reads.
    const noiseGrid=new Float32Array(256*256);let noiseSeed=7539;
    for(let i=0;i<noiseGrid.length;i++){noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;noiseGrid[i]=noiseSeed/4294967296;}
    function noise(x,y,period){const ix=Math.floor(x),iy=Math.floor(y),sx=x-ix,sy=y-iy,u=sx*sx*(3-2*sx),v=sy*sy*(3-2*sy);const sample=(a,b)=>noiseGrid[((b%period+period)%period)*256+(a%period+period)%period];return T.MathUtils.lerp(T.MathUtils.lerp(sample(ix,iy),sample(ix+1,iy),u),T.MathUtils.lerp(sample(ix,iy+1),sample(ix+1,iy+1),u),v);}
    function bakedFbm(x,y){let s=0,a=.5;for(let i=0;i<5;i++){const f=2**i;s+=noise(x*f,y*f,16*f)*a;a*=.5;}return s;}
    const cloudSize=512,cloudBytes=new Uint8Array(cloudSize*cloudSize*4);
    for(let y=0;y<cloudSize;y++)for(let x=0;x<cloudSize;x++){const px=x/cloudSize*16,py=y/cloudSize*16,i=(y*cloudSize+x)*4;cloudBytes[i]=Math.round(bakedFbm(px,py)*255);cloudBytes[i+1]=Math.round(bakedFbm(px-.16,py+.09)*255);cloudBytes[i+2]=Math.round(bakedFbm(px*2,py*2)*255);cloudBytes[i+3]=255;}
    const cloudTex=new T.DataTexture(cloudBytes,cloudSize,cloudSize);cloudTex.wrapS=cloudTex.wrapT=T.RepeatWrapping;cloudTex.magFilter=T.LinearFilter;cloudTex.minFilter=T.LinearMipmapLinearFilter;cloudTex.generateMipmaps=true;cloudTex.needsUpdate=true;textures.push(cloudTex);
    const cloudMaterials=[],cloudMeshes=[];
    for(let layer=0;layer<4;layer++){
      const cm=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{time:{value:0},night:{value:0},layer:{value:layer},cloudNoise:{value:cloudTex}},
        vertexShader:`varying vec3 world;void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
        fragmentShader:`varying vec3 world;uniform float time;uniform float night;uniform float layer;uniform sampler2D cloudNoise;
        void main(){vec2 p=(world.xz*.017+vec2(time*.009,layer*4.))/16.;vec3 n=texture2D(cloudNoise,p).rgb;float den=smoothstep(.27,.66,n.r+.17*n.b);vec3 c=mix(vec3(.45,.54,.55),vec3(.91,.89,.80),smoothstep(.30,.66,n.g));c=mix(c,c*vec3(.28,.34,.48),night);float edge=1.-smoothstep(420.,570.,length(world.xz));gl_FragColor=vec4(c,den*edge*.64);}`});
      const cloud=new T.Mesh(new T.PlaneGeometry(1200,1200),cm);cloud.rotation.x=-Math.PI/2;cloud.position.y=-5-layer*4;cloud.renderOrder=4-layer;scene.add(cloud);cloudMaterials.push(cm);cloudMeshes.push(cloud);
    }
    // Wind-blown mist in front of the mountain foot, with soft alpha texture.
    const fogCanvas=document.createElement('canvas');fogCanvas.width=fogCanvas.height=128;const fc=fogCanvas.getContext('2d'),gradient=fc.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'rgba(226,227,214,.35)');gradient.addColorStop(.4,'rgba(216,224,219,.14)');gradient.addColorStop(1,'rgba(211,223,219,0)');fc.fillStyle=gradient;fc.fillRect(0,0,128,128);const fogTex=new T.CanvasTexture(fogCanvas);textures.push(fogTex);
    const wisps=[];for(let i=0;i<23;i++){const m=new T.SpriteMaterial({map:fogTex,transparent:true,depthWrite:false,opacity:.32});const s=new T.Sprite(m);s.position.set((rand()-.5)*250,-8+rand()*13,(rand()-.5)*220);s.scale.set(70+rand()*65,9+rand()*14,1);scene.add(s);wisps.push({s,x:s.position.x,phase:rand()*6.28});}
    // A quiet flock supplies a readable scale cue.
    const flock=new T.Group();scene.add(flock);const birds=[];
    for(let i=0;i<9;i++){const p=group(0,0,0,flock);const geom=new T.BufferGeometry();geom.setAttribute('position',new T.Float32BufferAttribute([-1.2,0,.3,0,.1,0,1.2,0,.3],3));const line=new T.Line(geom,new T.LineBasicMaterial({color:'#313f3c',transparent:true,opacity:.65}));p.add(line);p.position.set(i*2.4,rand()*3,(i%2?1:-1)*i);birds.push(line);}
    renderer.shadowMap.needsUpdate=true;
    const target=new T.Vector3(...SHOTS[0].target),goalTarget=target.clone();camera.position.fromArray(SHOTS[0].pos);const goalPos=camera.position.clone();let goalFov=43;
    let observing=false,starYaw=0,starPitch=.40,starBlend=0;const starEye=new T.Vector3(),starDirection=new T.Vector3();
    let shot=0,dusk=false,night=0,paused=false,disposed=false,raf=0,last=performance.now(),elapsed=0,projectClock=0;
    let drag=null,manualYaw=0,manualPitch=0,zoom=1;let transition=null;const proj=new T.Vector3(),adjusted=new T.Vector3(),yAxis=new T.Vector3(0,1,0);
    let viewWidth=1,viewHeight=1,quality='high',autoQuality=false,qualityWindow=0,qualityFrames=0,qualityCooldown=8;
    const projectedSites=SITES.map(s=>({...s,x:0,y:0,visible:false}));
    function resize(){viewWidth=Math.max(1,canvas.clientWidth);viewHeight=Math.max(1,canvas.clientHeight);renderer.setSize(viewWidth,viewHeight,false);camera.aspect=viewWidth/viewHeight;camera.updateProjectionMatrix();}
    function applyQuality(level){quality=level;const cap={high:1.6,balanced:1.25,smooth:1}[level];renderer.setPixelRatio(Math.min(devicePixelRatio,cap));cloudMeshes.forEach((m,i)=>m.visible=level!=='smooth'||i!==3);resize();qualityCooldown=8;}
    function setQuality(mode){autoQuality=mode==='auto';applyQuality(autoQuality?'high':(['high','balanced','smooth'].includes(mode)?mode:'high'));}
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
    function setShot(index){observing=false;shot=index;const s=SHOTS[index];goalPos.fromArray(s.pos);goalTarget.fromArray(s.target);goalFov=s.fov;manualYaw=0;manualPitch=0;zoom=1;transition={from:camera.position.clone(),target:target.clone(),fov:camera.fov,at:elapsed,duration:reduced.matches?0:2.8};}
    function pointerDown(e){if(e.button!==0)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}
    function pointerMove(e){if(!drag)return;if(observing){starYaw-=(e.clientX-drag.x)*.004;starPitch=T.MathUtils.clamp(starPitch+(e.clientY-drag.y)*.003,-.65,1.48);drag={x:e.clientX,y:e.clientY};return;}manualYaw-=(e.clientX-drag.x)*.004;manualPitch=T.MathUtils.clamp(manualPitch+(e.clientY-drag.y)*.003,-.18,.3);drag={x:e.clientX,y:e.clientY};}
    function pointerUp(){drag=null;}
    function wheel(e){e.preventDefault();if(observing){goalFov=T.MathUtils.clamp(goalFov+e.deltaY*.025,30,85);return;}zoom=T.MathUtils.clamp(zoom*Math.exp(e.deltaY*.0008),.64,1.45);}
    function keys(e){if(observing&&e.key.startsWith('Arrow')){if(e.key==='ArrowLeft')starYaw-=.08;if(e.key==='ArrowRight')starYaw+=.08;if(e.key==='ArrowUp')starPitch=Math.min(1.48,starPitch+.06);if(e.key==='ArrowDown')starPitch=Math.max(-.65,starPitch-.06);e.preventDefault();return;}if(e.key==='ArrowLeft')manualYaw-=.08;else if(e.key==='ArrowRight')manualYaw+=.08;else if(e.key==='ArrowUp')zoom=Math.max(.64,zoom*.94);else if(e.key==='ArrowDown')zoom=Math.min(1.45,zoom*1.06);else return;e.preventDefault();}
    const handlers={pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerUp,pointercancel:pointerUp,wheel,keydown:keys};for(const [k,f] of Object.entries(handlers))canvas.addEventListener(k,f,{passive:k!=='wheel'});
    function render(now){
      if(disposed)return;raf=requestAnimationFrame(render);if(document.hidden||paused){last=now;return;}
      const rawDt=(now-last)/1000,dt=Math.min(rawDt,.1);last=now;if(!paused&&!reduced.matches)elapsed+=dt;
      if(autoQuality&&rawDt>0&&rawDt<.25){qualityWindow+=rawDt;qualityFrames++;qualityCooldown-=dt;
        if(qualityWindow>=3){const avg=qualityWindow/qualityFrames;if(qualityCooldown<=0){const levels=['smooth','balanced','high'],index=levels.indexOf(quality);if(avg>.025&&index>0)applyQuality(levels[index-1]);else if(avg<.013&&index<2){applyQuality(levels[index+1]);qualityCooldown=16;}}qualityWindow=0;qualityFrames=0;}}
      starBlend=T.MathUtils.lerp(starBlend,observing?1:0,reduced.matches?1:1-Math.exp(-dt*.75));
      night=T.MathUtils.lerp(night,observing||dusk?1:0,reduced.matches?1:1-Math.exp(-dt*1.4));skyMat.uniforms.night.value=night;
      sun.intensity=3.4-night*2.5;ambient.intensity=2.0-night*.8;rim.intensity=.9+starBlend*.45;renderer.toneMappingExposure=1.02-night*.05;
      scene.fog.color.setRGB(.70-night*.38-starBlend*.25,.72-night*.35-starBlend*.26,.67-night*.25-starBlend*.28);scene.fog.density=.0028-starBlend*.0018;
      M.lamp.emissiveIntensity=1+night*2;
      cloudMaterials.forEach(m=>{m.uniforms.time.value=elapsed;m.uniforms.night.value=night;});
      wisps.forEach(w=>{w.s.position.x=w.x+Math.sin(elapsed*.024+w.phase)*14;w.s.material.opacity=.24-night*.07;});
      flock.position.set(Math.sin(elapsed*.012)*85-40,38+Math.sin(elapsed*.04)*3,-95+Math.cos(elapsed*.012)*25);flock.rotation.y=-elapsed*.012;
      birds.forEach((b,i)=>{const a=b.geometry.attributes.position;a.setY(0,Math.sin(elapsed*2.3+i)*.32);a.setY(2,Math.sin(elapsed*2.3+i)*.32);a.needsUpdate=true;});
      adjusted.copy(goalPos).sub(goalTarget);adjusted.applyAxisAngle(yAxis,manualYaw);adjusted.y+=adjusted.length()*manualPitch;adjusted.multiplyScalar(zoom).add(goalTarget);
      if(observing){adjusted.copy(starEye);starDirection.set(Math.sin(starYaw)*Math.cos(starPitch),Math.sin(starPitch),-Math.cos(starYaw)*Math.cos(starPitch));goalTarget.copy(starEye).addScaledVector(starDirection,180);}
      if(transition){const t=transition.duration&&!reduced.matches?Math.min(1,(elapsed-transition.at)/transition.duration):1,e=t*t*t*(t*(6*t-15)+10);camera.position.lerpVectors(transition.from,adjusted,e);target.lerpVectors(transition.target,goalTarget,e);camera.fov=T.MathUtils.lerp(transition.fov,goalFov,e);if(t===1)transition=null;}
      else{const e=reduced.matches?1:1-Math.exp(-dt*4);camera.position.lerp(adjusted,e);target.lerp(goalTarget,e);camera.fov=T.MathUtils.lerp(camera.fov,goalFov,e);}
      camera.lookAt(target);camera.updateProjectionMatrix();galaxy.update(elapsed,starBlend,camera);lotusSystem?.update(elapsed,night,camera,quality);renderer.render(scene,camera);
      projectClock+=dt;if(projectClock>.08){projectClock=0;for(const site of projectedSites){proj.fromArray(site.point).project(camera);site.x=(proj.x*.5+.5)*viewWidth;site.y=(-.5*proj.y+.5)*viewHeight;site.visible=proj.z<1&&Math.abs(proj.x)<.9&&Math.abs(proj.y)<.72;}onProject?.(projectedSites);}
    }
    raf=requestAnimationFrame(render);
    function dispose(){disposed=true;cancelAnimationFrame(raf);galaxy.dispose();lotusSystem?.dispose();renderTimer?.dispose();observer.disconnect();for(const [k,f] of Object.entries(handlers))canvas.removeEventListener(k,f);const gs=new Set(),ms=new Set();scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();}
    return {setShot,setQuality,focusStars(){const island=observatories.find(o=>o.x===110);observing=true;starYaw=1.05;starPitch=.24;starEye.set(island.x+island.r*.26,island.y+12,island.z+island.r*.80);goalPos.copy(starEye);goalFov=68;manualYaw=manualPitch=0;zoom=1;transition={from:camera.position.clone(),target:target.clone(),fov:camera.fov,at:elapsed,duration:reduced.matches?0:4.8};},focusPond(){observing=false;goalTarget.set(-36,2.5,24);goalPos.set(-24,11,40);goalFov=43;manualYaw=manualPitch=0;zoom=1;transition={from:camera.position.clone(),target:target.clone(),fov:camera.fov,at:elapsed,duration:reduced.matches?0:2.8};},getScene(){return scene;},setDusk(value){dusk=value;},setPaused(value){paused=value;},dispose,stats(){return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,instances:instanceCount,shot,observing,starYaw,starPitch,cameraPosition:camera.position.toArray(),dpr:renderer.getPixelRatio(),quality:(autoQuality?'auto / ':'')+quality,...renderTimer?.stats()};}};
  };
})();
