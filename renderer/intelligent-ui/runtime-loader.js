// Failed loads are evicted so a later render can recover.
const pending = new Map();
function load(source) {
  if (!pending.has(source)) pending.set(source,new Promise((resolve,reject) => {
    const script=document.createElement('script'); script.src=new URL(source,document.baseURI).href;
    script.onload=resolve;
    script.onerror=()=>{pending.delete(source);script.remove();reject(new Error('Runtime load failed: '+source));};
    document.head.append(script);
  }));
  return pending.get(source);
}
export async function loadOpenUi() {
  await load('vendor/openui/intelligent-ui-runtime.js');
  return {script:window.YanIntelligentUiOpenUiSource,css:window.YanIntelligentUiOpenUiCss || ''};
}
export async function loadMap() {
  await load('vendor/maplibre/intelligent-ui-maplibre.js');
  await load('intelligent-ui-map.js');
  return {script:window.YanIntelligentUiMapLibre.script+'\n'+window.YanIntelligentUiMapSource,css:window.YanIntelligentUiMapLibre.css};
}
