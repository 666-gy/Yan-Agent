(function () {
  'use strict';

  // This function is serialized into the generated, opaque-origin panel.
  // Keep every dependency inside it; MapLibre is installed by the host first.
  function installYanMap() {
    const STYLE_ID = 'yan-mini-map-styles';
    const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

    function coordinate(value) {
      if (!Array.isArray(value) || value.length !== 2
        || !value.every(Number.isFinite)
        || Math.abs(value[0]) > 85 || Math.abs(value[1]) > 180) {
        throw new TypeError('Map coordinates must be [latitude, longitude], within ±85 and ±180.');
      }
      return value.slice();
    }

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .yan-mini-map{position:relative;width:100%;height:var(--yan-map-height,260px);min-height:180px;overflow:hidden;border-radius:16px;background:#e5ece7;color:#22362b;isolation:isolate;font:12px/1.4 system-ui,sans-serif}
        .yan-mini-map .yan-map-canvas{position:absolute;inset:0;background:#e5ece7}
        .yan-mini-map .yan-map-zoom{position:absolute;top:10px;right:10px;z-index:3;display:grid;gap:6px}
        .yan-mini-map .yan-map-zoom button{display:grid;place-items:center;width:34px;height:34px;min-height:34px;line-height:1;border:0;padding:0;border-radius:50%;background:#fff;color:#25342a;box-shadow:0 1px 5px #172b232b;font:22px/1 system-ui,sans-serif}
        .yan-mini-map .yan-map-zoom button:hover{background:#f2f6f3}
        .yan-mini-map .yan-map-zoom button:disabled{color:#aaa}
        .yan-mini-map .yan-map-attribution{position:absolute;bottom:0;right:0;z-index:3;max-width:100%;padding:1px 5px;background:#ffffffe6;color:#405148;font-size:10px;line-height:1.4}
        .yan-mini-map .yan-map-attribution a{color:#31594a}
        .yan-mini-map .yan-map-marker-icon{width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:50%;background:none;cursor:pointer}
        .yan-mini-map .yan-map-marker-icon>span{display:grid;place-items:center;width:28px;height:28px;border:2px solid white;border-radius:50%;background:#2767bb;color:white;font-size:12px;font-weight:650;box-shadow:0 1px 5px #102c4350;transition:transform .12s}
        .yan-mini-map .yan-map-marker-icon[aria-pressed=true]>span{background:#153c70;transform:scale(1.17);outline:3px solid #ffffff90}
        .yan-mini-map .yan-map-marker-icon:focus-visible{outline:2px solid #1b406f;outline-offset:5px;border-radius:50%}
        .yan-mini-map .yan-map-popup .maplibregl-popup-content{width:max-content;max-width:200px;white-space:normal;overflow-wrap:normal;padding:5px 9px;border:0;border-radius:10px;background:#fff;color:#22362b;box-shadow:0 1px 6px #102c432b;font:12px/1.4 system-ui,sans-serif}
        .yan-mini-map .yan-map-popup,.yan-mini-map .yan-map-popup .maplibregl-popup-content{pointer-events:none}
        .yan-mini-map .yan-map-status{position:absolute;left:8px;bottom:22px;z-index:4;max-width:calc(100% - 16px);padding:4px 9px;border-radius:999px;background:#fffffff0;color:#665020;font-size:11px;pointer-events:none}
        .yan-mini-map .yan-map-status[hidden]{display:none}
        @media(prefers-reduced-motion:reduce){.yan-mini-map .yan-map-marker-icon>span{transition:none}}
      `;
      document.head.append(style);
    }

    function createMap(element, options = {}) {
      if (!(element instanceof Element)) throw new TypeError('createMap requires a container element.');
      if (!window.maplibregl?.Map) throw new Error('Map support is unavailable.');
      if (!options || typeof options !== 'object') throw new TypeError('Map options must be an object.');
      const M = window.maplibregl;
      const markerInput = options.markers ?? [];
      const routeInput = options.routes ?? [];
      if (!Array.isArray(markerInput) || markerInput.length > 100
        || !Array.isArray(routeInput) || routeInput.length > 20) {
        throw new RangeError('A map supports at most 100 markers and 20 routes.');
      }
      const ids = new Set();
      const identity = (item, fallback) => {
        const id = String(item.id ?? fallback);
        if (!id || id.length > 160 || ids.has(id)) throw new TypeError('Map marker and route ids must be unique, nonempty strings.');
        ids.add(id);
        return id;
      };
      const markers = markerInput.map((item, index) => {
        if (!item || typeof item !== 'object') throw new TypeError('Invalid map marker.');
        return {
          id: identity(item, 'marker-' + index),
          point: coordinate([item.lat, item.lng]),
          label: String(item.label ?? ('地点 ' + (index + 1))).slice(0, 300)
        };
      });
      let totalPoints = 0;
      const routes = routeInput.map((item, index) => {
        if (!item || !Array.isArray(item.coordinates) || item.coordinates.length < 2) {
          throw new TypeError('A route requires at least two verified coordinates.');
        }
        totalPoints += item.coordinates.length;
        if (totalPoints > 2000) throw new RangeError('Map routes support at most 2000 coordinates in total.');
        return {
          id: identity(item, 'route-' + index),
          points: item.coordinates.map(coordinate),
          label: String(item.label ?? ('路线 ' + (index + 1))).slice(0, 300),
          color: typeof item.color === 'string' && item.color.length <= 64 && CSS.supports('color', item.color) && !/var\(|currentcolor/i.test(item.color) ? item.color : '#2767bb',
          dashed: item.dashed === true
        };
      });
      const center = options.center === undefined ? null : coordinate(options.center);
      const zoom = options.zoom === undefined ? 13 : options.zoom;
      if (!Number.isFinite(zoom) || zoom < 1 || zoom > 19) throw new RangeError('Map zoom must be between 1 and 19.');

      installStyles();
      const view = document.createElement('div');
      view.className = 'yan-mini-map';
      const canvas = document.createElement('div');
      canvas.className = 'yan-map-canvas';
      canvas.setAttribute('role', 'region');
      canvas.setAttribute('aria-label', '地点与路线地图');
      const status = document.createElement('div');
      status.className = 'yan-map-status';
      status.setAttribute('role', 'status');
      status.textContent = '底图加载中…';
      status.dataset.state = 'loading';
      view.append(canvas, status);
      element.append(view);

      const lngLat = point => [point[1], point[0]];
      const map = new M.Map({
        container: canvas, style: MAP_STYLE,
        center: center ? lngLat(center) : [0, 0], zoom: center ? zoom : 2,
        attributionControl: false, scrollZoom: false, dragRotate: false,
        pitchWithRotate: false, minZoom: 1, maxZoom: 19, fadeDuration: 0
      });
      map.touchZoomRotate.disableRotation();
      const zoomControls = document.createElement('div');
      zoomControls.className = 'yan-map-zoom';
      const zoomButton = (label, text, direction) => {
        const button = document.createElement('button');
        button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
        button.textContent = text;
        button.addEventListener('click', () => map.zoomTo(map.getZoom() + direction, { duration: 0 }));
        zoomControls.append(button);
        return button;
      };
      const zoomIn = zoomButton('放大', '+', 1);
      const zoomOut = zoomButton('缩小', '−', -1);
      const updateZoom = () => { zoomIn.disabled = map.getZoom() >= 19; zoomOut.disabled = map.getZoom() <= 1; };
      map.on('zoom', updateZoom); updateZoom();
      const attribution = document.createElement('div');
      attribution.className = 'yan-map-attribution';
      for (const [name, href] of [['© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'], ['OpenMapTiles', 'https://openmaptiles.org/'], ['OpenFreeMap', 'https://openfreemap.org/']]) {
        if (attribution.childNodes.length) attribution.append(' · ');
        const link = document.createElement('a');
        link.textContent = name; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        attribution.append(link);
      }
      view.append(zoomControls, attribution);

      const entries = new Map();
      const bounds = new M.LngLatBounds();
      let selected = null;
      let destroyed = false;
      let loaded = false;
      let loadError = false;
      const popup = new M.Popup({ closeButton: false, closeOnClick: false, offset: 20, className: 'yan-map-popup', maxWidth: '200px' });
      const labelNode = text => {
        const node = document.createElement('span');
        node.textContent = text;
        return node;
      };
      const paintSelection = () => {
        for (const [id, entry] of entries) {
          const active = selected === id;
          if (entry.type === 'marker') {
            entry.button.setAttribute('aria-pressed', String(active));
          } else if (loaded && map.getLayer(entry.layerId)) {
            map.setPaintProperty(entry.layerId, 'line-width', active ? 7 : 4);
            map.setPaintProperty(entry.layerId, 'line-opacity', active ? 1 : .72);
            if (active) map.moveLayer(entry.layerId);
          }
        }
      };
      const select = id => {
        if (destroyed) return false;
        if (id === null || id === undefined) {
          selected = null;
          delete view.dataset.selection;
          delete view.dataset.selectionType;
          paintSelection();
          popup.remove();
          return true;
        }
        const key = String(id);
        const entry = entries.get(key);
        if (!entry) return false;
        if (selected === key) return true;
        selected = key;
        view.dataset.selection = key;
        view.dataset.selectionType = entry.type;
        paintSelection();
        if (entry.type === 'marker') map.jumpTo({ center: entry.point });
        else map.fitBounds(entry.bounds, { padding: 28, maxZoom: 15, duration: 0 });
        popup.setLngLat(entry.point).setDOMContent(labelNode(entry.label)).addTo(map);
        if (typeof options.onSelect === 'function') options.onSelect({ type: entry.type, id: key });
        return true;
      };

      routes.forEach((route, index) => {
        const points = route.points.map(lngLat);
        const routeBounds = new M.LngLatBounds();
        points.forEach(point => { routeBounds.extend(point); bounds.extend(point); });
        entries.set(route.id, { type: 'route', layerId: 'yan-ui-route-' + index, sourceId: 'yan-ui-route-source-' + index,
          points, bounds: routeBounds, point: points[Math.floor(points.length / 2)], label: route.label, color: route.color, dashed: route.dashed });
      });
      markers.forEach((marker, index) => {
        const dot = labelNode(String(index + 1));
        dot.setAttribute('aria-hidden', 'true');
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'yan-map-marker-icon'; button.title = marker.label;
        button.setAttribute('aria-label', marker.label); button.setAttribute('aria-pressed', 'false'); button.append(dot);
        const point = lngLat(marker.point);
        const layer = new M.Marker({ element: button, anchor: 'center' }).setLngLat(point).addTo(map);
        button.addEventListener('click', event => { event.stopPropagation(); select(marker.id); });
        entries.set(marker.id, { type: 'marker', layer, button, point, label: marker.label });
        bounds.extend(point);
      });
      const fit = () => {
        if (destroyed) return false;
        map.resize();
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 28, maxZoom: 15, duration: 0 });
        return !bounds.isEmpty();
      };
      if (!center) fit();
      map.on('error', () => {
        loadError = true;
        status.hidden = false; status.dataset.state = 'error'; status.textContent = loaded ? '部分底图未加载' : '底图暂不可用';
      });
      map.on('load', () => {
        if (destroyed) return;
        loaded = true;
        for (const [id, entry] of entries) {
          if (entry.type !== 'route') continue;
          map.addSource(entry.sourceId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: entry.points } } });
          const paint = { 'line-color': entry.color, 'line-width': 4, 'line-opacity': .72 };
          if (entry.dashed) paint['line-dasharray'] = [2, 2];
          map.addLayer({ id: entry.layerId, type: 'line', source: entry.sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint });
          map.on('click', entry.layerId, () => select(id));
          map.on('mouseenter', entry.layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', entry.layerId, () => { map.getCanvas().style.cursor = ''; });
        }
        paintSelection();
        if (!loadError) { status.hidden = true; status.dataset.state = 'ready'; }
        view.dataset.loaded = 'true';
      });

      const resize = new ResizeObserver(() => {
        if (!destroyed) map.resize();
      });
      resize.observe(view);

      return Object.freeze({
        select,
        fit,
        destroy: () => {
          if (destroyed) return;
          destroyed = true;
          resize.disconnect();
          popup.remove();
          for (const entry of entries.values()) if (entry.type === 'marker') entry.layer.remove();
          map.remove();
          view.remove();
          entries.clear();
        }
      });
    }

    Object.defineProperty(window, 'YanMapRuntime', {
      value: Object.freeze({ createMap }), writable: false, configurable: false
    });
  }

  window.YanIntelligentUiMapSource = '(' + installYanMap.toString() + ')();';
})();
