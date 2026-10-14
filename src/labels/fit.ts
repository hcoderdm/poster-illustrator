import type { Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { Settings, LabelClass } from '../settings';
import type { Rect } from '../poster';
import { POINT_LABEL_LAYERS, POI_TEXT_GAP, textSizeAt } from '../style/vintage';
import { cssFont, loadFonts } from '../fonts';

// Turns MapLibre's placed point labels into the GeoJSON drawn by the "-fit" copy
// layers: labels poking out of the frame are nudged in (or dropped past maxShift),
// and curved labels become one point per letter along a parabola (text on GeoJSON
// lines would be duplicated at every tile boundary).

type Box = [number, number, number, number];

const ctx = document.createElement('canvas').getContext('2d')!;
const advances = new Map<string, number>();

// MapLibre lays text out glyph by glyph (no kerning); reproduce its advances exactly.
function advance(ch: string, font: string, size: number) {
  const key = `${font}|${ch}`;
  let a = advances.get(key);
  if (a === undefined) {
    ctx.font = cssFont(font, 24);
    a = ctx.measureText(ch).width / 24;
    advances.set(key, a);
  }
  return a * size;
}

function measure(text: string, font: string, size: number, letterSpacingEm: number) {
  const sp = letterSpacingEm * size;
  let w = 0;
  for (const ch of text) w += advance(ch, font, size) + sp;
  return Math.max(0, w - sp);
}

const BREAKABLE = new Set([0x0a, 0x20, 0x26, 0x29, 0x2b, 0x2d, 0x2f, 0xad, 0xb7, 0x200b, 0x2010, 0x2013]);
type Break = { index: number; x: number; prior: Break | null; badness: number };

/** Port of MapLibre's balanced line breaking (TaggedString.determineLineBreaks), measuring the widest line. */
function labelBox(text: string, font: string, size: number, ls: number, maxWidthEm: number) {
  const chars = [...text];
  const sp = ls * size;
  const adv = chars.map((c) => advance(c, font, size) + sp);
  const total = adv.reduce((a, b) => a + b, 0);
  const lineCount = Math.max(1, Math.ceil(total / (maxWidthEm * size)));
  const target = total / lineCount;
  const badness = (w: number, last: boolean) => {
    const r = (w - target) ** 2;
    return last ? (w < target ? r / 2 : r * 2) : r;
  };
  const evaluate = (index: number, x: number, potential: Break[], last: boolean): Break => {
    let prior: Break | null = null;
    let best = badness(x, last);
    for (const b of potential) {
      const bad = badness(x - b.x, last) + b.badness;
      if (bad <= best) {
        prior = b;
        best = bad;
      }
    }
    return { index, x, prior, badness: best };
  };
  const potential: Break[] = [];
  let x = 0;
  chars.forEach((c, i) => {
    if (!/\s/.test(c)) x += adv[i];
    if (i < chars.length - 1 && (BREAKABLE.has(c.codePointAt(0)!) || (i < chars.length - 2 && chars[i + 1] === '('))) {
      potential.push(evaluate(i + 1, x, potential, false));
    }
  });
  const breaks: number[] = [];
  for (let b: Break | null = evaluate(chars.length, x, potential, true); b; b = b.prior) breaks.unshift(b.index);
  let start = 0, widest = 0;
  for (const end of breaks) {
    const line = chars.slice(start, end).join('').trim();
    widest = Math.max(widest, measure(line, font, size, ls));
    start = end;
  }
  return { w: widest, h: breaks.length * size * 1.2 };
}

function classFor(s: Settings, layerId: string): { cls: LabelClass; font: string; spacing: number; maxWidth: number } {
  const lb = s.labels;
  switch (layerId) {
    case 'label-capital':
      return { cls: lb.capital, font: lb.capitalFont, spacing: lb.letterSpacing * 1.5, maxWidth: 10 };
    case 'label-city':
      return { cls: lb.city, font: lb.cityFont, spacing: lb.letterSpacing * 1.4, maxWidth: 10 };
    case 'label-town':
      return { cls: lb.town, font: lb.placeFont, spacing: lb.letterSpacing * 1.2, maxWidth: 10 };
    case 'label-village':
      return { cls: lb.village, font: lb.placeFont, spacing: lb.letterSpacing, maxWidth: 10 };
    case 'label-suburb':
      return { cls: lb.suburb, font: lb.placeFont, spacing: lb.letterSpacing * 0.8, maxWidth: 10 };
    case 'label-poi':
      return { cls: lb.poi, font: lb.poiFont, spacing: lb.letterSpacing * 0.3, maxWidth: 8 };
    case 'label-island':
      return { cls: lb.island, font: lb.waterFont, spacing: lb.letterSpacing * 0.6, maxWidth: 10 };
    default:
      return { cls: lb.water, font: lb.waterFont, spacing: lb.letterSpacing, maxWidth: 8 };
  }
}

function waterSizeFactor(f: MapGeoJSONFeature) {
  const c = f.properties.class;
  return c === 'ocean' || c === 'sea' ? 1.4 : c === 'bay' || c === 'strait' ? 1.15 : 1;
}

const curveFor = (s: Settings, layerId: string) =>
  layerId === 'label-poi' ? 0 : layerId === 'label-water' || layerId === 'label-island' ? s.labels.waterCurve : s.labels.placeCurve;

// How far a curve bends a label of width w (positive bows upward ∩).
const sagFor = (w: number, curve: number) => curve * w * 0.12;

/** One Point at (cx, cy) for straight text, or one rotated Point per letter along a parabola. */
function labelFeatures(map: MLMap, cx: number, cy: number, text: string, font: string, size: number, ls: number, curve: number, props: Record<string, unknown>): Feature[] {
  const toLngLat = (x: number, y: number) => {
    const c = map.unproject([x, y]);
    return [c.lng, c.lat];
  };
  if (!curve) return [{ type: 'Feature', geometry: { type: 'Point', coordinates: toLngLat(cx, cy) }, properties: props }];

  const chars = [...text];
  const adv = chars.map((ch) => advance(ch, font, size) + ls * size);
  const total = adv.reduce((a, b) => a + b, 0) - ls * size;
  const sag = sagFor(total, curve);
  const half = total / 2;
  const out: Feature[] = [];
  let x = -half;
  chars.forEach((ch, i) => {
    const u = x + (adv[i] - ls * size) / 2;
    x += adv[i];
    if (ch === ' ') return;
    const t = half ? u / half : 0;
    const y = sag * t * t - sag / 2;
    const slope = half ? (2 * sag * t) / half : 0;
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: toLngLat(cx + u, cy + y) },
      properties: { ...props, _char: ch, _rot: (Math.atan(slope) * 180) / Math.PI },
    });
  });
  return out;
}

