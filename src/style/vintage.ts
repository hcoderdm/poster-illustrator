import type { StyleSpecification, LayerSpecification, ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { POI_GROUPS, type Settings, type LabelClass, type LineStyle, type AreaStyle, type Dash, type PoiGroup } from '../settings';
import { rgb } from '../colors';
import { patternId } from './patterns';
import { mergedUrl, minMergedZoom, NATIVE_BUILDING_ZOOM, TILES_URL } from './tiles';
import type { Corners } from '../waterlines/render';

export const ORIGINAL_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Point labels that are redrawn from computed copies (fitted to the frame, curved, halos under text). */
export const POINT_LABEL_LAYERS = ['label-capital', 'label-city', 'label-town', 'label-water', 'label-village', 'label-island', 'label-suburb', 'label-poi'];
/** Gap (ems) between a POI's dot and its label. */
export const POI_TEXT_GAP = 0.6;

export interface StyleExtras {
  /** ghost: MapLibre places the originals invisibly and `data` copies are drawn; fitted: only the copies (export). */
  labels: { mode: 'ghost' | 'fitted'; data: FeatureCollection };
  /** Water-lines raster with its corners (TL, TR, BR, BL). */
  water?: { url: string; coordinates: Corners };
}

const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
const SIZE_STOPS: [number, number][] = [[6, 0.55], [12, 1], [17, 1.5]];

/** JS twin of the label text-size ramp, for measuring labels. */
export function textSizeAt(size: number, zoom: number) {
  const z = Math.max(SIZE_STOPS[0][0], Math.min(SIZE_STOPS[SIZE_STOPS.length - 1][0], zoom));
  const i = Math.max(1, SIZE_STOPS.findIndex(([sz]) => sz >= z));
  const [[z0, f0], [z1, f1]] = [SIZE_STOPS[i - 1], SIZE_STOPS[i]];
  return size * (f0 + ((f1 - f0) * (z - z0)) / (z1 - z0));
}

// Exponential zoom ramp for line widths; minWidth floors every stop so thin roads stay visible.
const widths = (stops: [number, number][], mult: number, minWidth = 0) =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flatMap(([z, w]) => [z, Math.max(minWidth, w * mult)])] as ExpressionSpecification;

const vis = (show: boolean): 'visible' | 'none' => (show ? 'visible' : 'none');
const cls = (...classes: string[]): ExpressionSpecification => ['in', ['get', 'class'], ['literal', classes]];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const isLetter: ExpressionSpecification = ['has', '_char'];

// Dash arrays are in multiples of line width.
const DASH_ARRAYS: Record<Dash, number[] | undefined> = { solid: undefined, dashed: [4, 3], dotted: [0.1, 2.2], 'dash-dot': [4, 2, 0.1, 2] };
const dashPaint = (dash: Dash) => (DASH_ARRAYS[dash] ? { 'line-dasharray': DASH_ARRAYS[dash] } : {});

// Curved labels arrive as one point per letter (labels/fit.ts) with the glyph, rotation and spacing applied.
const LETTER_LAYOUT = {
  'text-field': ['get', '_char'],
  'text-rotate': ['get', '_rot'],
  'text-rotation-alignment': 'map',
  'text-letter-spacing': 0,
  'text-transform': 'none',
  'text-anchor': 'center',
};

