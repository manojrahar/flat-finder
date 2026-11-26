import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const COLORS = { match: '#ffd9a0', likely: '#c99a5c', probable: '#9a8463', unknown: '#55545c', no: '#1b1b1e' };
export const OVERVIEW = { center: [75.79, 26.885], zoom: 12.0, pitch: 50, bearing: 0 };

const stateColor = (fallback) => ['case',
  ['boolean', ['feature-state', 'sel'], false], '#ffffff',
  ['match', ['feature-state', 'st'], 'match', COLORS.match, 'likely', COLORS.likely, 'probable', COLORS.probable, 'unknown', COLORS.unknown, 'no', COLORS.no, fallback]];

const ESRI_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services';

export function createMap(container, { mobile, mode = 'light' }) {
  const map = new maplibregl.Map({
    container,
    attributionControl: { compact: true },
    center: OVERVIEW.center,
    zoom: mobile ? Math.min(11.6, OVERVIEW.zoom) : OVERVIEW.zoom,
    pitch: mobile ? 45 : OVERVIEW.pitch,
    bearing: 0,
    maxPitch: 70,
    dragRotate: false,      // north stays up, like Google Maps
    pitchWithRotate: false,
    touchPitch: false,
    style: {
      version: 8,
      glyphs: typeof location !== 'undefined' ? `${location.origin}/fonts/{fontstack}/{range}.pbf` : 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sky: mode === 'light'
        ? { 'sky-color': '#cfe3f5', 'horizon-color': '#eef3f7', 'fog-color': '#eceff1', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2 }
        : { 'sky-color': '#07080b', 'horizon-color': '#1a1712', 'fog-color': '#07080b', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2 },
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri',
          tiles: [`${ESRI_BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}`] },
        'esri-street': { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Streets © Esri',
          tiles: [`${ESRI_BASE}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`] },
        'esri-dark': { type: 'raster', tileSize: 256, maxzoom: 16, attribution: 'Dark Gray © Esri',
          tiles: [`${ESRI_BASE}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`] },
        'esri-trans': { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Roads © Esri',
          tiles: [`${ESRI_BASE}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`] },
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap contributors · OpenFreeMap' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': mode === 'light' ? '#eceff1' : '#1c1e24' } },
        { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: mode === 'night' ? 'visible' : 'none' },
          paint: { 'raster-brightness-max': 0.48, 'raster-saturation': -0.35, 'raster-contrast': 0.12 } },
        { id: 'esri-street', type: 'raster', source: 'esri-street', layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.94, 'raster-saturation': -0.1 } },
        { id: 'esri-dark', type: 'raster', source: 'esri-dark', layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.95, 'raster-brightness-max': 0.9 } },
        { id: 'esri-trans', type: 'raster', source: 'esri-trans', layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.72 } },
        { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
          layout: { 'line-cap': 'round', 'line-join': 'round', visibility: mode === 'night' ? 'visible' : 'none' },
          paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#ffd584', ['primary'], '#e6c27a', '#9aa4b2'],
            'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 16, 4] } },
        { id: 'city', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13.5,
          paint: { 'fill-extrusion-color': mode === 'light' ? '#e2e4e8' : '#262830',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 } },
      ],
    },
  });
  map.__mode = mode;
  map.__omtReady = false;
  map.__esriFallback = false;
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-right');
  return map;
}

