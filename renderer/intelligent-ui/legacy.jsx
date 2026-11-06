import React, {useEffect, useRef, useState, createContext, useContext} from 'react';
import {createRoot} from 'react-dom/client';
import {Renderer} from '@openuidev/react-lang';
import {makeLibrary} from '../../lib/intelligent-ui/legacy-library.cjs';
import {normalizeLanguage, translator} from '../../lib/intelligent-ui/i18n.cjs';

const Session=createContext(null);
const Language=createContext('zh');
const PanelTitle=createContext('');
const propsOf=node=>node.props;
const normalizeHeading=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
// The panel title already heads the block. Repeating it inside the frame is
// the most visible duplication, so the matching label is dropped.
function useHeading(label){
 const title=useContext(PanelTitle);
 return normalizeHeading(label)===normalizeHeading(title)?null:label;
}

function useRetained(id,initial,normalize,describe){
 const session=useContext(Session);
 const [value,setValue]=useState(()=>normalize(session.saved?.[id]??initial));
 const description=describe(value);
 useEffect(()=>{session.report(id,value,description);},[id,value,description,session]);
 return [value,setValue];
}

function useCopy(){
 const lang=useContext(Language);
 return {lang,t:translator(lang),locale:lang==='en'?'en-US':'zh-CN'};
}

function Choice({props:p}){
 const { t }=useCopy();
 const heading=useHeading(p.label);
 const options=p.options.map(propsOf), initial=p.initial||options[0].id;
 const [value,set]=useRetained(p.id,initial,v=>options.some(o=>o.id===v)?v:initial,v=>t('choice.summary',{label:p.label,value:options.find(o=>o.id===v).label}));
 return <section className="oi-choice">{heading&&<h4>{heading}</h4>}<div className="oi-pills">{options.map(o=><button key={o.id} aria-pressed={value===o.id} onClick={()=>set(o.id)}>{o.label}</button>)}</div><p className="oi-detail">{options.find(o=>o.id===value).detail}</p></section>;
}

function Budget({props:p}){
 const {lang,t,locale}=useCopy();
 const heading=useHeading(p.label);
 const items=p.items.map(propsOf);
 const defaults=Object.fromEntries(items.map(i=>[i.id,i.quantity]));
 const normalize=v=>Object.fromEntries(items.map(i=>[i.id,typeof v?.[i.id]==='number'&&Number.isFinite(v[i.id])?Math.max(0,Math.min(1e6,v[i.id])):i.quantity]));
 const money=v=>p.currency+' '+v.toLocaleString(locale,{maximumFractionDigits:2});
 const totalOf=v=>items.reduce((sum,i)=>sum+i.unitPrice*v[i.id],0);
 const [quantities,set]=useRetained(p.id,defaults,normalize,v=>t('budget.summary',{label:p.label,items:items.map(i=>t('budget.item',{label:i.label,quantity:v[i.id],unit:i.unit})).join(lang==='en'?', ':'、'),total:money(totalOf(v)),limit:money(p.limit)}));
 const total=totalOf(quantities);
 return <section><div className="oi-total"><div>{heading&&<small>{heading}</small>}<strong data-total>{money(total)}</strong></div><span className={total>p.limit?'oi-over':''}>{total>p.limit?t('budget.over',{amount:money(total-p.limit)}):t('budget.left',{amount:money(p.limit-total)})}</span></div><div className="oi-costs">{items.map(i=><div className="oi-cost" key={i.id}><div><b>{i.label}</b><small>{money(i.unitPrice)} / {i.unit}</small></div><label><span className="sr-only">{t('budget.quantity',{label:i.label})}</span><input aria-label={t('budget.quantity',{label:i.label})} type="number" min="0" max="1000000" step="any" value={quantities[i.id]} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))set({...quantities,[i.id]:Math.max(0,Math.min(1e6,n))});}}/><span>{i.unit}</span></label><output>{money(i.unitPrice*quantities[i.id])}</output></div>)}</div></section>;
}