export function buildStyle(s: Settings, extras: StyleExtras): StyleSpecification {
  const { palette: p, layers: L, labels: lb } = s;
  const layers: LayerSpecification[] = [];
  const sources: StyleSpecification['sources'] = { omt: { type: 'vector', url: TILES_URL } };
  const merged = (kind: 'buildings' | 'roads' | 'detail', zoom: number) => {
    const id = `${kind}-${zoom}`;
    sources[id] = { type: 'vector', tiles: [mergedUrl(kind, zoom)], minzoom: 0, maxzoom: 14 };
    return id;
  };

  // Polygon class: optional opaque paper base (hides tints under buildings), tint, pattern, border.
  const area = (id: string, sourceLayer: string, filter: FilterSpecification, a: AreaStyle, src = { source: 'omt', minzoom: a.minzoom }, outlineLayer = sourceLayer, opaque = false) => {
    const base = { ...src, 'source-layer': sourceLayer, filter };
    if (opaque) layers.push({ ...base, id: `${id}-base`, type: 'fill', layout: { visibility: vis(a.show) }, paint: { 'fill-color': p.paper } } as LayerSpecification);
    layers.push({ ...base, id, type: 'fill', layout: { visibility: vis(a.show && a.fillOpacity > 0) }, paint: { 'fill-color': a.fill, 'fill-opacity': a.fillOpacity } } as LayerSpecification);
    if (a.pattern !== 'none') {
      const pattern = patternId(a.pattern, a.patternColor, a.patternSpacing, a.patternWidth);
      layers.push({ ...base, id: `${id}-pattern`, type: 'fill', layout: { visibility: vis(a.show) }, paint: { 'fill-pattern': pattern, 'fill-opacity': a.patternOpacity } } as LayerSpecification);
    }
    layers.push({
      ...base,
      'source-layer': outlineLayer,
      id: `${id}-outline`,
      type: 'line',
      layout: { visibility: vis(a.show && a.outline), 'line-join': 'round', 'line-cap': a.outlineDash === 'dotted' ? 'round' : 'butt' },
      paint: { 'line-color': a.outlineColor, 'line-opacity': a.outlineOpacity, 'line-width': a.outlineWidth, ...dashPaint(a.outlineDash) },
    } as LayerSpecification);
  };

  const line = (id: string, sourceLayer: string, filter: FilterSpecification, l: LineStyle, width: ExpressionSpecification, src = { source: 'omt', minzoom: l.minzoom }) =>
    layers.push({
      id,
      type: 'line',
      ...src,
      'source-layer': sourceLayer,
      filter,
      layout: { visibility: vis(l.show), 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': l.color, 'line-opacity': l.opacity, 'line-width': width, ...dashPaint(l.dash) },
    } as LayerSpecification);

  // --- areas ---
  area('wood', 'landcover', cls('wood', 'forest'), L.wood);
  area('grass', 'landcover', cls('grass', 'farmland'), L.grass);
  area('wetland', 'landcover', cls('wetland'), L.wetland);
  area('landuse', 'landuse', cls('residential', 'suburb', 'neighbourhood', 'quarter'), L.landuse);
  area('industrial', 'landuse', cls('commercial', 'industrial', 'retail', 'railway'), L.industrial);
  area('park', 'park', ['all'], L.park);
  area('cemetery', 'landuse', cls('cemetery'), L.park);
  area('institution', 'landuse', cls('school', 'university', 'college', 'kindergarten', 'hospital', 'library'), L.institution);
  area('recreation', 'landuse', cls('pitch', 'playground', 'track', 'stadium'), L.recreation);
  area('airport', 'aeroway', ['all', ['==', ['geometry-type'], 'Polygon'], cls('aerodrome', 'apron', 'runway', 'taxiway', 'helipad')], L.airport);

  // Water (paper, tint and engraved lines) is a worker-computed raster above the tints, so nothing tints it.
  if (extras.water) {
    sources.waterlines = { type: 'image', ...extras.water };
    layers.push({ id: 'waterlines', type: 'raster', source: 'waterlines', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
  }

  const ww = L.waterway.width;
  const riverStops = [[8, 0.5, 0.1], [14, 1.6, 0.6], [18, 4, 1.5]].flatMap(([z, river, other]) => [z, ['match', ['get', 'class'], 'river', river * ww, other * ww]]);
  line('waterway', 'waterway', ['all', cls('river', 'canal', 'stream'), notTunnel], L.waterway, ['interpolate', ['exponential', 1.5], ['zoom'], ...riverStops] as ExpressionSpecification);

  const rw = L.runway;
  const aeroLine = (c: string): FilterSpecification => ['all', ['==', ['geometry-type'], 'LineString'], cls(c)];
  line('runway', 'aeroway', aeroLine('runway'), rw, widths([[10, 1], [13, 4], [16, 25], [18, 60]], rw.width, rw.minWidth));
  line('taxiway', 'aeroway', aeroLine('taxiway'), { ...rw, show: rw.show && rw.taxiways, opacity: rw.opacity * 0.8 }, widths([[12, 0.4], [14, 1.5], [18, 10]], rw.width, rw.minWidth / 2), { source: 'omt', minzoom: Math.max(12, rw.minzoom) });

  // Individual houses only exist in zoom-14 data; below the data's zoom, buildings come from merged tiles.
  const b = L.building;
  const bZoom = b.houses ? 14 : NATIVE_BUILDING_ZOOM;
  const lowZoomBuildings = b.minzoom < bZoom;
  area(
    'building',
    'building',
    ['all'],
    b,
    lowZoomBuildings ? { source: merged('buildings', bZoom), minzoom: Math.max(minMergedZoom(bZoom), b.minzoom) } : { source: 'omt', minzoom: b.minzoom },
    lowZoomBuildings ? 'building_outline' : 'building',
    true,
  );

  line('boundary', 'boundary', ['all', ['<=', ['get', 'admin_level'], 8], ['!=', ['get', 'maritime'], 1]], L.boundary, [
    'match', ['get', 'admin_level'], [2, 3, 4], 1.4 * L.boundary.width, 0.8 * L.boundary.width,
  ] as ExpressionSpecification);

  // --- roads (optionally merged from detailed tiles so small roads show zoomed out) ---
  const roadZoom = { standard: 0, more: 12, all: 14 }[L.roadDetail];
  const roadSource = roadZoom ? merged('roads', roadZoom) : 'omt';
  const roadSrc = (l: LineStyle, floor = 0) => ({ source: roadSource, minzoom: Math.max(l.minzoom, floor, roadZoom ? minMergedZoom(roadZoom) : 0) });
  const roads = (...c: string[]): FilterSpecification => ['all', cls(...c), notTunnel];
  const road = (id: string, c: string[], l: LineStyle, stops: [number, number][]) => line(id, 'transportation', roads(...c), l, widths(stops, l.width, l.minWidth), roadSrc(l));
  road('path', ['path', 'track'], L.path, [[13, 0.3], [18, 1]]);
  road('service', ['service'], L.service, [[12, 0.12], [14, 0.35], [18, 1.6]]);
  road('minor', ['minor'], L.minor, [[11, 0.15], [14, 0.5], [18, 2.2]]);
  road('major', ['primary', 'secondary', 'tertiary'], L.major, [[8, 0.3], [12, 0.8], [18, 4]]);

  // Highways: dark casing with a paper core, like the double-ruled turnpikes of old maps.
  const mw = L.motorway;
  road('motorway', ['motorway', 'trunk'], mw, mw.double ? [[6, 0.6], [12, 2.6], [18, 10]] : [[6, 0.5], [12, 1.4], [18, 5]]);
  layers.push({
    id: 'motorway-core',
    type: 'line',
    ...roadSrc(mw, 9),
    'source-layer': 'transportation',
    filter: roads('motorway', 'trunk'),
    layout: { visibility: vis(mw.show && mw.double), 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': p.paper, 'line-width': widths([[9, 0.6], [12, 1.4], [18, 7]], mw.width) },
  });

  // Railways: thin line plus cross-ties drawn as a wide, short-dashed line.
  const rail = L.rail;
  const railFilter: FilterSpecification = ['all', cls('rail', 'transit'), notTunnel, ['!', ['has', 'service']]];
  line('rail', 'transportation', railFilter, rail, widths([[8, 0.4], [14, 0.9], [18, 1.6]], rail.width, rail.minWidth), roadSrc(rail));
  layers.push({
    id: 'rail-ties',
    type: 'line',
    ...roadSrc(rail, 10),
    'source-layer': 'transportation',
    filter: railFilter,
    layout: { visibility: vis(rail.show && rail.ties), 'line-join': 'round' },
    paint: { 'line-color': rail.color, 'line-opacity': rail.opacity, 'line-width': widths([[10, 2], [14, 3.5], [18, 7]], rail.width), 'line-dasharray': [0.15, 2.5] },
  });

  // --- labels ---
  const [hr, hg, hb] = rgb(p.halo);
  const halo = { 'text-halo-color': `rgba(${hr}, ${hg}, ${hb}, ${lb.haloOpacity})`, 'text-halo-width': lb.haloWidth, 'text-halo-blur': lb.haloBlur };
  const transform = lb.uppercase ? 'uppercase' : 'none';
  const density = { 'text-padding': lb.padding, 'text-allow-overlap': lb.allowOverlap };

  // The last searched place is drawn larger and placed first, so other labels give way.
  const searched = lb.searchedName.trim().toLowerCase();
  const isSearched: ExpressionSpecification = ['==', ['downcase', ['to-string', NAME]], searched];
  const scaled = (v: number | ExpressionSpecification) => (searched ? (['*', v, ['case', isSearched, lb.searchedScale, 1]] as ExpressionSpecification) : v);
  const textSize = (size: number) => ['interpolate', ['linear'], ['zoom'], ...SIZE_STOPS.flatMap(([z, f]) => [z, scaled(size * f)])] as ExpressionSpecification;
  const rank: ExpressionSpecification = ['coalesce', ['get', 'rank'], 99];
  const sortKey: ExpressionSpecification = searched ? ['case', isSearched, -1, rank] : rank;

  // Label data: each zoom's own tiles, or names merged from detailed tiles so small places show zoomed out.
  const detailZoom = { standard: 0, more: 11, all: 14 }[lb.detail];
  const detailSource = detailZoom ? merged('detail', detailZoom) : 'omt';
  const labelSrc = (c: LabelClass) => ({ source: detailSource, minzoom: Math.max(c.minzoom, detailZoom ? minMergedZoom(detailZoom) : 0) });

  const symbol = (id: string, src: object, sourceLayer: string, filter: FilterSpecification, show: boolean, font: string, layout: object, color = p.label) =>
    layers.push({
      id,
      type: 'symbol',
      ...src,
      'source-layer': sourceLayer,
      filter,
      layout: { visibility: vis(show), 'text-field': NAME, 'text-font': [font], ...density, ...layout },
      paint: { 'text-color': color, ...halo },
    } as LayerSpecification);

  symbol('label-street', { source: 'omt', minzoom: lb.street.minzoom }, 'transportation_name', cls('primary', 'secondary', 'tertiary', 'minor', 'trunk'), lb.street.show, lb.streetFont, {
    'symbol-placement': 'line',
    'text-size': textSize(lb.street.size),
    'text-letter-spacing': lb.letterSpacing * 0.4,
    'text-max-angle': 30,
  });

  const poiClasses = (Object.keys(POI_GROUPS) as PoiGroup[]).filter((g) => lb.poiGroups[g]).flatMap((g) => [...POI_GROUPS[g]]);
  const poiFilter: ExpressionSpecification = ['all', ['in', ['get', 'class'], ['literal', poiClasses]], ['has', 'name']];
  const poiShow = lb.poi.show && poiClasses.length > 0;
  layers.push({
    id: 'poi-marker',
    type: 'circle',
    ...labelSrc(lb.poi),
    'source-layer': 'poi',
    filter: poiFilter,
    layout: { visibility: vis(poiShow && lb.poiMarker) },
    paint: { 'circle-color': p.label, 'circle-radius': Math.max(1, lb.poi.size * 0.18), 'circle-stroke-color': p.halo, 'circle-stroke-width': 0.8 },
  } as LayerSpecification);
  symbol('label-poi', labelSrc(lb.poi), 'poi', poiFilter, poiShow, lb.poiFont, {
    'text-size': textSize(lb.poi.size),
    'text-letter-spacing': lb.letterSpacing * 0.3,
    'text-max-width': 8,
    'symbol-sort-key': sortKey,
    ...(lb.poiMarker ? { 'text-anchor': 'left', 'text-offset': [POI_TEXT_GAP, 0] } : {}),
  });

  symbol('label-water', { source: 'omt', minzoom: lb.water.minzoom }, 'water_name', ['all'], lb.water.show, lb.waterFont, {
    'text-size': scaled(['match', ['get', 'class'], ['ocean', 'sea'], lb.water.size * 1.4, ['bay', 'strait'], lb.water.size * 1.15, lb.water.size]),
    'text-letter-spacing': lb.letterSpacing,
    'text-transform': transform,
    'text-max-width': 8,
    'symbol-sort-key': sortKey,
  }, p.waterLabel);

  const place = (id: string, filter: ExpressionSpecification, c: LabelClass, font: string, spacing: number) =>
    symbol(id, labelSrc(c), 'place', filter, c.show, font, {
      'text-size': textSize(c.size),
      'text-letter-spacing': lb.letterSpacing * spacing,
      'text-transform': transform,
      'text-max-width': 10,
      'symbol-sort-key': sortKey,
    });
  // OpenMapTiles marks national (2) and state/provincial (3–4) capitals.
  const isCapital: ExpressionSpecification = ['in', ['get', 'capital'], ['literal', [2, 3, 4]]];
  place('label-island', cls('island', 'islet'), lb.island, lb.waterFont, 0.6);
  place('label-suburb', cls('suburb', 'neighbourhood', 'quarter'), lb.suburb, lb.placeFont, 0.8);
  place('label-village', cls('village', 'hamlet'), lb.village, lb.placeFont, 1);
  place('label-town', cls('town'), lb.town, lb.placeFont, 1.2);
  place('label-city', ['all', cls('city'), ['!', isCapital]], lb.city, lb.cityFont, 1.4);
  place('label-capital', ['all', cls('city'), isCapital], lb.capital, lb.capitalFont, 1.5);

  // Point labels are drawn from `data` copies, all halos before all text, so no halo covers another label's text.
  sources.fitted = { type: 'geojson', data: extras.labels.data };
  const halos: LayerSpecification[] = [];
  const texts: LayerSpecification[] = [];
  for (const id of POINT_LABEL_LAYERS) {
    const orig = layers.find((l) => l.id === id) as Extract<LayerSpecification, { type: 'symbol' }>;
    const straight: any = { ...structuredClone(orig), id: `${id}-fit`, source: 'fitted', filter: ['all', ['==', ['get', '_layer'], id], ['!', isLetter]] };
    delete straight['source-layer'];
    delete straight.minzoom;
    straight.layout = { ...straight.layout, 'text-allow-overlap': true, 'text-ignore-placement': true };
    const curved: any = { ...structuredClone(straight), id: `${id}-fit-curve`, filter: ['all', ['==', ['get', '_layer'], id], isLetter] };
    curved.layout = { ...curved.layout, ...LETTER_LAYOUT };
    // A sort key makes MapLibre drop per-letter symbols entirely.
    delete curved.layout['symbol-sort-key'];
    delete curved.layout['text-max-width'];
    for (const c of [straight, curved]) {
      // The halo pass fills the letters with the halo colour too, so no seam shows between halo ring and text.
      halos.push({ ...structuredClone(c), id: `${c.id}-halo`, paint: { ...c.paint, 'text-color': c.paint['text-halo-color'] } });
      texts.push({ ...c, paint: { ...c.paint, 'text-halo-width': 0 } });
    }
    if (extras.labels.mode === 'ghost') orig.paint = { ...orig.paint, 'text-opacity': 0 };
    else orig.layout = { ...orig.layout, visibility: 'none' };
  }
  layers.push(...halos, ...texts);

  // No glyph server: MapLibre draws glyphs from the web fonts in fonts.ts, at double resolution.
  return { version: 8, sources, layers };
}

/** Water-only style for the hidden mask map: water white, everything else black. */
export function buildMaskStyle(s: Settings): StyleSpecification {
  return {
    version: 8,
    sources: { omt: { type: 'vector', url: TILES_URL } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
      {
        id: 'water',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        filter: ['all', cls(...(s.water.inland ? ['ocean', 'lake', 'river'] : ['ocean'])), notTunnel],
        paint: { 'fill-color': '#fff' },
      },
    ],
  };
}