export function addSocietyLayers(map, shapes, points) {
  map.addSource('shapes', { type: 'geojson', data: shapes, promoteId: 'sid' });
  map.addSource('pts', { type: 'geojson', data: points, promoteId: 'sid' });
  map.addLayer({ id: 'site-fill', type: 'fill', source: 'shapes', filter: ['==', ['get', 'role'], 'site'],
    paint: { 'fill-color': stateColor(COLORS.match),
      'fill-opacity': ['match', ['feature-state', 'st'], 'match', 0.13, 'likely', 0.1, 'probable', 0.1, 'unknown', 0.05, 'no', 0, 0.08] } });
  map.addLayer({ id: 'site-line', type: 'line', source: 'shapes', filter: ['==', ['get', 'role'], 'site'],
    paint: { 'line-color': stateColor(COLORS.match), 'line-blur': 1.5,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 2],
      'line-opacity': ['match', ['feature-state', 'st'], 'match', 0.9, 'likely', 0.7, 'probable', 0.7, 'unknown', 0.5, 'no', 0.05, 0.5] } });
  map.addLayer({ id: 'glow', type: 'circle', source: 'pts', maxzoom: 15.5,
    paint: { 'circle-color': stateColor(COLORS.match), 'circle-blur': 1,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 12, 6, 15, 24],
      'circle-opacity': ['match', ['feature-state', 'st'], 'match', 0.5, 'likely', 0.35, 'probable', 0.35, 'unknown', 0.14, 'no', 0, 0.25] } });
  map.addLayer({ id: 'bld', type: 'fill-extrusion', source: 'shapes', minzoom: 11.5, filter: ['==', ['get', 'role'], 'bld'],
    paint: { 'fill-extrusion-color': stateColor(COLORS.match), 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95,
      'fill-extrusion-vertical-gradient': true } });
  map.addLayer({ id: 'labels', type: 'symbol', source: 'pts', minzoom: 13.2,
    filter: ['==', ['get', 'show'], 1],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, -2.2],
      'text-letter-spacing': 0.04, 'text-optional': true },
    paint: { 'text-color': '#f2f0ec', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4,
      'text-opacity': ['match', ['feature-state', 'st'], 'match', 1, 'likely', 0.85, 'probable', 0.85, 'unknown', 0.35, 'no', 0, 0.7] } });
}

// Pulse the glow of matches. Cheap: one paint property on ~2,700 circles.
export function startPulse(map) {
  setInterval(() => {
    if (!map.getLayer('glow')) return;
    const k = 1 + 0.35 * Math.sin(performance.now() / 420);
    map.setPaintProperty('glow', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 9, 2 * k, 12, 6 * k, 15, 24 * k]);
  }, 80);
}

export function setStates(map, entries) {
  for (const [sid, st] of entries) {
    map.setFeatureState({ source: 'shapes', id: sid }, { st });
    map.setFeatureState({ source: 'pts', id: sid }, { st });
  }
}

export function setSelected(map, sid, prev) {
  if (prev) for (const src of ['shapes', 'pts']) map.setFeatureState({ source: src, id: prev }, { sel: false });
  if (sid) for (const src of ['shapes', 'pts']) map.setFeatureState({ source: src, id: sid }, { sel: true });
}

// ---------- Streets view: Google-Maps-like roads, parks, water, areas, and POIs ----------
const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'street', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];
const ROAD_W = (major, minor) => ['interpolate', ['exponential', 1.5], ['zoom'],
  10, ['match', ['get', 'class'], ['motorway', 'trunk'], major * 0.55, ['primary', 'secondary'], minor * 0.65, 0.4],
  17, ['match', ['get', 'class'], ['motorway', 'trunk'], major * 5.2, ['primary', 'secondary'], minor * 5.0, ['tertiary', 'minor', 'street', 'residential'], 8.5, 4.5]];