function Trip({props:p}){
 const {t}=useCopy();
 const places=p.places.map(propsOf), routes=p.routes.map(propsOf), ids=places.map(i=>i.id);
 const normalize=v=>({selected:ids.includes(v?.selected)?v.selected:ids[0],kept:Array.isArray(v?.kept)?[...new Set(v.kept.filter(id=>ids.includes(id)))]:[]});
 const [value,set]=useRetained(p.id,{selected:ids[0],kept:[]},normalize,v=>t('trip.summary',{stops:v.kept.map(id=>places.find(i=>i.id===id).name).join(' → ')||t('trip.empty')}));
 const mapElement=useRef(null),map=useRef(null),[error,setError]=useState('');
 const selected=places.find(i=>i.id===value.selected);
 const [brokenPhoto,setBrokenPhoto]=useState('');
 useEffect(()=>{
  try{map.current=window.yanUi.createMap(mapElement.current,{markers:places.map(i=>({id:i.id,lat:i.lat,lng:i.lng,label:i.name})),routes,onSelect:event=>{if(ids.includes(event.id))set(v=>({...v,selected:event.id}));}});map.current.select(value.selected);map.current.fit();}
  catch{setError(t('trip.mapUnavailable'));}
  return ()=>map.current?.destroy();
 },[]);
 useEffect(()=>{map.current?.select(value.selected);},[value.selected]);
 function toggle(){set(v=>({...v,kept:v.kept.includes(v.selected)?v.kept.filter(id=>id!==v.selected):[...v.kept,v.selected]}));}
 function move(id,delta){set(v=>{const kept=[...v.kept],from=kept.indexOf(id),to=from+delta;if(to<0||to>=kept.length)return v;[kept[from],kept[to]]=[kept[to],kept[from]];return {...v,kept};});}
 return <section className="oi-trip"><div className="oi-map" ref={mapElement}/>{error&&<p role="status">{error}</p>}<div className="oi-places"><button onClick={()=>map.current?.fit()}>{t('common.overview')}</button>{places.map(i=><button key={i.id} aria-pressed={i.id===value.selected} onClick={()=>set(v=>({...v,selected:i.id}))}>{i.name}</button>)}</div><div className="oi-place">{selected.image&&brokenPhoto!==selected.image&&<img src={selected.image} alt={selected.name} referrerPolicy="no-referrer" onError={()=>setBrokenPhoto(selected.image)}/>}<div><b data-place-name>{selected.name}</b><p>{selected.detail}</p>{selected.image&&<small>{brokenPhoto===selected.image?t('trip.photoUnavailable'):selected.credit}</small>}</div><button aria-pressed={value.kept.includes(value.selected)} onClick={toggle}>{value.kept.includes(value.selected)?t('trip.remove'):t('trip.add')}</button></div>{!routes.length&&<small className="oi-detail">{t('trip.routeMissing')}</small>}<div className="oi-itinerary">{value.kept.map((id,index)=><div key={id}><span>{index+1}. {places.find(i=>i.id===id).name}</span><button className="oi-round" aria-label={t('trip.moveUp',{name:places.find(i=>i.id===id).name})} disabled={index===0} onClick={()=>move(id,-1)}>↑</button><button className="oi-round" aria-label={t('trip.moveDown',{name:places.find(i=>i.id===id).name})} disabled={index===value.kept.length-1} onClick={()=>move(id,1)}>↓</button><button className="oi-round" aria-label={t('trip.removePlace',{name:places.find(i=>i.id===id).name})} onClick={()=>set(v=>({...v,kept:v.kept.filter(k=>k!==id)}))}>×</button></div>)}</div>{routes.length>0&&<small className="oi-detail">{t('trip.reorderNote')}</small>}</section>;
}

function Table({props:p}){
 const {t}=useCopy();
 const heading=useHeading(p.label);
 return <section className="oi-table">{heading&&<h4>{heading}</h4>}{p.rows.length?<div className="oi-table-scroll"><table><caption className="sr-only">{p.label}</caption><thead><tr>{p.columns.map((column,index)=><th key={index} scope="col">{column}</th>)}</tr></thead><tbody>{p.rows.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,cellIndex)=><td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>:<p className="oi-detail">{t('table.empty')}</p>}{p.note&&<p className="oi-detail">{p.note}</p>}</section>;
}

