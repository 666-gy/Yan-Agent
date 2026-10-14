import React, {useEffect, useRef, useState, createContext, useContext} from 'react';
import {createRoot} from 'react-dom/client';
import {Renderer} from '@openuidev/react-lang';
import {makeLibrary} from '../lib/intelligent-ui/openui-library.cjs';
const Session=createContext(null);
const propsOf=node=>node.props;
function useRetained(id,initial,normalize,describe){
 const session=useContext(Session);
 const [value,setValue]=useState(()=>normalize(session.saved?.[id]??initial));
 const description=describe(value);
 useEffect(()=>{session.report(id,value,description);},[id,value,description,session]);
 return [value,setValue];
}
function Choice({props:p}){
 const options=p.options.map(propsOf), initial=p.initial||options[0].id;
 const [value,set]=useRetained(p.id,initial,v=>options.some(o=>o.id===v)?v:initial,v=>p.label+'：'+options.find(o=>o.id===v).label);
 return <section className="oi-choice"><h4>{p.label}</h4><div className="oi-pills">{options.map(o=><button key={o.id} aria-pressed={value===o.id} onClick={()=>set(o.id)}>{o.label}</button>)}</div><p className="oi-detail">{options.find(o=>o.id===value).detail}</p></section>;
}
function Budget({props:p}){
 const items=p.items.map(propsOf);
 const defaults=Object.fromEntries(items.map(i=>[i.id,i.quantity]));
 const normalize=v=>Object.fromEntries(items.map(i=>[i.id,typeof v?.[i.id]==='number'&&Number.isFinite(v[i.id])?Math.max(0,Math.min(1e6,v[i.id])):i.quantity]));
 const money=v=>p.currency+' '+v.toLocaleString('zh-CN',{maximumFractionDigits:2});
 const totalOf=v=>items.reduce((sum,i)=>sum+i.unitPrice*v[i.id],0);
 const [quantities,set]=useRetained(p.id,defaults,normalize,v=>p.label+'：'+items.map(i=>i.label+' '+v[i.id]+i.unit).join('、')+'；合计 '+money(totalOf(v))+'；预算 '+money(p.limit));
 const total=totalOf(quantities);
 return <section><div className="oi-total"><div><small>{p.label}</small><strong data-total>{money(total)}</strong></div><span className={total>p.limit?'oi-over':''}>{total>p.limit?'超出 ':'剩余 '}{money(Math.abs(p.limit-total))}</span></div><div className="oi-costs">{items.map(i=><div className="oi-cost" key={i.id}><div><b>{i.label}</b><small>{money(i.unitPrice)} / {i.unit}</small></div><label><span className="sr-only">{i.label}数量</span><input aria-label={i.label+'数量'} type="number" min="0" max="1000000" step="any" value={quantities[i.id]} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))set({...quantities,[i.id]:Math.max(0,Math.min(1e6,n))});}}/><span>{i.unit}</span></label><output>{money(i.unitPrice*quantities[i.id])}</output></div>)}</div></section>;
}
function Trip({props:p}){
 const places=p.places.map(propsOf), routes=p.routes.map(propsOf), ids=places.map(i=>i.id);
 const normalize=v=>({selected:ids.includes(v?.selected)?v.selected:ids[0],kept:Array.isArray(v?.kept)?[...new Set(v.kept.filter(id=>ids.includes(id)))]:[]});
 const [value,set]=useRetained(p.id,{selected:ids[0],kept:[]},normalize,v=>'行程：'+(v.kept.map(id=>places.find(i=>i.id===id).name).join(' → ')||'尚未保留地点'));
 const mapElement=useRef(null),map=useRef(null),[error,setError]=useState('');
 const selected=places.find(i=>i.id===value.selected);
 const [brokenPhoto,setBrokenPhoto]=useState('');
 useEffect(()=>{
  try{map.current=window.yanUi.createMap(mapElement.current,{markers:places.map(i=>({id:i.id,lat:i.lat,lng:i.lng,label:i.name})),routes,onSelect:event=>{if(ids.includes(event.id))set(v=>({...v,selected:event.id}));}});map.current.select(value.selected);map.current.fit();}
  catch{setError('地图暂不可用，仍可保留地点。');}
  return ()=>map.current?.destroy();
 },[]);
 useEffect(()=>{map.current?.select(value.selected);},[value.selected]);
 function toggle(){set(v=>({...v,kept:v.kept.includes(v.selected)?v.kept.filter(id=>id!==v.selected):[...v.kept,v.selected]}));}
 function move(id,delta){set(v=>{const kept=[...v.kept],from=kept.indexOf(id),to=from+delta;if(to<0||to>=kept.length)return v;[kept[from],kept[to]]=[kept[to],kept[from]];return {...v,kept};});}
 return <section className="oi-trip"><div className="oi-map" ref={mapElement}/>{error&&<p role="status">{error}</p>}<div className="oi-places"><button onClick={()=>map.current?.fit()}>总览</button>{places.map(i=><button key={i.id} aria-pressed={i.id===value.selected} onClick={()=>set(v=>({...v,selected:i.id}))}>{i.name}</button>)}</div><div className="oi-place">{selected.image&&brokenPhoto!==selected.image&&<img src={selected.image} alt={selected.name} referrerPolicy="no-referrer" onError={()=>setBrokenPhoto(selected.image)}/>}<div><b data-place-name>{selected.name}</b><p>{selected.detail}</p>{selected.image&&<small>{brokenPhoto===selected.image?'照片暂不可用':selected.credit}</small>}</div><button aria-pressed={value.kept.includes(value.selected)} onClick={toggle}>{value.kept.includes(value.selected)?'移出行程':'加入行程'}</button></div>{!routes.length&&<small className="oi-detail">仅展示地点，未计算道路路线。</small>}<div className="oi-itinerary">{value.kept.map((id,index)=><div key={id}><span>{index+1}. {places.find(i=>i.id===id).name}</span><button className="oi-round" aria-label={'上移'+places.find(i=>i.id===id).name} disabled={index===0} onClick={()=>move(id,-1)}>↑</button><button className="oi-round" aria-label={'下移'+places.find(i=>i.id===id).name} disabled={index===value.kept.length-1} onClick={()=>move(id,1)}>↓</button><button className="oi-round" aria-label={'移除'+places.find(i=>i.id===id).name} onClick={()=>set(v=>({...v,kept:v.kept.filter(k=>k!==id)}))}>×</button></div>)}</div>{routes.length>0&&<small className="oi-detail">调整地点顺序不会重算道路路线。</small>}</section>;
}
const library=makeLibrary({App:({props,renderNode})=><main className="oi-app">{renderNode(props.children)}</main>,Note:({props})=><p className="oi-note">{props.text}</p>,Choice,Budget,Trip});
const css='*{box-sizing:border-box}.oi-app{width:100%;max-width:100%;min-width:0;margin:auto;font:13px/1.5 system-ui;color:var(--ui-text)}.oi-app h4{font-size:13px;font-weight:600;margin:0 0 8px}.oi-app section+section{margin-top:18px}.oi-app button{border-radius:999px;min-height:32px;padding:5px 12px;border:1px solid var(--ui-border);background:transparent;color:inherit;cursor:pointer}.oi-app button[aria-pressed=true]{background:var(--ui-text);color:var(--ui-bg);border-color:var(--ui-text)}.oi-app button:disabled{opacity:.35;cursor:default}.oi-pills,.oi-places{display:flex;gap:6px;flex-wrap:wrap}.oi-detail,.oi-note,.oi-app small{color:var(--ui-muted);font-size:12px}.oi-detail{margin:8px 0}.oi-note{margin:4px 0 12px}.oi-total{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:8px 0 14px}.oi-total strong{display:block;font-size:28px;font-weight:550;letter-spacing:-1px;font-variant-numeric:tabular-nums}.oi-cost{display:grid;grid-template-columns:minmax(0,1fr) 100px 100px;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--ui-border)}.oi-cost b{font-weight:500}.oi-cost small{display:block}.oi-cost label{display:flex;align-items:center;gap:4px}.oi-cost input{width:66px;border-radius:999px!important;padding:4px 8px!important;font:inherit}.oi-cost output{text-align:right;font-variant-numeric:tabular-nums}.oi-over{color:light-dark(#b42318,#ff9b8d)}.oi-map{--yan-map-height:240px}.oi-places{margin:10px 0}.oi-place{display:flex;align-items:center;gap:12px}.oi-place>div{flex:1;min-width:0}.oi-place img{width:96px;height:70px;object-fit:cover;border-radius:12px}.oi-place p{margin:3px 0;font-size:12px}.oi-place small{font-size:10px}.oi-place button{flex-shrink:0}.oi-itinerary{max-height:135px;overflow:auto;margin-top:8px}.oi-itinerary>div{display:flex;gap:5px;align-items:center;padding:4px 0}.oi-itinerary span{flex:1}.oi-app .oi-round{width:30px;height:30px;padding:0;border-radius:50%}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.oi-save{font:11px system-ui;color:var(--ui-muted);margin-top:5px}.oi-save:empty{display:none}@media(max-width:420px){.oi-cost{grid-template-columns:minmax(0,1fr) 84px 78px;gap:6px}.oi-place{flex-wrap:wrap}.oi-place img{width:72px;height:60px}.oi-map{--yan-map-height:220px}}';
function mount(code){
 const style=document.createElement('style');style.textContent=css;document.head.append(style);
 const root=document.createElement('div');document.body.append(root);
 const saved=window.yanUi.getState(), state=Object.create(null), summaries=Object.create(null);
 const notice=document.createElement('div');notice.className='oi-save';document.body.append(notice);
 let timer,saveSequence=0;
 const session={saved:saved?.version===1?saved.values:{},report(id,value,summary){state[id]=value;summaries[id]=summary;clearTimeout(timer);timer=setTimeout(async()=>{const sequence=++saveSequence;parent.postMessage({type:'summary',text:Object.values(summaries).join('\n').slice(0,8000)},'*');try{const ok=await window.yanUi.setState({version:1,values:state});if(sequence===saveSequence){notice.textContent=ok?'':'本地保存暂不可用';notice.dataset.saved=String(ok);}}catch{if(sequence===saveSequence){notice.textContent='本地保存暂不可用';notice.dataset.saved='false';}}},100);}};
 createRoot(root).render(<Session.Provider value={session}><Renderer response={code} library={library} toolProvider={null} publishObservability={false} onError={errors=>{if(errors?.length)parent.postMessage({type:'error'},'*');}}/></Session.Provider>);
}
window.YanOpenUi={mount};
