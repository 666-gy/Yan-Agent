/* ESO/S. Brunier, CC BY 4.0. Photographic celestial sphere; atmospheric veil is independent. */
(() => {
  const T=window.THREE;
  window.TiangongGalaxy={create(scene){
    let disposed=false,ready=false;
    const texture=new T.Texture();texture.wrapS=T.RepeatWrapping;texture.minFilter=T.LinearMipmapLinearFilter;
    const material=new T.ShaderMaterial({side:T.BackSide,transparent:true,depthWrite:false,
      uniforms:{map:{value:texture},time:{value:0},opacity:{value:0}},
      vertexShader:`varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`precision highp float;
        varying vec3 direction;uniform sampler2D map;uniform float time,opacity;
        float hash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){
          vec3 d=normalize(direction);
          vec3 forward=normalize(vec3(.77,.46,-.44));
          vec3 right=normalize(cross(forward,vec3(0,1,0)));
          vec3 up=cross(right,forward);
          float x=dot(d,right),y=dot(d,up),z=dot(d,forward);
          float tilt=.48;
          vec2 q=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*vec2(x,y);
          vec2 uv=vec2(.5+atan(q.x,z)/6.283185,.5+asin(clamp(q.y,-1.,1.))/3.141593);
          vec3 photo=texture2D(map,uv).rgb;
          vec2 px=vec2(1./6000.,1./3000.);
          vec3 floorLight=min(min(texture2D(map,uv+vec2(px.x,0.)).rgb,texture2D(map,uv-vec2(px.x,0.)).rgb),min(texture2D(map,uv+vec2(0.,px.y)).rgb,texture2D(map,uv-vec2(0.,px.y)).rgb));
          photo=mix(photo,min(photo,floorLight),.88);
          float luminance=dot(photo,vec3(.2126,.7152,.0722));
          // Preserve photographic dust lanes, suppress bright stellar spikes, cool gently.
          photo=mix(vec3(luminance),photo,.45)*vec3(.87,.97,1.08);
          photo=photo/(1.+photo*.7)*1.08;
          vec3 base=mix(vec3(.018,.030,.047),vec3(.004,.009,.019),smoothstep(-.08,.5,d.y));
          float horizon=smoothstep(-.13,.22,d.y);
          vec3 col=base+photo*horizon;
          // Nearby, low-altitude haze moves independently; celestial image stays fixed.
          vec2 p=d.xz/(abs(d.y)+.32)*2.4+vec2(time*.006,time*.002);
          float n=noise(p)*.65+noise(p*2.07+5.)*.25+noise(p*4.1)*.1;
          float veil=smoothstep(.49,.78,n)*exp(-pow((d.y-.10)*3.8,2.))*.32;
          col=mix(col,vec3(.09,.115,.135),veil);
          gl_FragColor=vec4(col,opacity);
        }`
    });
    const dome=new T.Mesh(new T.SphereGeometry(1150,64,32),material);
    dome.name='观星阁 · ESO 实景银河';dome.renderOrder=-2;dome.frustumCulled=false;scene.add(dome);
    const credit=document.createElement('a');credit.className='galaxy-credit';credit.href='https://www.eso.org/public/images/eso0932a/';credit.target='_blank';credit.rel='noopener';credit.textContent='银河影像：ESO/S. Brunier · CC BY 4.0 · 调色';document.getElementById('experience').append(credit);
    function load(){const img=new Image();img.onload=()=>{if(disposed)return;texture.image=img;texture.needsUpdate=true;ready=true;};img.onerror=()=>{credit.textContent='银河影像加载失败';};img.src=window.TiangongGalaxyImage;}
    // Embedded asset supports both Electron and opening the desktop HTML through file://.
    let script;
    if(window.TiangongGalaxyImage)load();else{script=document.createElement('script');script.src='assets/milky-way-data.js';script.onload=load;script.onerror=()=>{credit.textContent='银河影像加载失败';};document.head.append(script);}
    return {update(time,amount,camera){material.uniforms.time.value=time;material.uniforms.opacity.value=amount;dome.position.copy(camera.position);dome.visible=ready&&amount>.002;},dispose(){disposed=true;script?.remove();credit.remove();dome.removeFromParent();texture.dispose();dome.geometry.dispose();material.dispose();}};
  }};
})();