const CHART_WIDTH=640, CHART_HEIGHT=220, CHART_PAD={left:44,right:14,top:20,bottom:38};
function Chart({props:p}){
 const {t,locale}=useCopy();
 const heading=useHeading(p.label);
 const values=p.values;
 const min=Math.min(0,...values), max=Math.max(0,...values), span=max-min||1;
 const innerWidth=CHART_WIDTH-CHART_PAD.left-CHART_PAD.right, innerHeight=CHART_HEIGHT-CHART_PAD.top-CHART_PAD.bottom;
 const x=index=>CHART_PAD.left+(values.length===1?innerWidth/2:(index+0.5)*innerWidth/values.length);
 const y=value=>CHART_PAD.top+innerHeight-((value-min)/span)*innerHeight;
 const zero=y(0);
 const format=value=>value.toLocaleString(locale,{maximumFractionDigits:2});
 const summary=p.labels.map((label,index)=>t('chart.point',{label,value:format(values[index]),unit:p.unit})).join(locale==='en-US'?', ':'，');
 const ticks=[0,0.5,1].map(fraction=>min+span*fraction);
 return <figure className="oi-chart">{heading&&<figcaption>{heading}</figcaption>}<svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={t('chart.summary',{label:p.label,values:summary})}>
  {ticks.map((tick,index)=><g key={index}><line className="oi-chart-grid" x1={CHART_PAD.left} x2={CHART_WIDTH-CHART_PAD.right} y1={y(tick)} y2={y(tick)}/><text className="oi-chart-axis" x={CHART_PAD.left-8} y={y(tick)+4} textAnchor="end">{format(tick)}</text></g>)}
  {p.kind==='bar'?values.map((value,index)=>{const top=Math.min(y(value),zero),height=Math.max(1,Math.abs(zero-y(value))),barWidth=Math.min(44,innerWidth/values.length*0.56);return <g key={index}><rect className="oi-chart-bar" x={x(index)-barWidth/2} y={top} width={barWidth} height={height} rx="4"><title>{t('chart.point',{label:p.labels[index],value:format(value),unit:p.unit})}</title></rect><text className="oi-chart-value" x={x(index)} y={value>=0?y(value)-6:y(value)+14} textAnchor="middle">{format(value)}</text></g>;}):<g><polyline className="oi-chart-line" points={values.map((value,index)=>`${x(index)},${y(value)}`).join(' ')}/>{values.map((value,index)=><circle key={index} className="oi-chart-dot" cx={x(index)} cy={y(value)} r="4"><title>{t('chart.point',{label:p.labels[index],value:format(value),unit:p.unit})}</title></circle>)}</g>}
  {p.labels.map((label,index)=><text key={index} className="oi-chart-label" x={x(index)} y={CHART_HEIGHT-CHART_PAD.bottom+18} textAnchor="middle">{label}</text>)}
 </svg>{p.note&&<p className="oi-detail">{p.note}</p>}</figure>;
}