const STREET_LAYERS = [
  { id: 'st-bg', type: 'background', paint: { 'background-color': '#1c1e24' } },
  { id: 'st-green', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland']]], paint: { 'fill-color': '#1e2c22', 'fill-opacity': 0.85 } },
  { id: 'st-park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#213421', 'fill-opacity': 0.9 } },
  { id: 'st-water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#152742' } },
  { id: 'st-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
    filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0e0f12', 'line-width': ROAD_W(6.2, 5.2) } },
  { id: 'st-road', type: 'line', source: 'omt', 'source-layer': 'transportation',
    filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'motorway_link', 'trunk_link'], '#b88c46',
      ['primary', 'primary_link'], '#787e8a', ['secondary', 'secondary_link'], '#585f6c', ['tertiary', 'tertiary_link'], '#444a56', '#333842'],
      'line-width': ROAD_W(4.8, 3.8) } },
  { id: 'st-rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'],
    paint: { 'line-color': '#656975', 'line-width': 1.4, 'line-dasharray': [3, 2] } },
];
// Road, area, and landmark names: always visible above roads & site fills.
const LABEL_LAYERS = [
  { id: 'lbl-road', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 10.2,
    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10.2, 10, 16, 13], 'text-letter-spacing': 0.03, 'text-max-angle': 30, 'symbol-spacing': 260 },
    paint: { 'text-color': '#e4dfd5', 'text-halo-color': 'rgba(0,0,0,.9)', 'text-halo-width': 1.6 } },
  { id: 'lbl-minor-road', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13.8,
    filter: ['in', ['get', 'class'], ['literal', ['minor', 'street', 'residential', 'service']]],
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
      'text-size': 10.5, 'text-max-angle': 30, 'symbol-spacing': 240 },
    paint: { 'text-color': '#c8c3b8', 'text-halo-color': 'rgba(0,0,0,.9)', 'text-halo-width': 1.4 } },
  { id: 'lbl-place', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 9.2,
    filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter', 'locality', 'village', 'town', 'city']]],
    layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'],
      'text-size': ['match', ['get', 'class'], ['city', 'town'], 14.5, ['suburb'], 12.2, 10.8],
      'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-padding': 6 },
    paint: { 'text-color': '#cfc8bc', 'text-halo-color': 'rgba(0,0,0,.9)', 'text-halo-width': 1.5 } },
  { id: 'lbl-metro', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 11.8,
    filter: ['in', ['get', 'class'], ['literal', ['railway']]],
    layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 0.4] },
    paint: { 'text-color': '#8fb4ff', 'text-halo-color': 'rgba(0,0,0,.9)', 'text-halo-width': 1.4 } },
];

function syncOverlayVisibility(map) {
  const mode = map.__mode || 'light';
  const fallback = Boolean(map.__esriFallback && !map.__omtReady);
  if (map.getLayer('st-bg')) map.setLayoutProperty('st-bg', 'visibility', mode !== 'night' && !fallback ? 'visible' : 'none');
  if (map.getLayer('esri-street')) map.setLayoutProperty('esri-street', 'visibility', mode === 'light' && fallback ? 'visible' : 'none');
  if (map.getLayer('esri-dark')) map.setLayoutProperty('esri-dark', 'visibility', mode === 'streets' && fallback ? 'visible' : 'none');
  if (map.getLayer('esri-trans')) map.setLayoutProperty('esri-trans', 'visibility', mode === 'night' && fallback ? 'visible' : 'none');
  if (map.getLayer('ctx-road')) map.setPaintProperty('ctx-road', 'line-opacity', mode === 'night' ? 0.65 : map.__omtReady ? 0.35 : 0.92);
  if (map.getLayer('ctx-road-case')) map.setPaintProperty('ctx-road-case', 'line-opacity', map.__omtReady && mode !== 'night' ? 0.25 : 0.85);
}

export function addBaseLayers(map) {
  for (const l of STREET_LAYERS) map.addLayer({ ...l, layout: { ...(l.layout || {}), visibility: l.id === 'st-bg' ? 'visible' : 'none' } }, 'city');
  for (const l of LABEL_LAYERS) map.addLayer(l); // above society polygons & 3D towers
  const triggerFallback = () => {
    if (map.__omtReady || map.__esriFallback) return;
    map.__esriFallback = true;
    syncOverlayVisibility(map);
  };
  const fallbackTimer = setTimeout(triggerFallback, 4500);
  const checkOmt = (e) => {
    if (e.sourceId !== 'omt' || map.__omtReady) return;
    if (map.querySourceFeatures('omt', { sourceLayer: 'transportation' }).length > 0) {
      map.__omtReady = true;
      clearTimeout(fallbackTimer);
      syncOverlayVisibility(map);
      map.off('sourcedata', checkOmt);
    }
  };
  map.on('sourcedata', checkOmt);
  map.on('error', (e) => { if (e?.sourceId === 'omt') triggerFallback(); });
}

