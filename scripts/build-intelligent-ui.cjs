'use strict';
const esbuild=require('esbuild'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function build(){
 const result=await esbuild.build({entryPoints:[path.join(root,'renderer/intelligent-ui-openui.jsx')],bundle:true,write:false,minify:true,platform:'browser',format:'iife',target:'chrome130',define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
 const destination=path.join(root,'renderer/vendor/openui/intelligent-ui-runtime.js');
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.writeFileSync(destination,'/* Locally bundled React + MIT OpenUI; executed only inside the panel sandbox. */\nwindow.YanIntelligentUiOpenUiSource='+JSON.stringify(result.outputFiles[0].text)+';\n');
 const packages=['@openuidev/lang-core','@openuidev/react-lang','@openuidev/devtools','@openuidev/observability','react','react-dom','scheduler','zod'];
 const licenses=packages.map(name=>{const dir=path.join(root,'node_modules',name);const file=['LICENSE','LICENSE.md','LICENSE.txt'].find(f=>fs.existsSync(path.join(dir,f)));if(!file)throw new Error('Missing license for '+name);return name+'\n\n'+fs.readFileSync(path.join(dir,file),'utf8');});
 fs.writeFileSync(path.join(path.dirname(destination),'LICENSES.txt'),licenses.join('\n\n--------------------\n\n'));
 console.log('Built OpenUI runtime: '+result.outputFiles[0].contents.length+' bytes');
}
build().catch(error=>{console.error(error);process.exitCode=1;});