function Form({props:p}){
 const { lang, t }=useCopy();
 const heading=useHeading(p.label);
 const fields=p.fields.map(propsOf);
 const defaults=Object.fromEntries(fields.map(field=>[field.id,field.initial||'']));
 const normalize=value=>Object.fromEntries(fields.map(field=>{
  let next=typeof value?.[field.id]==='string'?value[field.id]:field.initial||'';
  if(field.type==='select')next=field.options.includes(next)?next:'';
  return [field.id,next.slice(0,2000)];
 }));
 const [values,set]=useRetained(p.id,defaults,normalize,value=>{
  const pairs=fields.filter(field=>value[field.id]).map(field=>t('form.pair',{label:field.label,value:value[field.id]}));
  return t('form.summary',{label:p.label,values:pairs.join(lang==='en'?', ':'、')||t('form.empty')});
 });
 const filled=fields.filter(field=>values[field.id]!=='').length;
 const invalid=fields.some(field=>field.type==='number'&&values[field.id]!==''&&!Number.isFinite(Number(values[field.id])));
 const setField=(field,value)=>set({...values,[field.id]:value.slice(0,2000)});
 return <section className="oi-form"><div className="oi-form-head">{heading&&<h4>{heading}</h4>}<small>{t('form.progress',{filled,total:fields.length})}</small></div><div className="oi-fields">{fields.map(field=>{
  const value=values[field.id], fieldId=`${p.id}-${field.id}`, numberInvalid=field.type==='number'&&value!==''&&!Number.isFinite(Number(value));
  return <label key={field.id} className={'oi-field'+(field.type==='textarea'?' oi-field-wide':'')} htmlFor={fieldId}><span>{field.label}{field.required&&<em className="oi-required" title={t('form.required')} aria-label={t('form.required')}>*</em>}{field.unit&&<small> ({field.unit})</small>}</span>
   {field.type==='textarea'?<textarea id={fieldId} rows={2} placeholder={field.placeholder} value={value} aria-required={field.required||undefined} onChange={event=>setField(field,event.target.value)}/>
   :field.type==='select'?<select id={fieldId} value={value} aria-required={field.required||undefined} onChange={event=>setField(field,event.target.value)}><option value="">{t('form.selectPlaceholder')}</option>{field.options.map(option=><option key={option} value={option}>{option}</option>)}</select>
   :<input id={fieldId} type={field.type==='number'?'number':'text'} inputMode={field.type==='number'?'decimal':undefined} placeholder={field.placeholder} value={value} aria-required={field.required||undefined} aria-invalid={numberInvalid||undefined} onChange={event=>setField(field,event.target.value)}/>}
  </label>;
 })}</div>{invalid&&<p className="oi-error" role="status">{t('form.invalidNumber')}</p>}</section>;
}

function Stack({props:p,renderNode}){
 return <div className={'oi-stack oi-stack-'+p.direction}>{renderNode(p.children)}</div>;
}

const library=makeLibrary({App:({props,renderNode})=><main className="oi-app">{renderNode(props.children)}</main>,Note:({props})=><p className="oi-note">{props.text}</p>,Choice,Budget,Trip,Table,Chart,Form,Stack});

