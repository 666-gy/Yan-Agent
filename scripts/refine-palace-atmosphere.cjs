const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../renderer/work-gui/palace');
let p=path.join(root,'stargazing.js'),s=fs.readFileSync(p,'utf8');
// Quintic interpolation removes grid-shaped discontinuities in the cloud field.
s=s.replace('f=f*f*(3.-2.*f);','f=f*f*f*(f*(f*6.-15.)+10.);');
s=s.replace('float envelope=exp(-center*center*20.);','float envelope=exp(-center*center*13.);');
s=s.replace('float core=exp(-center*center*130.)','float core=exp(-center*center*65.)');
s=s.replace('vec3(.13,.12,.27)*envelope*cloud','vec3(.17,.22,.32)*envelope*cloud*1.45');
s=s.replace('vec3(.29,.26,.37)*core*fine*1.7','vec3(.39,.38,.43)*core*(.28+fine)*1.85');
s=s.replace('vec3(.17,.12,.20)*envelope*pow(cloud,3.)*1.5','vec3(.30,.20,.27)*envelope*pow(cloud,3.)*2.1');
s=s.replace('col*=1.-darkDust*.78;','col*=1.-darkDust*.52;float filament=fbm(g*vec2(8.,32.)+vec2(warp,cloud)*1.4);col+=vec3(.15,.23,.24)*envelope*smoothstep(.35,.68,filament)*.55;');
s=s.replace('step(.976-envelope*.034,h)','step(.994-envelope*.008,h)').replace('hash(cell+12.))*1.4','hash(cell+12.))*.42');
fs.writeFileSync(p,s);
p=path.join(root,'scene.js');s=fs.readFileSync(p,'utf8');
s=s.replace("red:mat('red','#a66048'","red:mat('red','#843e32'").replace("gold:mat('gold','#a59058',.4,.58)","gold:mat('gold','#aa8953',.46,.48)");
s=s.replace("roof:mat('roof','#92836a',.64,.15,tileTex),tile:mat('tile','#686d59',.62,.12)","roof:mat('roof','#52615e',.72,.08,tileTex),tile:mat('tile','#3e514e',.66,.09)");
s=s.replace("white:mat('white','#c5c1af'","white:mat('white','#d1cbbb'");
// Architectural vocabulary: lattice transoms, stone plinths and curved eave brackets.
s=s.replace('      roof(p,w+5,d+5,floor+height,4.2);',`      for(const sign of [-1,1]){
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
      roof(p,w+5,d+5,floor+height,4.2);`);
s=s.replace(".36,.8,M.lamp);rod(p,[lx", ".36,.8,M.lamp);for(const h of [-.4,.4])cyl(p,lx,floor+height-1.7+h,d/2+.6,.39,.055,M.gold);rod(p,[lx,floor+height-2.14,d/2+.6],[lx,floor+height-2.6,d/2+.6],.03,M.red);rod(p,[lx");
// Neutralize blue fog and retain moonlit readable architecture at the observatory.
s=s.replace('sun.intensity=3.4-night*2.5;ambient.intensity=2.0-night*1.0;', 'sun.intensity=3.4-night*2.5;ambient.intensity=2.0-night*.8;rim.intensity=.9+starBlend*.45;');
fs.writeFileSync(p,s);
const preview=path.join(require('node:os').homedir(),'Desktop','云顶天宫 Work GUI · V1');
for(const n of ['scene.js','stargazing.js'])fs.copyFileSync(path.join(root,n),path.join(preview,n));
console.log('Cloud river, palette and architectural details updated.');
