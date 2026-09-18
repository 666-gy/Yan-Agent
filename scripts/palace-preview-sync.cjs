const fs=require('node:fs'),path=require('node:path');
const src=path.resolve(__dirname,'../renderer/work-gui/palace');
const dst=path.join(require('node:os').homedir(),'Desktop','云顶天宫 Work GUI · V1');
for(const n of ['app.js','stargazing.js','stargazing.css','entry-audio.js'])fs.copyFileSync(path.join(src,n),path.join(dst,n));
const tmp=path.join(require('node:os').homedir(),'Desktop','test-audio.tmp');
if(fs.existsSync(tmp)&&fs.readFileSync(tmp).equals(fs.readFileSync(path.join(src,'entry-audio.js'))))fs.unlinkSync(tmp);