const css=`*{box-sizing:border-box}
.oi-app{width:100%;max-width:100%;min-width:0;margin:auto;font:13px/1.5 system-ui;color:var(--ui-text)}
.oi-app h4{font-size:13px;font-weight:600;margin:0 0 8px}
.oi-app section+section{margin-top:18px}
.oi-app section+figure,.oi-app figure+section{margin-top:18px}
.oi-app button{border-radius:999px;min-height:32px;padding:5px 12px;border:1px solid var(--ui-border);background:transparent;color:inherit;cursor:pointer}
.oi-app button[aria-pressed=true]{background:var(--ui-text);color:var(--ui-bg);border-color:var(--ui-text)}
.oi-app button:disabled{opacity:.35;cursor:default}
.oi-pills,.oi-places{display:flex;gap:6px;flex-wrap:wrap}
.oi-detail,.oi-note,.oi-app small{color:var(--ui-muted);font-size:12px}
.oi-detail{margin:8px 0}.oi-note{margin:4px 0 12px}
.oi-total{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:8px 0 14px}
.oi-total strong{display:block;font-size:28px;font-weight:550;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.oi-cost{display:grid;grid-template-columns:minmax(0,1fr) 100px 100px;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--ui-border)}
.oi-cost b{font-weight:500}.oi-cost small{display:block}
.oi-cost label{display:flex;align-items:center;gap:4px}
.oi-cost input{width:66px;border-radius:999px!important;padding:4px 8px!important;font:inherit}
.oi-cost output{text-align:right;font-variant-numeric:tabular-nums}
.oi-over{color:light-dark(#b42318,#ff9b8d)}
.oi-map{--yan-map-height:240px}
.oi-places{margin:10px 0}
.oi-place{display:flex;align-items:center;gap:12px}
.oi-place>div{flex:1;min-width:0}
.oi-place img{width:96px;height:70px;object-fit:cover;border-radius:12px}
.oi-place p{margin:3px 0;font-size:12px}.oi-place small{font-size:10px}.oi-place button{flex-shrink:0}
.oi-itinerary{max-height:135px;overflow:auto;margin-top:8px}
.oi-itinerary>div{display:flex;gap:5px;align-items:center;padding:4px 0}
.oi-itinerary span{flex:1}.oi-app .oi-round{width:30px;height:30px;padding:0;border-radius:50%}
.oi-table h4{margin-bottom:6px}
.oi-table-scroll{overflow-x:auto}
.oi-table table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.oi-table th,.oi-table td{padding:8px 10px 8px 0;text-align:left;border-bottom:1px solid var(--ui-border);vertical-align:top}
.oi-table th{font-weight:600;color:var(--ui-muted);font-size:12px;white-space:nowrap}
.oi-chart{margin:0}
.oi-chart figcaption{font-size:13px;font-weight:600;margin:0 0 6px}
.oi-chart svg{display:block;width:100%;height:auto;overflow:visible}
.oi-chart-grid{stroke:var(--ui-border);stroke-width:1;opacity:.65}
.oi-chart-axis,.oi-chart-label{fill:var(--ui-muted);font-size:11px;font-variant-numeric:tabular-nums}
.oi-chart-value{fill:var(--ui-text);font-size:11px;font-variant-numeric:tabular-nums}
.oi-chart-bar{fill:var(--ui-accent);opacity:.85}
.oi-chart-line{fill:none;stroke:var(--ui-accent);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.oi-chart-dot{fill:var(--ui-bg);stroke:var(--ui-accent);stroke-width:2.5}
.oi-form-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}
.oi-form-head h4{margin:0}.oi-form-head small{margin-left:auto}
.oi-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 14px}
.oi-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px}
.oi-field>span{color:var(--ui-muted)}
.oi-field-wide{grid-column:1/-1}
.oi-field input,.oi-field select,.oi-field textarea{width:100%;min-width:0;border:1px solid var(--ui-border);border-radius:8px;padding:6px 8px;background:transparent;color:inherit;font:inherit}
.oi-field textarea{resize:vertical;min-height:56px}
.oi-field input[aria-invalid=true]{border-color:light-dark(#b42318,#ff9b8d)}
.oi-required{color:light-dark(#b42318,#ff9b8d);font-style:normal;margin-left:3px}
.oi-error{color:light-dark(#b42318,#ff9b8d);font-size:12px;margin:8px 0 0}
.oi-stack{min-width:0}
.oi-stack-row{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.oi-stack-row>*{flex:1 1 260px;min-width:0}
.oi-stack-row>section+section{margin-top:0}
.oi-stack-row>section+figure,.oi-stack-row>figure+section{margin-top:0}
.oi-stack-column>section+section{margin-top:18px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:420px){.oi-cost{grid-template-columns:minmax(0,1fr) 90px}.oi-cost output{display:none}.oi-stack-row{gap:12px}.oi-stack-row>*{flex-basis:100%}}`;

export function mountLegacy(code,lang,title){
 const language=normalizeLanguage(lang);
 const t=translator(language);
 const style=document.createElement('style');style.textContent=css;document.head.append(style);
 const root=document.createElement('div');document.body.append(root);
 const saved=window.yanUi.getState(), state=Object.create(null), summaries=Object.create(null);
 const notice=document.createElement('div');notice.className='oi-save';document.body.append(notice);
 let timer,saveSequence=0;
 const session={saved:saved?.version===1?saved.values:{},report(id,value,summary){state[id]=value;summaries[id]=summary;clearTimeout(timer);timer=setTimeout(async()=>{const sequence=++saveSequence;parent.postMessage({type:'summary',text:Object.values(summaries).join('\n').slice(0,8000)},'*');try{const ok=await window.yanUi.setState({version:1,values:state});if(sequence===saveSequence){notice.textContent=ok?'':t('save.unavailable');notice.dataset.saved=String(ok);}}catch{if(sequence===saveSequence){notice.textContent=t('save.unavailable');notice.dataset.saved='false';}}},100);}};
 createRoot(root).render(<Language.Provider value={language}><PanelTitle.Provider value={typeof title==='string'?title:''}><Session.Provider value={session}><Renderer response={code} library={library} toolProvider={null} publishObservability={false} onError={errors=>{if(errors?.length)parent.postMessage({type:'error'},'*');}}/></Session.Provider></PanelTitle.Provider></Language.Provider>);
}

