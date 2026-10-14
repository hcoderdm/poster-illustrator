import type { Adjust } from './colors';

// All user-tweakable state. The style, water lines, poster and export derive from
// a Settings object: a new knob is a field here plus a control in main.ts.

export type Dash = 'solid' | 'dashed' | 'dotted' | 'dash-dot';
export type Pattern = 'none' | 'hatch' | 'hatch-back' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots' | 'dots-offset' | 'stipple';

export const DASHES: Dash[] = ['solid', 'dashed', 'dotted', 'dash-dot'];
export const PATTERNS: Pattern[] = ['none', 'hatch', 'hatch-back', 'crosshatch', 'horizontal', 'vertical', 'dots', 'dots-offset', 'stipple'];

/** A line feature class (roads, rails, rivers, boundaries). */
export interface LineStyle {
  show: boolean;
  color: string;
  width: number; // multiplier on the built-in zoom ramp
  opacity: number;
  dash: Dash;
  minzoom: number;
  minWidth: number; // px floor, so thin roads stay visible when zoomed out
}

/** Data source for roads/labels: each zoom's own tiles, or merged from more detailed ones (style/tiles.ts). */
export type Detail = 'standard' | 'more' | 'all';
export const DETAILS: Detail[] = ['standard', 'more', 'all'];

/** A polygon feature class: tint fill, optional engraved pattern, optional border. */
export interface AreaStyle {
  show: boolean;
  fill: string;
  fillOpacity: number;
  pattern: Pattern;
  patternColor: string;
  patternOpacity: number;
  patternSpacing: number; // px
  patternWidth: number; // px
  outline: boolean;
  outlineColor: string;
  outlineWidth: number; // px
  outlineOpacity: number;
  outlineDash: Dash;
  minzoom: number;
}

export interface LabelClass {
  show: boolean;
  size: number; // px at zoom 12
  minzoom: number; // zoom at which this class starts to appear
}

/** Groups of OpenMapTiles POI classes offered as label categories. */
export const POI_GROUPS = {
  education: ['school', 'college', 'kindergarten'],
  health: ['hospital'],
  worship: ['place_of_worship'],
  civic: ['town_hall', 'library', 'post', 'police', 'fire_station'],
  culture: ['museum', 'theatre', 'cinema', 'art_gallery', 'attraction', 'monument', 'castle'],
  parks: ['park', 'garden', 'golf', 'stadium', 'zoo', 'campsite'],
  transport: ['railway', 'ferry_terminal', 'aerialway'],
  commerce: ['shop', 'grocery', 'restaurant', 'cafe', 'bar', 'lodging'],
} as const;
export type PoiGroup = keyof typeof POI_GROUPS;

/** Colours that aren't tied to one layer. */
export interface Palette {
  paper: string;
  water: string;
  waterLines: string;
  label: string;
  waterLabel: string;
  halo: string;
}

export interface Layers {
  motorway: LineStyle & { double: boolean };
  major: LineStyle;
  minor: LineStyle;
  service: LineStyle;
  path: LineStyle;
  rail: LineStyle & { ties: boolean };
  waterway: LineStyle;
  boundary: LineStyle;
  runway: LineStyle & { taxiways: boolean };
  building: AreaStyle & { houses: boolean };
  landuse: AreaStyle;
  industrial: AreaStyle;
  park: AreaStyle;
  institution: AreaStyle; // schools, colleges, hospitals, libraries
  recreation: AreaStyle; // pitches, playgrounds, tracks, stadiums
  airport: AreaStyle; // airport grounds, aprons, runway surfaces
  grass: AreaStyle;
  wood: AreaStyle;
  wetland: AreaStyle;
  roadDetail: Detail; // more = zoom-12 streets from zoom 8; all = every zoom-14 road from zoom 10
}

export type Quality = 0.5 | 0.75 | 1 | 2;

/** original: stock OpenFreeMap style; vintage: our style, whole map; preview: the poster as exported. */
export type Mode = 'original' | 'vintage' | 'preview';