const CTX_POI_FIELD = ['concat', ['match', ['get', 'cls'], 'metro', 'M ', 'rail', 'R ', 'park', '• ', 'hospital', '+ ', ''], ['get', 'name']];
const CTX_POI_PAINT = (isL) => ({
  'text-color': isL
    ? ['match', ['get', 'cls'], ['metro', 'rail'], '#1a73e8', 'park', '#188038', 'hospital', '#c5221f', '#b06000']
    : ['match', ['get', 'cls'], ['metro', 'rail'], '#8ab4f8', 'park', '#81c995', 'hospital', '#f28b82', '#fdd663'],
  'text-halo-color': isL ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.92)',
});

export function addContextLayers(map, contextGeojson) {
  if (!contextGeojson?.features?.length || map.getSource('ctx')) return;
  map.addSource('ctx', { type: 'geojson', data: contextGeojson });
  const beforeRoads = map.getLayer('st-casing') ? 'st-casing' : map.getLayer('city') ? 'city' : undefined;
  const beforeSocLabels = map.getLayer('lbl-road') ? 'lbl-road' : undefined;
  map.addLayer({
    id: 'ctx-rail', type: 'line', source: 'ctx', filter: ['==', ['get', 'fk'], 'rail'],
    paint: { 'line-color': '#6b7280', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2.4], 'line-dasharray': [3, 2] },
  }, beforeRoads);
  map.addLayer({
    id: 'ctx-road-case', type: 'line', source: 'ctx', filter: ['==', ['get', 'fk'], 'road'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#cfd5dc', 'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'tier'], 1, 2.8, 2, 2.0, 1.2], 16, ['match', ['get', 'tier'], 1, 9, 2, 7, 3, 5, 3.5]] },
  }, beforeRoads);
  map.addLayer({
    id: 'ctx-road', type: 'line', source: 'ctx', filter: ['==', ['get', 'fk'], 'road'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['match', ['get', 'tier'], 1, '#f9c958', 2, '#fde69b', 3, '#ffffff', '#f5f6f7'], 'line-opacity': 0.92,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'tier'], 1, 1.8, 2, 1.2, 0.7], 16, ['match', ['get', 'tier'], 1, 6.5, 2, 5, 3, 3.4, 2.2]] },
  }, beforeRoads);
  map.addLayer({
    id: 'ctx-road-lbl', type: 'symbol', source: 'ctx', minzoom: 10,
    filter: ['all', ['==', ['get', 'fk'], 'road'], ['has', 'name'], ['<=', ['get', 'tier'], 3]],
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 15, 12.5], 'symbol-spacing': 320, 'text-max-angle': 30, 'text-optional': true },
    paint: { 'text-color': '#3c4043', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.6 },
  }, beforeSocLabels);
  map.addLayer({
    id: 'ctx-area-lbl', type: 'symbol', source: 'ctx', minzoom: 9.0,
    filter: ['all', ['==', ['get', 'fk'], 'area'], ['<=', ['get', 'tier'], 1]],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12.5,
      'text-transform': 'uppercase', 'text-letter-spacing': 0.09, 'symbol-sort-key': ['get', 'sk'], 'text-padding': 8, 'text-optional': true },
    paint: { 'text-color': '#3c4043', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.7 },
  }, beforeSocLabels);
  map.addLayer({
    id: 'ctx-area-sub', type: 'symbol', source: 'ctx', minzoom: 11.4,
    filter: ['all', ['==', ['get', 'fk'], 'area'], ['>', ['get', 'tier'], 1]],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'],
      'text-size': ['match', ['get', 'tier'], 2, 11.2, 10.2],
      'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'symbol-sort-key': ['get', 'sk'], 'text-padding': 8, 'text-optional': true },
    paint: { 'text-color': '#4b4f54', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 1.6 },
  }, beforeSocLabels);
  map.addLayer({
    id: 'ctx-poi-transit', type: 'symbol', source: 'ctx', minzoom: 11.4,
    filter: ['all', ['==', ['get', 'fk'], 'poi'], ['in', ['get', 'cls'], ['literal', ['metro', 'rail']]]],
    layout: { 'text-field': CTX_POI_FIELD, 'text-font': ['Noto Sans Bold'], 'text-size': 10.8, 'symbol-sort-key': ['get', 'sk'], 'text-padding': 5, 'text-optional': true },
    paint: { ...CTX_POI_PAINT(true), 'text-halo-width': 1.5 },
  }, beforeSocLabels);
  map.addLayer({
    id: 'ctx-poi-local', type: 'symbol', source: 'ctx', minzoom: 12.6,
    filter: ['all', ['==', ['get', 'fk'], 'poi'], ['!', ['in', ['get', 'cls'], ['literal', ['metro', 'rail']]]]],
    layout: { 'text-field': CTX_POI_FIELD, 'text-font': ['Noto Sans Bold'], 'text-size': 10.3, 'symbol-sort-key': ['get', 'sk'], 'text-padding': 5, 'text-optional': true },
    paint: { ...CTX_POI_PAINT(true), 'text-halo-width': 1.5 },
  }, beforeSocLabels);
  setBaseMode(map, map.__mode || 'light');
}