const overlaps = (a: Box, b: Box, m = 2) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;

/** With nudge false (Styled mode) labels stay where MapLibre put them: copies only, no fitting. */
export async function fitLabels(map: MLMap, frame: Rect, s: Settings, nudge = true): Promise<FeatureCollection> {
  const layers = POINT_LABEL_LAYERS.filter((id) => map.getLayer(id));
  const raw = map.queryRenderedFeatures({ layers });
  const zoom = map.getZoom();
  const pad = s.labels.framePadding;
  const inner: Box = [frame.x + pad, frame.y + pad, frame.x + frame.width - pad, frame.y + frame.height - pad];
  const outer: Box = [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height];

  await loadFonts(POINT_LABEL_LAYERS.map((id) => classFor(s, id).font));
  const seen = new Set<string>();
  // ax: offset from the anchor to the label box centre (POI text sits right of its dot).
  const items: { f: MapGeoJSONFeature; box: Box; priority: number; text: string; font: string; size: number; ls: number; ax: number }[] = [];
  const searched = s.labels.searchedName.trim().toLowerCase();
  for (const f of raw) {
    if (f.geometry.type !== 'Point') continue;
    const text = String(f.properties['name:en'] ?? f.properties['name:latin'] ?? f.properties.name ?? '');
    if (!text) continue;
    // A label can be reported once per tile it touches; same-named places elsewhere are kept.
    const [lng, lat] = f.geometry.coordinates;
    const key = `${f.layer.id}|${text}|${lng.toFixed(4)}|${lat.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { cls, font, spacing, maxWidth } = classFor(s, f.layer.id);
    const isSearched = !!searched && text.toLowerCase() === searched;
    const size = textSizeAt(cls.size, zoom) * (f.layer.id === 'label-water' ? waterSizeFactor(f) : 1) * (isSearched ? s.labels.searchedScale : 1);
    const shown = s.labels.uppercase && f.layer.id !== 'label-poi' ? text.toUpperCase() : text;
    const curve = curveFor(s, f.layer.id);
    // Curved labels are set on one line; straight ones may wrap.
    const { w, h } = curve ? { w: measure(shown, font, size, spacing), h: size * 1.2 } : labelBox(shown, font, size, spacing, maxWidth);
    const p = map.project([lng, lat]);
    const halo = s.labels.haloWidth;
    const bend = Math.abs(sagFor(w, curve)) / 2;
    const ax = f.layer.id === 'label-poi' && s.labels.poiMarker ? POI_TEXT_GAP * size + w / 2 : 0;
    const cx = p.x + ax;
    const box: Box = [cx - w / 2 - halo, p.y - h / 2 - halo - bend, cx + w / 2 + halo, p.y + h / 2 + halo + bend];
    const rank = Number(f.properties.rank ?? 99);
    const priority = isSearched ? -1 : POINT_LABEL_LAYERS.indexOf(f.layer.id) * 1000 + rank;
    items.push({ f, box, priority, text: shown, font, size, ls: spacing, ax });
  }

  const accepted: Box[] = [];
  const out: Feature[] = [];
  const emit = (it: (typeof items)[number], box: Box) => {
    accepted.push(box);
    const props = { ...it.f.properties, _layer: it.f.layer.id };
    out.push(...labelFeatures(map, (box[0] + box[2]) / 2 - it.ax, (box[1] + box[3]) / 2, it.text, it.font, it.size, it.ls, curveFor(s, it.f.layer.id), props));
  };

  if (!nudge) {
    for (const it of items) emit(it, it.box);
    return { type: 'FeatureCollection', features: out };
  }

  // Labels inside keep their place; partly-outside ones are nudged in, most important first, unless they collide.
  const pending: typeof items = [];
  for (const it of items.sort((a, b) => a.priority - b.priority)) {
    const [x0, y0, x1, y1] = it.box;
    if (x1 <= outer[0] || x0 >= outer[2] || y1 <= outer[1] || y0 >= outer[3]) continue; // fully outside
    if (x0 >= inner[0] && x1 <= inner[2] && y0 >= inner[1] && y1 <= inner[3]) emit(it, it.box);
    else pending.push(it);
  }
  for (const it of pending) {
    const [x0, y0, x1, y1] = it.box;
    const shift = (lo: number, hi: number, min: number, max: number) =>
      hi - lo > max - min ? (min + max) / 2 - (lo + hi) / 2 : lo < min ? min - lo : hi > max ? max - hi : 0;
    const dx = shift(x0, x1, inner[0], inner[2]);
    const dy = shift(y0, y1, inner[1], inner[3]);
    if (Math.hypot(dx, dy) > s.labels.maxShift) continue;
    const box: Box = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
    if (accepted.some((a) => overlaps(a, box))) continue;
    emit(it, box);
  }
  return { type: 'FeatureCollection', features: out };
}
