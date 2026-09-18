const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../renderer/work-gui/palace');
const p=path.join(root,'stargazing.js');let s=fs.readFileSync(p,'utf8');
// Hash without large sine products: stable fractional noise on WebGL drivers.
s=s.replace('return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);','vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);');
s=s.replace('float fine=fbm(g*vec2(20.,43.)+cloud*2.);','float fine=fbm(g*vec2(14.,28.)+cloud*.7);');
s=s.replace('core*(.28+fine)*1.85','core*(.22+fine)*1.4');
fs.writeFileSync(p,s);fs.copyFileSync(p,path.join(require('node:os').homedir(),'Desktop','云顶天宫 Work GUI · V1','stargazing.js'));