// Building colours per base map. Light needs darker "match" colours and pale "no" colours.
const PALETTES = {
  night: { match: '#ffd9a0', likely: '#c99a5c', probable: '#9a8463', unknown: '#55545c', no: '#1b1b1e', sel: '#ffffff', city: '#1b1d22', label: '#f2f0ec', halo: 'rgba(0,0,0,.88)' },
  streets: { match: '#ffd9a0', likely: '#c99a5c', probable: '#9a8463', unknown: '#5d5c64', no: '#2c2d31', sel: '#ffffff', city: '#282a32', label: '#f2f0ec', halo: 'rgba(0,0,0,.88)' },
  light: { match: '#e8710a', likely: '#f2a93b', probable: '#f6c896', unknown: '#a9a6a0', no: '#dcd9d2', sel: '#1a73e8', city: '#e0e3e7', label: '#202124', halo: 'rgba(255,255,255,.95)' },
};
const LIGHT = { // Google-like day map
  'bg': { 'background-color': '#eceff1' },
  'st-bg': { 'background-color': '#eceff1' }, 'st-green': { 'fill-color': '#d9ebd4' }, 'st-park': { 'fill-color': '#c3e6bc' },
  'st-water': { 'fill-color': '#9fd3f7' }, 'st-casing': { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'motorway_link', 'trunk_link'], '#e0a42b', '#cfd5dc'] },
  'st-road': { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'motorway_link', 'trunk_link'], '#f9c958', ['primary', 'primary_link'], '#fde69b', '#ffffff'] },
  'st-rail': { 'line-color': '#9aa0a6' },
  'lbl-road': { 'text-color': '#3c4043', 'text-halo-color': 'rgba(255,255,255,.95)' },
  'lbl-minor-road': { 'text-color': '#5f6368', 'text-halo-color': 'rgba(255,255,255,.95)' },
  'lbl-place': { 'text-color': '#3c4043', 'text-halo-color': 'rgba(255,255,255,.95)' },
  'lbl-metro': { 'text-color': '#1a73e8', 'text-halo-color': 'rgba(255,255,255,.95)' },
};
const DARK = {
  'bg': { 'background-color': '#1c1e24' },
  'st-bg': { 'background-color': '#1c1e24' }, 'st-green': { 'fill-color': '#1e2c22' }, 'st-park': { 'fill-color': '#213421' },
  'st-water': { 'fill-color': '#152742' }, 'st-casing': { 'line-color': '#0e0f12' },
  'st-road': { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'motorway_link', 'trunk_link'], '#b88c46',
    ['primary', 'primary_link'], '#787e8a', ['secondary', 'secondary_link'], '#585f6c', ['tertiary', 'tertiary_link'], '#444a56', '#333842'] },
  'st-rail': { 'line-color': '#656975' },
  'lbl-road': { 'text-color': '#e4dfd5', 'text-halo-color': 'rgba(0,0,0,.92)' },
  'lbl-minor-road': { 'text-color': '#c8c3b8', 'text-halo-color': 'rgba(0,0,0,.92)' },
  'lbl-place': { 'text-color': '#cfc8bc', 'text-halo-color': 'rgba(0,0,0,.92)' },
  'lbl-metro': { 'text-color': '#8fb4ff', 'text-halo-color': 'rgba(0,0,0,.92)' },
};

