'use strict';
// Official releases are resolved online on every check. Local catalog entries
// supply host adapters only; they never establish what the latest version is.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const semver = require('semver');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
const { inventory, readManifest, manifestSchema } = require('./manifest');
const { adaptOfficialPackage } = require('./official-package-adapter');
const { downloadFile } = require('./upstream');
const { atomicJson } = require('./store');
const SOURCES = Object.freeze({ serena:'https://pypi.org/pypi/serena-agent/json', office:'https://api.github.com/repos/iOfficeAI/OfficeCLI/releases/latest', playwright:'https://registry.npmjs.org/@playwright%2fmcp/latest', 'yan-computer-use':'https://api.github.com/repos/trycua/cua/releases?per_page=100' });
const github = value => `https://api.github.com/repos/${value}`;
function version(value) { const result=String(value || '').replace(/^v/, ''); if(!semver.valid(result) || semver.prerelease(result)) throw Error('官方未返回有效的稳定版本'); return result; }
function copy(source, destination) {
  for(const file of inventory(source).files) { const target=path.join(destination,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,file.path),target); }
}
function makeUpdater({ store, fetcher = fetch, onProgress = () => {}, run = execute } = {}) {
  async function json(url) {
    const response=await fetcher(url,{headers:{'User-Agent':'Yan-Plugin-Updater','Accept':'application/json'},signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw Error(`官方版本检查失败（HTTP ${response.status}）：${new URL(url).hostname}`);
    return response.json();
  }
  const lastProgress = new Map();
  function progress(id, percent) {
    if (lastProgress.get(id) === percent) return;
    lastProgress.set(id, percent); onProgress({id,phase:'update',percent});
  }
  async function exec(command,args,options={}) {
    return run(command,args,{windowsHide:true,timeout:180000,maxBuffer:8*1024*1024, ...options});
  }
  async function asset(file, destination, id) {
    if(!file || !/^sha256:[a-f0-9]{64}$/.test(file.digest || '') || !/^https:\/\/github.com\//.test(file.browser_download_url || '')) throw Error('官方未提供可校验的平台安装包');
    const assetUrl = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+$/.test(file.url || '') ? file.url : file.browser_download_url;
    const response=await fetcher(assetUrl,{headers:{Accept:'application/octet-stream','User-Agent':'Yan-Plugin-Updater'},signal:AbortSignal.timeout(300000)});
    if(!response.ok) throw Error(`官方安装包下载失败（HTTP ${response.status}）`);
    const fd=fs.openSync(destination,'w');const hash=crypto.createHash('sha256');let bytes=0;
    try { for await(const chunk of response.body) { bytes+=chunk.length;if(bytes>1024*1024*1024)throw Error('安装包超过大小限制');fs.writeSync(fd,chunk);hash.update(chunk);progress(id,5+Math.min(65,Math.floor(bytes/Math.max(1,file.size)*65))); } }
    finally { fs.closeSync(fd); }
    if(bytes!==file.size || 'sha256:'+hash.digest('hex')!==file.digest) throw Error('官方安装包摘要校验失败');
    if(process.platform!=='win32')fs.chmodSync(destination,0o755);
  }
  async function check(item, current) {
    if(SOURCES[item.id]) {
      const release=await json(SOURCES[item.id]);let latest;
      if(item.id==='serena')latest=version(release.info?.version);
      if(item.id==='office')latest=version(release.tag_name);
      if(item.id==='playwright')latest=version(release.version);
      let selected=release;
      if(item.id==='yan-computer-use') {
        selected=release.filter(r=>!r.draft&&/^cua-driver-rs-v\d+\.\d+\.\d+$/.test(r.tag_name)).sort((a,b)=>semver.rcompare(a.tag_name.replace('cua-driver-rs-v',''),b.tag_name.replace('cua-driver-rs-v','')))[0];
        if(!selected)throw Error('官方发布列表中没有稳定的 Cua Driver');
        latest=version(selected.tag_name.replace('cua-driver-rs-v',''));
      }
      const installed=current.officialUpdate?.version || (item.id==='office'?require('../officecli-runtime').OFFICECLI_VERSION:item.id==='yan-computer-use'?require('../cua-driver-runtime').VERSION:current.version);
      return {source:SOURCES[item.id],version:latest,release:selected,updated:semver.gt(latest,version(installed))};
    }
    if(item.repository!=='openai/plugins')throw Error('此插件尚未提供可验证的官方更新源');
    const tree=await json(github('openai/plugins/git/trees/main?recursive=1'));
    if(tree.truncated || !Array.isArray(tree.tree))throw Error('官方插件文件清单不完整');
    const prefix=`plugins/${item.id}/`;
    const folder=tree.tree.find(node=>node.path===`plugins/${item.id}`&&node.type==='tree');
    if(!folder)throw Error('官方仓库已移除此插件');
    if(current.officialUpdate?.revision===folder.sha)return {updated:false};
    const files=tree.tree.filter(node=>node.path.startsWith(prefix)&&node.type==='blob').map(node=>({...node,path:node.path.slice(prefix.length)}));
    if(files.some(file=>file.mode==='120000')||files.length>1000||files.reduce((n,f)=>n+f.size,0)>64*1024*1024)throw Error('官方插件文件超出支持范围');
    const manifestFile=files.find(file=>file.path==='.codex-plugin/plugin.json');
    if(!manifestFile)throw Error('官方插件缺少清单');
    const entry={id:item.id,revision:tree.sha};
    const upstream=JSON.parse((await downloadFile(entry,manifestFile,fetcher)).toString('utf8'));
    const latest=version(upstream.version);
    if(semver.gt(version(current.version),latest))return {updated:false};
    if (store && files.every(file => {
      const target=path.join(store.packageRoot(current),file.path);
      if(file.path.split('/').includes('..')||/[\\:\x00]/.test(file.path)||!fs.existsSync(target))return false;
      const bytes=fs.readFileSync(target);
      return bytes.length===file.size && crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')===file.sha;
    })) return {updated:false};
    return {updated:true,source:'https://github.com/openai/plugins',version:latest,revision:folder.sha,entry,files};
  }
  async function prepare(item,current,release) {
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'yan-official-update-'));const source=path.join(temporary,'package');fs.mkdirSync(source);
    let runtime;
    const metadata={source:release.source,version:release.version,...(release.revision?{revision:release.revision}:{})};
    try {
      progress(item.id,0);
      if(release.files) {
        let cursor=0,completed=0;
        const outcomes=await Promise.allSettled(Array.from({length:5},async()=>{
          while(cursor<release.files.length) {
            const file=release.files[cursor++];const data=await downloadFile(release.entry,file,fetcher);
            if(file.path.split('/').some(part=>!part||part==='..'||part==='.')||/[\\:\x00]/.test(file.path))throw Error('官方包路径不合法');
            const target=path.join(source,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
            progress(item.id,Math.floor(++completed/release.files.length*80));
          }
        }));
        const failed=outcomes.find(r=>r.status==='rejected');if(failed)throw failed.reason;
        const adapted=adaptOfficialPackage(source).manifest;
        const host=store.manifest(current);
        // Keep the host's authenticated connection adapter. Skills and their
        // references come from the freshly pinned official repository tree.
        const manifest={...adapted,id:item.id,mcpServers:host.mcpServers,configuration:host.configuration,environment:host.environment,requiredCommands:host.requiredCommands};
        if(host.instructions) {manifest.instructions=host.instructions;fs.copyFileSync(path.join(store.packageRoot(current),host.instructions),path.join(source,host.instructions));}
        atomicJson(path.join(source,'yan-plugin.json'),manifestSchema.parse(manifest));
      } else {
        copy(path.join(__dirname,'catalog',item.id),source);
        const manifest=readManifest(source);manifest.version=release.version;
        runtime=path.join(store.root,'official-runtimes',item.id,release.version+'-'+crypto.randomUUID());fs.mkdirSync(runtime,{recursive:true});
        if(item.id==='serena') {
          const spec=`serena-agent==${release.version}`;
          await exec('uvx',['--from',spec,'serena','start-mcp-server','--help']);
          manifest.mcpServers[0].args=manifest.mcpServers[0].args.map(arg=>/^serena-agent==/.test(arg)?spec:arg);
          progress(item.id,80);
        } else if(item.id==='office') {
          const office=require('../officecli-runtime');const binary=path.join(runtime,office.binaryName());
          await asset(release.release.assets?.find(a=>a.name===office.assetName()),binary,item.id);
          await exec(binary,['--version']);
          // Bind the package runner to this verified immutable runtime, so PATH
          // or an older managed Office binary cannot win resolution.
          fs.writeFileSync(path.join(source,'scripts','officecli-runner.js'),`'use strict';\nconst {spawn}=require('node:child_process');\nconst child=spawn(${JSON.stringify(binary)},process.argv.slice(2),{stdio:'inherit',shell:false,windowsHide:true});\nchild.on('error',error=>{console.error(error.message);process.exitCode=1;});\nchild.on('exit',code=>{process.exitCode=code??1;});\n`);
          metadata.runtime=binary;
        } else if(item.id==='playwright') {
          const npm=await findNpm();
          await exec(process.execPath,[npm,'install','--prefix',runtime,'--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org',`@playwright/mcp@${release.version}`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:300000});
          progress(item.id,45);
          const browserRoot=path.join(runtime,'browsers');
          const pwRoot=path.dirname(require.resolve('playwright/package.json',{paths:[runtime]}));
          await exec(process.execPath,[path.join(pwRoot,'cli.js'),'install','chromium','--no-shell'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PLAYWRIGHT_BROWSERS_PATH:browserRoot},timeout:600000});
          const result=await exec(process.execPath,['-e',`console.log(require(${JSON.stringify(pwRoot)}).chromium.executablePath())`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PLAYWRIGHT_BROWSERS_PATH:browserRoot}});
          const browser=String(result.stdout).trim();if(!fs.existsSync(browser))throw Error('Chromium 准备失败');
          metadata.runtime={root:runtime,browsers:browserRoot,browser,entry:path.join(runtime,'node_modules','@playwright','mcp','cli.js')};
          await exec(process.execPath,[metadata.runtime.entry,'--version'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
          progress(item.id,85);
        } else if(item.id==='yan-computer-use') {
          if(process.platform!=='win32'||process.arch!=='x64')throw Error('电脑操控更新仅支持 Windows x64');
          const archive=path.join(temporary,'driver.zip');
          await asset(release.release.assets?.find(a=>a.name===`cua-driver-rs-${release.version}-windows-x86_64-binary.zip`),archive,item.id);
          await extractZip(archive,runtime);
          const executable=findFile(runtime,'cua-driver.exe');if(!executable)throw Error('官方包缺少 Cua Driver');
          await exec(executable,['mcp','--help']);metadata.runtime=executable;progress(item.id,85);
        }
        atomicJson(path.join(source,'yan-plugin.json'),manifestSchema.parse(manifest));
      }
      return {source,digest:inventory(source).digest,metadata,cleanup:()=>fs.rmSync(temporary,{recursive:true,force:true}),discard:()=>{fs.rmSync(temporary,{recursive:true,force:true});if(runtime)fs.rmSync(runtime,{recursive:true,force:true});}};
    } catch(error) { fs.rmSync(temporary,{recursive:true,force:true});if(runtime)fs.rmSync(runtime,{recursive:true,force:true});throw error; }
  }
  async function findNpm() {
    const candidates=[path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')];
    for(const dir of String(process.env.PATH||process.env.Path||'').split(path.delimiter)) {
      candidates.push(path.join(dir,'node_modules/npm/bin/npm-cli.js'),path.join(dir,'../lib/node_modules/npm/bin/npm-cli.js'));
    }
    const found=candidates.find(file=>fs.existsSync(file));if(found)return found;
    // Electron supplies Node; bootstrap npm from its official, integrity-pinned
    // tarball when the user has no separate Node/npm installation.
    const release=await json('https://registry.npmjs.org/npm/latest');
    const npmVersion=version(release.version);
    const integrity=/^sha512-([A-Za-z0-9+/=]+)$/.exec(release.dist?.integrity || '');
    if(!integrity || !/^https:\/\/registry\.npmjs\.org\//.test(release.dist?.tarball || ''))throw Error('npm 官方安装包元数据无效');
    const root=path.join(store.root,'official-runtimes','npm',npmVersion+'-'+crypto.randomUUID());fs.mkdirSync(root,{recursive:true});
    const archive=path.join(root,'npm.tgz');
    try {
      const response=await fetcher(release.dist.tarball,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('下载官方 npm 失败');
      const chunks=[];let length=0;
      for await(const chunk of response.body){length+=chunk.length;if(length>64*1024*1024)throw Error('npm 安装包过大');chunks.push(Buffer.from(chunk));}
      const bytes=Buffer.concat(chunks);if(crypto.createHash('sha512').update(bytes).digest('base64')!==integrity[1])throw Error('npm 安装包校验失败');
      fs.writeFileSync(archive,bytes);
      await require('tar').x({file:archive,cwd:root,strip:1,filter:(name,entry)=>!['SymbolicLink','Link'].includes(entry.type)&&!name.split('/').includes('..')&&!path.isAbsolute(name)});
      fs.unlinkSync(archive);const cli=path.join(root,'bin','npm-cli.js');if(!fs.existsSync(cli))throw Error('npm 安装包缺少 CLI');return cli;
    } catch(error){fs.rmSync(root,{recursive:true,force:true});throw error;}
  }
  async function extractZip(archive,destination) {
    // Validate every entry before extraction; no source path is interpolated in code.
    const script=`Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:YAN_UPDATE_ARCHIVE); try { foreach($e in $z.Entries) { $p=[IO.Path]::GetFullPath([IO.Path]::Combine($env:YAN_UPDATE_DEST,$e.FullName)); if (!$p.StartsWith($env:YAN_UPDATE_DEST+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path' } } } finally { $z.Dispose() }; [IO.Compression.ZipFile]::ExtractToDirectory($env:YAN_UPDATE_ARCHIVE,$env:YAN_UPDATE_DEST)`;
    await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,YAN_UPDATE_ARCHIVE:archive,YAN_UPDATE_DEST:destination}});
  }
  return {check,prepare};
}
function findFile(root,name) {for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isFile()&&entry.name===name)return file;if(entry.isDirectory()){const found=findFile(file,name);if(found)return found;}}return '';}
module.exports={makeUpdater,SOURCES};
