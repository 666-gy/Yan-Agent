import React, {useEffect, useRef, useState} from 'react';
import {useStateField} from '@openuidev/react-lang';
import {translator} from '../../lib/intelligent-ui/i18n.cjs';

export function MapView({props:p}) {
  const t = translator(document.documentElement.lang);
  const field = useStateField(p.name);
  const ids = new Set(p.places.map(place => place.id));
  const value = field.value;
  const selectedId = ids.has(value?.selected) ? value.selected : p.places[0].id;
  const kept = Array.isArray(value?.kept) ? [...new Set(value.kept.filter(id => ids.has(id)))] : [];
  const selected = p.places.find(place => place.id === selectedId);
  const element = useRef(null), map = useRef(null);
  const [error,setError] = useState('');
  const [broken,setBroken] = useState('');
  const choose = id => field.setValue({selected:id,kept});
  const current = useRef({choose}); current.current = {choose};
  useEffect(() => {
    try {
      map.current = window.yanUi.createMap(element.current, {
        markers:p.places.map(place => ({...place,label:place.name})), routes:p.routes,
        onSelect:event => {if (ids.has(event.id)) current.current.choose(event.id);}
      });
      map.current.select(selectedId); map.current.fit();
    } catch {setError(t('trip.mapUnavailable'));}
    return () => map.current?.destroy();
  }, []);
  useEffect(() => {map.current?.select(selectedId);}, [selectedId]);
  const keep = next => field.setValue({selected:selectedId,kept:next});
  const move = (id,delta) => {const next=[...kept], from=next.indexOf(id),to=from+delta; if(to<0||to>=next.length)return; [next[from],next[to]]=[next[to],next[from]];keep(next);};
  return <section className="yan-ui-map">
    <div className="yan-ui-map-canvas" ref={element}/>
    {error && <p role="status">{error}</p>}
    <nav aria-label={p.name}><button onClick={() => map.current?.fit()}>{t('common.overview')}</button>{p.places.map(place => <button key={place.id} aria-pressed={place.id===selectedId} onClick={() => choose(place.id)}>{place.name}</button>)}</nav>
    <div className="yan-ui-place">
      {selected.image && broken!==selected.image && <img src={selected.image} alt={selected.name} referrerPolicy="no-referrer" onError={() => setBroken(selected.image)}/>}
      <div><strong>{selected.name}</strong><p>{selected.detail}</p>{selected.image && <small>{broken===selected.image?t('trip.photoUnavailable'):selected.credit}</small>}</div>
      <button aria-pressed={kept.includes(selectedId)} onClick={() => keep(kept.includes(selectedId)?kept.filter(id=>id!==selectedId):[...kept,selectedId])}>{t(kept.includes(selectedId)?'trip.remove':'trip.add')}</button>
    </div>
    <ol className="yan-ui-itinerary">{kept.map((id,index) => {const place=p.places.find(place=>place.id===id);return <li key={id}><span>{place.name}</span><button aria-label={t('trip.moveUp',{name:place.name})} disabled={!index} onClick={()=>move(id,-1)}>↑</button><button aria-label={t('trip.moveDown',{name:place.name})} disabled={index===kept.length-1} onClick={()=>move(id,1)}>↓</button><button aria-label={t('trip.removePlace',{name:place.name})} onClick={()=>keep(kept.filter(item=>item!==id))}>×</button></li>;})}</ol>
    <small>{t(p.routes.length?'trip.reorderNote':'trip.routeMissing')}</small>
  </section>;
}