export interface Settings {
  mode: Mode;
  previewQuality: Quality; // on-screen pixel ratio; exports always render at full size
  palette: Palette;
  adjust: Adjust; // global colour adjustments (colors.ts)
  water: {
    enabled: boolean;
    inland: boolean; // include lakes/rivers polygons, not just ocean
    fillOpacity: number;
    spacing: number; // px between first rings
    growth: number; // spacing multiplier per ring (1 = even)
    lineWidth: number;
    rings: number;
    falloff: number; // fade exponent toward the last ring
    opacity: number;
    shoreWidth: number;
    jitter: number; // hand-drawn wobble, fraction of spacing
    jitterScale: number; // wobble wavelength in px
  };
  layers: Layers;
  labels: {
    placeFont: string;
    capitalFont: string;
    cityFont: string;
    waterFont: string;
    streetFont: string;
    uppercase: boolean;
    letterSpacing: number; // em
    haloWidth: number; // distance the halo extends from the letters, px
    haloBlur: number; // px
    haloOpacity: number;
    framePadding: number; // px kept between labels and the poster edge
    maxShift: number; // px a label may be nudged to fit; further out and it's hidden
    padding: number; // px of space MapLibre keeps around each label (lower = denser)
    allowOverlap: boolean; // show every label even when they collide
    detail: Detail; // more = zoom-11 suburbs and hamlets; all = every zoom-14 name
    searchedName: string; // last searched place; its label is drawn searchedScale× larger
    searchedScale: number;
    placeCurve: number; // -1..1 arc applied to place labels
    waterCurve: number; // -1..1 arc applied to water and island labels
    capital: LabelClass;
    city: LabelClass;
    town: LabelClass;
    village: LabelClass;
    suburb: LabelClass;
    water: LabelClass;
    street: LabelClass;
    island: LabelClass;
    poi: LabelClass;
    poiFont: string;
    poiMarker: boolean;
    poiGroups: Record<PoiGroup, boolean>;
  };
  paper: {
    grain: number; // 0..1
    grainSize: number; // px
  };
  export: {
    width: number;
    height: number;
    unit: 'in' | 'cm';
    dpi: number;
    showFrame: boolean;
  };
  /** Margins and their text (poster.ts); lengths in the export unit, sizes in points. */
  poster: {
    margins: { top: number; bottom: number; left: number; right: number };
    border: 'none' | 'single' | 'double';
    borderWidth: number; // pt
    title: {
      show: boolean;
      text: string; // empty = the searched place
      subtitle: string;
      font: string;
      size: number; // pt
      subtitleSize: number; // pt
      letterSpacing: number; // em
      uppercase: boolean;
      align: 'left' | 'center' | 'right';
      offset: number; // pt, nudges the title block down (+) or up (-)
    };
    footer: {
      attribution: boolean;
      attributionText: string; // empty = OpenStreetMap / OpenFreeMap credit
      date: boolean;
      dateText: string; // empty = current month and year
      font: string;
      size: number; // pt
      offset: number; // pt between the map's border and the footer text
    };
  };
  /** Where a searched place lands in the map area: offsets are % of the distance from centre to edge. */
  target: {
    offset: boolean;
    up: number;
    right: number;
    at: [number, number] | null; // last searched place
  };
  view: {
    center: [number, number];
    zoom: number;
    bearing: number;
  };
}

/** Bundled fonts; fonts added from Google Fonts are listed in /fonts/fonts.json. */
export const BUNDLED_FONTS = [
  'IM Fell English Regular',
  'IM Fell English Italic',
  'IM Fell English SC Regular',
  'IM Fell DW Pica Regular',
  'IM Fell DW Pica Italic',
  'Old Standard TT Regular',
  'Old Standard TT Italic',
  'Old Standard TT Bold',
  'Libre Caslon Text Regular',
  'Libre Caslon Text Italic',
];

const line = (show: boolean, color: string, opacity = 1, extra: Partial<LineStyle> = {}): LineStyle => ({
  show,
  color,
  width: 1,
  opacity,
  dash: 'solid',
  minzoom: 0,
  minWidth: 0,
  ...extra,
});

const area = (show: boolean, fill: string, fillOpacity: number, extra: Partial<AreaStyle> = {}): AreaStyle => ({
  show,
  fill,
  fillOpacity,
  pattern: 'none',
  patternColor: '#3a2e21',
  patternOpacity: 0.5,
  patternSpacing: 4,
  patternWidth: 0.5,
  outline: false,
  outlineColor: '#3a2e21',
  outlineWidth: 0.5,
  outlineOpacity: 0.6,
  outlineDash: 'solid',
  minzoom: 0,
  ...extra,
});

const label = (show: boolean, size: number, minzoom: number): LabelClass => ({ show, size, minzoom });

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A theme sets the global palette plus the colours of every layer. */
interface Theme {
  palette: Palette;
  layers: DeepPartial<Layers>;
}