const colorBy = (c) => ['case', ['boolean', ['feature-state', 'sel'], false], c.sel,
  ['match', ['feature-state', 'st'], 'match', c.match, 'likely', c.likely, 'probable', c.probable, 'unknown', c.unknown, 'no', c.no, c.match]];

export const BASE_MODES = ['night', 'streets', 'light'];

export function setBaseMode(map, mode) {
  map.__mode = mode;
  const streetsLike = mode !== 'night';
  for (const l of STREET_LAYERS) {
    if (l.id !== 'st-bg') map.setLayoutProperty(l.id, 'visibility', streetsLike ? 'visible' : 'none');
  }
  map.setLayoutProperty('sat', 'visibility', streetsLike ? 'none' : 'visible');
  map.setLayoutProperty('roads', 'visibility', streetsLike ? 'none' : 'visible');
  map.setLayoutProperty('lbl-metro', 'visibility', 'visible');
  for (const [id, props] of Object.entries(mode === 'light' ? LIGHT : DARK)) {
    if (!map.getLayer(id)) continue;
    for (const [k, v] of Object.entries(props)) map.setPaintProperty(id, k, v);
  }
  if (map.getLayer('ctx-road')) {
    const isL = mode === 'light';
    const halo = isL ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.92)';
    map.setPaintProperty('ctx-road-case', 'line-color', isL ? '#cfd5dc' : '#0e0f12');
    map.setPaintProperty('ctx-road', 'line-color', isL
      ? ['match', ['get', 'tier'], 1, '#f9c958', 2, '#fde69b', 3, '#ffffff', '#f5f6f7']
      : ['match', ['get', 'tier'], 1, '#b88c46', 2, '#787e8a', 3, '#585f6c', '#444a56']);
    for (const [id, col] of [['ctx-road-lbl', isL ? '#3c4043' : '#e4dfd5'], ['ctx-area-lbl', isL ? '#3c4043' : '#e2ddd4'], ['ctx-area-sub', isL ? '#4b4f54' : '#cfc8bc']]) {
      map.setPaintProperty(id, 'text-color', col);
      map.setPaintProperty(id, 'text-halo-color', halo);
    }
    const poiPaint = CTX_POI_PAINT(isL);
    for (const id of ['ctx-poi-transit', 'ctx-poi-local']) {
      map.setPaintProperty(id, 'text-color', poiPaint['text-color']);
      map.setPaintProperty(id, 'text-halo-color', poiPaint['text-halo-color']);
    }
  }
  syncOverlayVisibility(map);
  const c = PALETTES[mode];
  map.setPaintProperty('city', 'fill-extrusion-color', c.city);
  for (const [id, prop] of [['bld', 'fill-extrusion-color'], ['site-fill', 'fill-color'], ['site-line', 'line-color'], ['glow', 'circle-color']]) map.setPaintProperty(id, prop, colorBy(c));
  map.setPaintProperty('labels', 'text-color', c.label);
  map.setPaintProperty('labels', 'text-halo-color', c.halo);
  map.setPaintProperty('glow', 'circle-opacity', ['match', ['feature-state', 'st'], 'match', mode === 'light' ? 0.28 : 0.5, 'likely', mode === 'light' ? 0.2 : 0.35, 'probable', mode === 'light' ? 0.2 : 0.35, 'unknown', mode === 'light' ? 0.06 : 0.14, 'no', 0, 0.2]);
  map.setPaintProperty('site-fill', 'fill-opacity', ['match', ['feature-state', 'st'], 'match', mode === 'light' ? 0.22 : 0.13, 'likely', 0.12, 'probable', 0.12, 'unknown', 0.06, 'no', 0, 0.08]);
  map.setSky(mode === 'light'
    ? { 'sky-color': '#cfe3f5', 'horizon-color': '#eef3f7', 'fog-color': '#eceff1', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2 }
    : { 'sky-color': '#07080b', 'horizon-color': '#1a1712', 'fog-color': '#07080b', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2 });
  if (map.getLayer('pin-line')) {
    const col = mode === 'light' ? '#1a73e8' : '#ffd9a0';
    map.setPaintProperty('pin-fill', 'fill-color', col);
    map.setPaintProperty('pin-line', 'line-color', col);
    map.setPaintProperty('pin-dot', 'circle-color', col);
  }
}

