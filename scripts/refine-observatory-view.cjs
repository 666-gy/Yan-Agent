const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../renderer/work-gui/palace');
const p=path.join(root,'scene.js');let s=fs.readFileSync(p,'utf8');
s=s.replace('observing=true;starYaw=-.26;starPitch=.4;starEye.set(island.x,island.y+5.5,island.z+island.r*.35)','observing=true;starYaw=1.05;starPitch=.48;starEye.set(island.x+island.r*.26,island.y+17,island.z+island.r*.32)');fs.writeFileSync(p,s);
const dst=path.join(require('node:os').homedir(),'Desktop','云顶天宫 Work GUI · V1');fs.copyFileSync(p,path.join(dst,'scene.js'));