function themeLayers(c: {
  ink: string;
  road: string;
  landuse: string;
  park: string;
  wood: string;
  building: string;
  boundary: string;
  river: string;
  institution?: string;
}): DeepPartial<Layers> {
  const lines = (color: string) => ({ color });
  const areaC = (fill: string, ink = c.ink) => ({ fill, patternColor: ink, outlineColor: ink });
  return {
    motorway: lines(c.road),
    major: lines(c.road),
    minor: lines(c.road),
    service: lines(c.road),
    path: lines(c.road),
    rail: lines(c.ink),
    waterway: lines(c.river),
    boundary: lines(c.boundary),
    runway: lines(c.ink),
    building: areaC(c.building),
    landuse: areaC(c.landuse),
    industrial: areaC(c.landuse),
    park: areaC(c.park),
    institution: areaC(c.institution ?? c.park),
    recreation: areaC(c.park),
    airport: areaC(c.landuse),
    grass: areaC(c.park),
    wood: areaC(c.wood),
    wetland: areaC(c.park, c.river),
  };
}

export const THEMES: Record<string, Theme> = {
  'Sepia 1875': {
    palette: { paper: '#e9d8b0', water: '#e7d5ad', waterLines: '#3f3427', label: '#231b13', waterLabel: '#3a2f22', halo: '#e9d8b0' },
    layers: themeLayers({
      ink: '#33291e',
      road: '#33291e',
      landuse: '#c9a56b',
      park: '#d6c393',
      wood: '#cdbb8c',
      building: '#a8865a',
      boundary: '#5e4c37',
      river: '#3f3427',
      institution: '#cfd2a4',
    }),
  },
  'Faded Blueprint': {
    palette: { paper: '#2b4f78', water: '#244668', waterLines: '#c9d8e8', label: '#f1f5f9', waterLabel: '#d5e2ee', halo: '#2b4f78' },
    layers: themeLayers({
      ink: '#e3ecf4',
      road: '#e3ecf4',
      landuse: '#335a84',
      park: '#30587f',
      wood: '#30587f',
      building: '#3a6290',
      boundary: '#a9c0d8',
      river: '#c9d8e8',
    }),
  },
  'Monochrome Ink': {
    palette: { paper: '#f6f3ec', water: '#f6f3ec', waterLines: '#1a1a1a', label: '#111111', waterLabel: '#222222', halo: '#f6f3ec' },
    layers: themeLayers({
      ink: '#141414',
      road: '#141414',
      landuse: '#e6e2d8',
      park: '#e8e5dc',
      wood: '#e4e1d7',
      building: '#cfcac0',
      boundary: '#555555',
      river: '#1a1a1a',
    }),
  },
  'Nautical Chart': {
    palette: { paper: '#f1ead6', water: '#dfe6e0', waterLines: '#4f6d75', label: '#1e2b33', waterLabel: '#2f5561', halo: '#f1ead6' },
    layers: themeLayers({
      ink: '#2c3438',
      road: '#3b3a36',
      landuse: '#e6d6b0',
      park: '#d9dcb6',
      wood: '#cfd5ae',
      building: '#cdb68d',
      boundary: '#a3473a',
      river: '#4f6d75',
    }),
  },
  'Antique Atlas': {
    palette: { paper: '#efe2c2', water: '#d7e1d5', waterLines: '#5b6f63', label: '#2b2116', waterLabel: '#3e5546', halo: '#efe2c2' },
    layers: themeLayers({
      ink: '#3a2c20',
      road: '#6b3f2a',
      landuse: '#ecc7b4',
      park: '#cfd9a6',
      wood: '#bccf97',
      building: '#d9a78f',
      boundary: '#b5503a',
      river: '#5b6f63',
    }),
  },
  'Ink on Parchment': {
    palette: { paper: '#dcc89c', water: '#d6c194', waterLines: '#2a1d10', label: '#1c130a', waterLabel: '#2a1d10', halo: '#dcc89c' },
    layers: themeLayers({
      ink: '#24180c',
      road: '#24180c',
      landuse: '#c3a671',
      park: '#c9b483',
      wood: '#bda877',
      building: '#9b7a4b',
      boundary: '#4a3620',
      river: '#2a1d10',
    }),
  },
  'Midnight Engraving': {
    palette: { paper: '#1d1f24', water: '#191b20', waterLines: '#c9b98f', label: '#efe3c2', waterLabel: '#cdbf98', halo: '#1d1f24' },
    layers: themeLayers({
      ink: '#d8c9a0',
      road: '#d8c9a0',
      landuse: '#2a2c31',
      park: '#262a26',
      wood: '#23271f',
      building: '#3a3833',
      boundary: '#8b7c5a',
      river: '#c9b98f',
    }),
  },
  Cyanotype: {
    palette: { paper: '#1f3f73', water: '#1b3866', waterLines: '#e8eef8', label: '#f6f8fc', waterLabel: '#dfe8f5', halo: '#1f3f73' },
    layers: themeLayers({
      ink: '#eef3fa',
      road: '#eef3fa',
      landuse: '#28497f',
      park: '#25477b',
      wood: '#24457a',
      building: '#36598f',
      boundary: '#b8cbe6',
      river: '#e8eef8',
    }),
  },
  'Woodblock Indigo': {
    palette: { paper: '#f2ead8', water: '#dfe3e6', waterLines: '#27466b', label: '#1d2a3d', waterLabel: '#27466b', halo: '#f2ead8' },
    layers: themeLayers({
      ink: '#1f2d42',
      road: '#1f2d42',
      landuse: '#e9c9b8',
      park: '#d6dcc2',
      wood: '#c3cdb0',
      building: '#d79a85',
      boundary: '#c0392b',
      river: '#27466b',
    }),
  },
  'Survey Khaki': {
    palette: { paper: '#e6dfc4', water: '#d4d8c4', waterLines: '#4d5a3f', label: '#262a1c', waterLabel: '#3f4a32', halo: '#e6dfc4' },
    layers: themeLayers({
      ink: '#2f3323',
      road: '#5b3d26',
      landuse: '#d6c79b',
      park: '#c6cc9c',
      wood: '#b3bd89',
      building: '#b9a172',
      boundary: '#8a3b2a',
      river: '#4d5a3f',
    }),
  },
  'Hand-tinted': {
    palette: { paper: '#efe3c4', water: '#cbd6c9', waterLines: '#3e5a5a', label: '#2e241b', waterLabel: '#2f4848', halo: '#efe3c4' },
    layers: themeLayers({
      ink: '#3b2f25',
      road: '#5a3b2a',
      landuse: '#e9c9b0',
      park: '#c9d3a2',
      wood: '#bccb94',
      building: '#ddb79a',
      boundary: '#a2452f',
      river: '#3e5a5a',
    }),
  },
};

