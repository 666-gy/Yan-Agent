const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../renderer/work-gui/palace');
fs.writeFileSync(path.join(root,'assets/milky-way-data.js'),'window.TiangongGalaxyImage="data:image/jpeg;base64,'+fs.readFileSync(path.join(root,'assets/milky-way-eso.jpg')).toString('base64')+'";\n');
const scene=path.join(root,'scene.js');let s=fs.readFileSync(scene,'utf8');s=s.replace('starYaw=1.05;starPitch=.48;','starYaw=1.05;starPitch=.24;').replace('island.y+17,island.z+island.r*.32','island.y+12,island.z+island.r*.80');fs.writeFileSync(scene,s);
const desktop=path.join(require('node:os').homedir(),'Desktop','云顶天宫 Work GUI · V1');
for(const name of ['stargazing.js','stargazing.css','scene.js','assets/milky-way-data.js','assets/GALAXY-LICENSE.md'])fs.copyFileSync(path.join(root,name),path.join(desktop,name));
