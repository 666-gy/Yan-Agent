/* Two shallow stone basins, live planar reflection, modeled lotus and leaves. */
(() => {
  const T=window.THREE;
  window.TiangongLotus={create(scene,renderer){
    const root=new T.Group();root.name='双莲池';scene.add(root);const waterHeight=2.34,waterMeshes=[],flowers=[];
    const stone=new T.MeshStandardMaterial({color:'#adaf9e',roughness:.91}),bottom=new T.MeshStandardMaterial({color:'#537a67',roughness:.96});
    const green=new T.MeshStandardMaterial({color:'#416648',roughness:.68,side:T.DoubleSide}),vein=new T.MeshStandardMaterial({color:'#829465',roughness:.8});
    const pink=new T.MeshStandardMaterial({color:'#dea6ac',roughness:.48,side:T.DoubleSide}),ivory=new T.MeshStandardMaterial({color:'#e8d5c0',roughness:.53,side:T.DoubleSide}),heart=new T.MeshStandardMaterial({color:'#ccb35c',roughness:.67});
    const target=new T.WebGLRenderTarget(512,512,{depthBuffer:true});target.texture.colorSpace=T.LinearSRGBColorSpace;
    const reflected=new T.PerspectiveCamera(),textureMatrix=new T.Matrix4(),bias=new T.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
    const uniforms={time:{value:0},reflection:{value:target.texture},reflectionMatrix:{value:textureMatrix},night:{value:0}};
    const water=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms,vertexShader:`
      uniform mat4 reflectionMatrix; uniform float time; varying vec3 world; varying vec4 projected;
      void main(){vec4 p=modelMatrix*vec4(position,1.);p.y+=.012*sin(p.x*1.9+time*.8)*sin(p.z*1.2-time*.5);world=p.xyz;projected=reflectionMatrix*p;gl_Position=projectionMatrix*viewMatrix*p;}`,
      fragmentShader:`uniform float time;uniform float night;uniform sampler2D reflection;varying vec3 world;varying vec4 projected;
      void main(){float a=world.x*2.1+world.z*.7+time*.8,b=world.z*3.2-world.x*.5-time*.7;
      vec2 ripple=vec2(cos(a)*.018+cos(b)*.007,sin(b)*.016+cos(a)*.009);
      vec3 n=normalize(vec3(ripple.x*2.,1.,ripple.y*2.));vec3 v=normalize(cameraPosition-world);
      float fresnel=.06+.70*pow(1.-max(dot(n,v),0.),4.);vec2 uv=projected.xy/projected.w+ripple*.10;
      vec3 reflected=texture2D(reflection,clamp(uv,.002,.998)).rgb;
      vec3 col=mix(vec3(.105,.255,.213)*(1.-night*.42),reflected,fresnel);
      float caustic=pow(max(0.,sin(a*1.4+sin(b))*sin(b*1.3+sin(a))),14.);col+=vec3(.15,.21,.14)*caustic*.28;
      vec3 light=normalize(vec3(-.55,.8,.2));float glint=pow(max(0.,dot(reflect(-light,n),v)),180.);col+=vec3(.9,.76,.49)*glint*(1.-night*.85);
      gl_FragColor=vec4(col,.62+fresnel*.30);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    const mesh=(p,g,m,x=0,y=0,z=0)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.receiveShadow=true;p.add(o);return o;};
    const box=(x,y,z,w,h,d,m=stone)=>mesh(root,new T.BoxGeometry(w,h,d),m,x,y,z);
    const tube=(p,points,r,m)=>mesh(p,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(v=>new T.Vector3(...v))),12,r,5),m);
    function leaf(x,z,size,phase){
      const g=new T.BufferGeometry(),p=[],idx=[];
      for(let j=0;j<=6;j++)for(let i=0;i<=40;i++){const r=j/6*size,a=.14+i/40*(Math.PI*2-.28);p.push(Math.sin(a)*r,.035*(r/size)**2+Math.sin(a*5)*.024*(r/size)**3,Math.cos(a)*r);if(j&&i){const k=j*41+i;idx.push(k,k-1,k-42,k,k-42,k-41);}}g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();
      const group=new T.Group();group.position.set(x,waterHeight+.045,z);group.rotation.y=phase;root.add(group);mesh(group,g,green);
      for(let i=1;i<=8;i++){const a=i/9*Math.PI*2;tube(group,[[0,.006,0],[Math.sin(a)*size*.48,.015,Math.cos(a)*size*.48],[Math.sin(a)*size*.93,.039,Math.cos(a)*size*.93]],.005,vein);}
      flowers.push({group,phase,leaf:true});
    }
    function lotus(x,z,height,phase,white=false){
      const group=new T.Group();group.position.set(x,waterHeight,z);root.add(group);
      tube(group,[[0,-.58,0],[.025,height*.5,.025],[0,height,0]],.018,green);
      const blossom=new T.Group();blossom.position.y=height;group.add(blossom);const petalMat=white?ivory:pink;
      for(let ring=0;ring<3;ring++)for(let k=0;k<9-ring;k++){
        const p=[],idx=[],angle=k/(9-ring)*Math.PI*2+ring*.37,length=.40-ring*.075,width=.14-ring*.024;
        for(let j=0;j<=10;j++)for(let i=0;i<=6;i++){const t=j/10,u=i/6*2-1,spread=Math.sin(Math.PI*t)**.75;p.push(u*width*spread,.025+Math.pow(t,1.7)*(.21+ring*.08)+u*u*.045,t*length);if(i&&j){const b=j*7+i;idx.push(b,b-1,b-8,b,b-8,b-7);}}
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();const m=mesh(blossom,g,petalMat);m.rotation.y=angle;
      }
      mesh(blossom,new T.SphereGeometry(.068,12,8),heart,0,.06,0);
      for(let i=0;i<12;i++){const a=i/12*Math.PI*2;mesh(blossom,new T.SphereGeometry(.012,6,4),heart,Math.sin(a)*.078,.092,Math.cos(a)*.078);}
      flowers.push({group,phase,leaf:false});
    }
    for(const x of [-36,36]){
      box(x,1.65,24,18,.13,18,bottom);
      for(const s of [-1,1]){box(x+s*9,2.05,24,.60,.9,18.6);box(x,2.05,24+s*9,18.6,.9,.60);box(x+s*9,2.54,24,.78,.10,18.8);box(x,2.54,24+s*9,18.8,.10,.78);}
      const plane=mesh(root,new T.PlaneGeometry(17.4,17.4,40,40),water,x,waterHeight,24);plane.rotation.x=-Math.PI/2;plane.renderOrder=2;waterMeshes.push(plane);
      for(let i=0;i<17;i++){const theta=i*2.39996,r=2+Math.sqrt(i/17)*5,xx=x+Math.sin(theta)*r,zz=24+Math.cos(theta)*r;leaf(xx,zz,.48+(i%4)*.10,i*.9);if(i%3===0)lotus(xx+.45,zz-.35,.55+(i%3)*.12,i*.7,x>0);}
      for(let i=0;i<24;i++){const o=mesh(root,new T.SphereGeometry(1,8,5),bottom,x+Math.sin(i*2.4)*7,1.77,24+Math.cos(i*1.9)*7);o.scale.set(.16+(i%3)*.09,.08,.23);}
    }
    // Static petals/stems/leaves merge within each animated plant, not per petal draw.
    function mergeGroup(group){group.updateMatrixWorld(true);const batches=new Map();group.traverse(o=>{if(!o.isMesh)return;const k=o.material.uuid;if(!batches.has(k))batches.set(k,[]);batches.get(k).push(o);});const inv=new T.Matrix4().copy(group.matrixWorld).invert();for(const list of batches.values()){const parts=list.map(o=>o.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld)));const g=window.TiangongMergeGeometries(parts,false);parts.forEach(x=>x.dispose());if(g){mesh(group,g,list[0].material);list.forEach(o=>{o.geometry.dispose();o.removeFromParent();});}}}
    for(const f of flowers)mergeGroup(f.group);
    let lastReflection=-10,disposed=false;const look=new T.Vector3(),direction=new T.Vector3(),up=new T.Vector3();const clip=new T.Plane(new T.Vector3(0,1,0),-waterHeight+.025);
    return {update(time,night,camera,quality){if(disposed)return;uniforms.time.value=time;uniforms.night.value=night;for(const f of flowers){f.group.rotation.z=Math.sin(time*.65+f.phase)*(f.leaf?.009:.025);if(f.leaf)f.group.position.y=waterHeight+.045+Math.sin(time*.8+f.phase)*.010;}
      if(time-lastReflection<(quality==='smooth'?.25:.12))return;lastReflection=time;
      camera.getWorldDirection(direction);look.copy(camera.position).add(direction);look.y=waterHeight*2-look.y;
      reflected.copy(camera);reflected.position.y=waterHeight*2-camera.position.y;up.copy(camera.up);up.y=-up.y;reflected.up.copy(up);reflected.lookAt(look);reflected.updateMatrixWorld();
      textureMatrix.copy(bias).multiply(reflected.projectionMatrix).multiply(reflected.matrixWorldInverse);
      const previousTarget=renderer.getRenderTarget(),previousClipping=renderer.clippingPlanes,previousXr=renderer.xr.enabled;const shadowUpdate=renderer.shadowMap.autoUpdate;
      try{waterMeshes.forEach(m=>m.visible=false);renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.clippingPlanes=[clip];renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,reflected);}finally{renderer.setRenderTarget(previousTarget);renderer.clippingPlanes=previousClipping;renderer.xr.enabled=previousXr;renderer.shadowMap.autoUpdate=shadowUpdate;waterMeshes.forEach(m=>m.visible=true);}
    },dispose(){if(disposed)return;disposed=true;target.dispose();const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());root.removeFromParent();}};
  }};
})();