// Deep merge that keeps only known keys, so old presets pick up new fields.
function merge<T>(base: T, over: unknown): T {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return (over === undefined || (over !== null && typeof over === 'object' && !Array.isArray(over)) ? base : over) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (over && typeof over === 'object') {
    for (const [k, v] of Object.entries(over)) {
      if (k in out) out[k] = merge(out[k], v);
    }
  }
  return out as T;
}

export function applyTheme(s: Settings, theme: Theme): Settings {
  return {
    ...s,
    palette: { ...theme.palette },
    layers: merge(s.layers, theme.layers),
  };
}

const BASE_LAYERS: Layers = {
  motorway: { ...line(true, '#000', 1), double: true },
  major: line(true, '#000', 0.95),
  minor: line(true, '#000', 0.8, { minWidth: 0.35 }),
  service: line(true, '#000', 0.6, { minzoom: 13 }),
  path: line(false, '#000', 0.6, { dash: 'dashed', minzoom: 13 }),
  rail: { ...line(true, '#000', 0.9), ties: true },
  waterway: line(true, '#000', 0.9),
  boundary: line(true, '#000', 0.6, { dash: 'dash-dot' }),
  runway: { ...line(true, '#000', 0.8, { minzoom: 10 }), taxiways: true },
  building: { ...area(true, '#000', 0.55, { outline: true, outlineWidth: 0.4, outlineOpacity: 0.7, minzoom: 13 }), houses: true },
  landuse: area(true, '#000', 0.32, { pattern: 'hatch', patternOpacity: 0.14, patternSpacing: 3 }),
  industrial: area(true, '#000', 0.3, { pattern: 'crosshatch', patternOpacity: 0.15, patternSpacing: 4 }),
  park: area(true, '#000', 0.6, { outline: true, outlineDash: 'dotted', outlineOpacity: 0.5, minzoom: 0 }),
  institution: area(true, '#000', 0.75, { outline: true, outlineWidth: 0.5, outlineOpacity: 0.45 }),
  recreation: area(true, '#000', 0.5, { outline: true, outlineDash: 'dotted', outlineOpacity: 0.4, minzoom: 12 }),
  airport: area(true, '#000', 0.35, { pattern: 'dots-offset', patternOpacity: 0.25, patternSpacing: 5, minzoom: 9 }),
  grass: area(true, '#000', 0.35),
  wood: area(true, '#000', 0.45, { pattern: 'stipple', patternOpacity: 0.35, patternSpacing: 5, patternWidth: 0.7 }),
  wetland: area(true, '#000', 0.3, { pattern: 'dots', patternOpacity: 0.45, patternSpacing: 4, patternWidth: 0.8 }),
  roadDetail: 'standard',
};