export const AREA_CLICK_LAYERS = ['ctx-area-lbl', 'ctx-area-sub', 'lbl-place'];
export const TRANSIT_CLICK_LAYERS = ['ctx-poi-transit', 'lbl-metro'];

function circlePolygon(lng, lat, radiusM, steps = 48) {
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([lng + (radiusM * Math.cos(a)) / mPerLng, lat + (radiusM * Math.sin(a)) / mPerLat]);
  }
  return ring;
}

export function setCommutePin(map, pin) {
  if (!map?.isStyleLoaded?.() && !map?.getLayer?.('glow')) return;
  const fc = pin
    ? {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { kind: 'ring' }, geometry: { type: 'Polygon', coordinates: [circlePolygon(pin.lng, pin.lat, pin.km * 1000)] } },
          { type: 'Feature', properties: { kind: 'dot' }, geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] } },
        ],
      }
    : { type: 'FeatureCollection', features: [] };
  if (!map.getSource('pin')) {
    map.addSource('pin', { type: 'geojson', data: fc });
    const col = (map.__mode || 'light') === 'light' ? '#1a73e8' : '#ffd9a0';
    const before = map.getLayer('bld') ? 'bld' : undefined;
    map.addLayer({ id: 'pin-fill', type: 'fill', source: 'pin', filter: ['==', ['get', 'kind'], 'ring'],
      paint: { 'fill-color': col, 'fill-opacity': 0.1 } }, before);
    map.addLayer({ id: 'pin-line', type: 'line', source: 'pin', filter: ['==', ['get', 'kind'], 'ring'],
      paint: { 'line-color': col, 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.9 } }, before);
    map.addLayer({ id: 'pin-dot', type: 'circle', source: 'pin', filter: ['==', ['get', 'kind'], 'dot'],
      paint: { 'circle-color': col, 'circle-radius': 6.5, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' } });
  } else {
    map.getSource('pin').setData(fc);
  }
}

// Let people switch off the glow, the society boundaries or the name labels when they get too busy.
export function setHighlights(map, { glow = true, bounds = true, labels = true } = {}) {
  if (!map.getLayer('glow')) return;
  map.setLayoutProperty('glow', 'visibility', glow ? 'visible' : 'none');
  map.setLayoutProperty('site-fill', 'visibility', bounds ? 'visible' : 'none');
  map.setLayoutProperty('site-line', 'visibility', bounds ? 'visible' : 'none');
  map.setLayoutProperty('labels', 'visibility', labels ? 'visible' : 'none');
}