export const DEFAULTS: Settings = {
  mode: 'vintage',
  previewQuality: 1,
  palette: { ...THEMES['Sepia 1875'].palette },
  adjust: { brightness: 0, contrast: 0, saturation: 0, hue: 0, warmth: 0, fade: 0 },
  water: {
    enabled: true,
    inland: true,
    fillOpacity: 1,
    spacing: 1.7,
    growth: 1.035,
    lineWidth: 0.4,
    rings: 45,
    falloff: 0.8,
    opacity: 0.85,
    shoreWidth: 1.1,
    jitter: 0.25,
    jitterScale: 18,
  },
  layers: merge(BASE_LAYERS, THEMES['Sepia 1875'].layers),
  labels: {
    placeFont: 'Old Standard TT Bold',
    capitalFont: 'Old Standard TT Bold',
    cityFont: 'Old Standard TT Bold',
    waterFont: 'IM Fell English Italic',
    streetFont: 'IM Fell DW Pica Regular',
    uppercase: true,
    letterSpacing: 0.2,
    haloWidth: 1.5,
    haloBlur: 0,
    haloOpacity: 1,
    framePadding: 10,
    maxShift: 120,
    padding: 4,
    allowOverlap: false,
    detail: 'standard',
    searchedName: '',
    searchedScale: 1.4,
    placeCurve: 0,
    waterCurve: 0,
    capital: label(true, 24, 3),
    city: label(true, 17, 4),
    town: label(true, 14, 7),
    village: label(true, 10, 9),
    suburb: label(true, 9.5, 11),
    water: label(true, 13, 0),
    street: label(false, 9, 13),
    island: label(true, 10, 10),
    poi: label(false, 8, 14),
    poiFont: 'IM Fell English Italic',
    poiMarker: true,
    poiGroups: { education: true, health: true, worship: true, civic: true, culture: true, parks: false, transport: true, commerce: false },
  },
  paper: {
    grain: 0.3,
    grainSize: 1.5,
  },
  export: {
    width: 18,
    height: 24,
    unit: 'in',
    dpi: 300,
    showFrame: true,
  },
  poster: {
    margins: { top: 2.6, bottom: 1.2, left: 1.2, right: 1.2 },
    border: 'double',
    borderWidth: 1,
    title: {
      show: true,
      text: '',
      subtitle: '',
      font: 'Old Standard TT Bold',
      size: 66,
      subtitleSize: 22,
      letterSpacing: 0.35,
      uppercase: true,
      align: 'center',
      offset: 0,
    },
    footer: {
      attribution: true,
      attributionText: '',
      date: true,
      dateText: '',
      font: 'IM Fell English Italic',
      size: 13,
      offset: 9,
    },
  },
  target: { offset: false, up: 33, right: 0, at: null },
  view: {
    center: [-71.03, 42.33],
    zoom: 11.2,
    bearing: 0,
  },
};

const STORAGE_KEY = 'map-art:settings:v2';
const PRESETS_KEY = 'map-art:presets:v2';

export function withDefaults(partial: unknown): Settings {
  return merge(structuredClone(DEFAULTS), partial);
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return withDefaults(JSON.parse(raw));
  } catch {}
  return structuredClone(DEFAULTS);
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

export function loadPresets(): Record<string, Settings> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function savePresets(p: Record<string, Settings>) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {}
}

export function exportPixels(s: Settings) {
  const perUnit = s.export.unit === 'in' ? s.export.dpi : s.export.dpi / 2.54;
  return {
    width: Math.round(s.export.width * perUnit),
    height: Math.round(s.export.height * perUnit),
  };
}
