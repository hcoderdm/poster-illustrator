import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import type { FeatureCollection } from 'geojson';
import { BUNDLED_FONTS, DEFAULTS, DETAILS, POI_GROUPS, THEMES, applyTheme, exportPixels, loadPresets, loadSettings, savePresets, saveSettings, withDefaults, type Mode, type PoiGroup, type Quality, type Settings } from './settings';
import { effective } from './colors';
import { buildStyle, EMPTY_FC, ORIGINAL_STYLE_URL, type StyleExtras } from './style/vintage';
import { attachPatterns } from './style/patterns';
import { registerTileProtocols } from './style/tiles';
import { fitLabels } from './labels/fit';
import { WaterPreview, type Corners } from './waterlines/render';
import { drawGrain } from './paper';
import { Panel, el, setPath, type ChangeKind, type Control, type Section } from './ui';
import { download, maxCanvasDim, renderPoster } from './export';
import { createSearch } from './search';
import { posterLayout, drawDecor, currentMonthYear, DEFAULT_ATTRIBUTION, type Rect } from './poster';
import { createFontPicker } from './fontpicker';
import { loadFonts } from './fonts';

let settings: Settings = loadSettings();
const S = () => settings;

const stage = document.getElementById('stage')!;
const paper = document.getElementById('paper')!;
const grainCanvas = document.getElementById('grain') as HTMLCanvasElement;
const frameEl = document.getElementById('frame')!;
const decorCanvas = document.getElementById('decor') as HTMLCanvasElement;

// Fonts: bundled ones plus anything added from Google Fonts (public/fonts/fonts.json).
let fonts = [...BUNDLED_FONTS];
try {
  const list: string[] = await (await fetch('/fonts/fonts.json')).json();
  fonts = [...new Set([...fonts, ...list])];
} catch {}
// Labels are rendered from these web fonts, so they must be ready before the map draws.
await loadFonts(fonts);

// Settings with the global colour adjustments baked in; everything visual reads this.
const E = () => effective(settings);

// Point labels are redrawn from these computed copies (labels/fit.ts); the water raster comes from WaterPreview.
let fitted: FeatureCollection = EMPTY_FC;
let waterImage: StyleExtras['water'];

const currentStyle = () => (settings.mode === 'original' ? ORIGINAL_STYLE_URL : buildStyle(E(), { labels: { mode: 'ghost', data: fitted }, water: waterImage }));

registerTileProtocols();

const map = new maplibregl.Map({
  container: 'map',
  style: currentStyle(),
  center: settings.view.center,
  zoom: settings.view.zoom,
  bearing: settings.view.bearing,
  attributionControl: { compact: true },
  pixelRatio: settings.previewQuality,
  maxCanvasSize: [16384, 16384],
  fadeDuration: 0,
});
attachPatterns(map);
if (import.meta.env.DEV) Object.assign(window, { __map: map });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
map.touchPitch.disable();
map.dragRotate.disable();

// --- poster frame ---------------------------------------------------------
const posterNow = () => posterLayout(settings, stage.clientWidth, stage.clientHeight);
const frameRect = () => posterNow().map;

function layoutFrame() {
  const { poster, map } = posterNow();
  // Preview frames the whole poster; Styled frames the map area.
  const f = settings.mode === 'preview' ? poster : map;
  Object.assign(frameEl.style, {
    left: `${f.x}px`,
    top: `${f.y}px`,
    width: `${f.width}px`,
    height: `${f.height}px`,
    display: settings.export.showFrame || settings.mode === 'preview' ? 'block' : 'none',
  });
}

function drawPreviewGrain() {
  const original = settings.mode === 'original';
  grainCanvas.style.display = original ? 'none' : '';
  if (original) return;
  const q = settings.previewQuality;
  const w = stage.clientWidth, h = stage.clientHeight;
  grainCanvas.width = Math.round(w * q);
  grainCanvas.height = Math.round(h * q);
  grainCanvas.style.width = `${w}px`;
  grainCanvas.style.height = `${h}px`;
  const ctx = grainCanvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, grainCanvas.width, grainCanvas.height);
  const { poster, map: m } = posterNow();
  drawGrain(ctx, grainCanvas.width, grainCanvas.height, q, settings, [-poster.x, -poster.y]);
  // In Preview the grain covers only the map, as in the export (margins stay white).
  grainCanvas.style.clipPath = settings.mode === 'preview' ? `inset(${m.y}px ${w - m.x - m.width}px ${h - m.y - m.height}px ${m.x}px)` : '';
}

// Margins, border, title and footer over the map in Preview (the export uses the same drawDecor).
let decorGen = 0;
async function drawPreviewDecor() {
  const gen = ++decorGen;
  const q = settings.previewQuality;
  const w = stage.clientWidth, h = stage.clientHeight;
  const c = document.createElement('canvas');
  c.width = Math.round(w * q);
  c.height = Math.round(h * q);
  if (settings.mode === 'preview') {
    const { poster, map, pxPerInch } = posterNow();
    const scale = (r: Rect) => ({ x: r.x * q, y: r.y * q, width: r.width * q, height: r.height * q });
    await drawDecor(c.getContext('2d')!, E(), scale(poster), scale(map), pxPerInch * q);
  }
  if (gen !== decorGen) return;
  decorCanvas.width = c.width;
  decorCanvas.height = c.height;
  decorCanvas.style.width = `${w}px`;
  decorCanvas.style.height = `${h}px`;
  decorCanvas.getContext('2d')!.drawImage(c, 0, 0);
}

// --- water ----------------------------------------------------------------
// isStyleLoaded() also waits for tiles, so the layer list is what tells us the style itself is ready.
function syncWater() {
  if (!waterImage || settings.mode === 'original' || !map.getLayer('waterway')) return;
  const src = map.getSource('waterlines') as maplibregl.ImageSource | undefined;
  if (src) src.updateImage(waterImage);
  else {
    map.addSource('waterlines', { type: 'image', ...waterImage });
    map.addLayer({ id: 'waterlines', type: 'raster', source: 'waterlines', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'waterway');
  }
}
map.on('style.load', syncWater);

const water = new WaterPreview(
  map,
  E,
  () => {
    const f = frameRect();
    return [f.x, f.y];
  },
  (url: string, coordinates: Corners) => {
    waterImage = { url, coordinates };
    syncWater();
  },
);

// --- settings changes -----------------------------------------------------
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveSettings(settings), 300);
}

let styleTimer = 0;
function applyStyle(full = false) {
  cancelAnimationFrame(styleTimer);
  styleTimer = requestAnimationFrame(() => {
    if (settings.mode === 'original' && !full) return;
    map.setStyle(currentStyle(), { diff: !full });
  });
}

const searchedSyncs: (() => void)[] = [];

function apply(kind: ChangeKind | 'all' | 'init') {
  const is = (...kinds: (ChangeKind | 'all' | 'init')[]) => kinds.includes(kind);
  searchedSyncs.forEach((f) => f());
  if (is('palette', 'all', 'init')) paper.style.background = E().palette.paper;
  if (is('style', 'palette')) applyStyle();
  if (is('mode', 'quality', 'all')) {
    // Full rebuild: switches style, and regenerates fill patterns at the new pixel ratio.
    if (map.getPixelRatio() !== settings.previewQuality) map.setPixelRatio(settings.previewQuality);
    applyStyle(true);
  }
  if (is('mode', 'quality', 'all', 'init')) syncModeUI();
  // The water's wobble noise is anchored to the map area, so frame changes re-engrave too.
  if (is('mask', 'all')) water.update(true);
  else if (is('water', 'palette', 'mode', 'quality', 'frame')) water.update(false);
  if (is('grain', 'frame', 'mode', 'quality', 'all', 'init')) drawPreviewGrain();
  if (is('frame', 'mode', 'all', 'init')) {
    layoutFrame();
    updateExportInfo();
  }
  if (!is('water', 'mask', 'grain', 'none')) drawPreviewDecor();
  if (is('style', 'palette', 'mode', 'quality', 'frame', 'all')) requestFit();
  if (kind !== 'init') persist();
}

// --- computed labels ------------------------------------------------------
// Runs on the next 'idle' after a move or style change; the flag stops setData's own idle from looping.
let fitPending = false;
function requestFit() {
  fitPending = true;
  map.triggerRepaint();
}
map.on('idle', async () => {
  if (!fitPending || settings.mode === 'original') return;
  fitPending = false;
  const preview = settings.mode === 'preview';
  const area = preview ? frameRect() : { x: 0, y: 0, width: stage.clientWidth, height: stage.clientHeight };
  fitted = await fitLabels(map, area, E(), preview);
  (map.getSource('fitted') as maplibregl.GeoJSONSource | undefined)?.setData(fitted);
});
map.on('moveend', () => {
  const c = map.getCenter();
  settings.view = { center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +map.getZoom().toFixed(3), bearing: map.getBearing() };
  persist();
  requestFit();
});

new ResizeObserver(() => {
  map.resize();
  layoutFrame();
  drawPreviewGrain();
  drawPreviewDecor();
  requestFit();
}).observe(stage);

// --- header: search, view mode, resolution, zoom ----------------------------
const header = document.getElementById('header-tools')!;
header.append(
  createSearch(map, frameRect, stage, (name) => {
    settings.labels.searchedName = name;
    panel.refresh();
    apply('style');
  }),
);

const MODES: [Mode, string, string][] = [
  ['original', 'Original', 'OpenFreeMap’s standard style, without any of the settings below'],
  ['vintage', 'Styled', 'Your style on the full live map'],
  ['preview', 'Preview', 'Exactly what will be exported: only the poster, labels fitted inside the frame'],
];
const modeButtons = MODES.map(([m, label, title]) => {
  const b = el('button', { type: 'button', title }, label) as HTMLButtonElement;
  b.onclick = () => {
    if (settings.mode === m) return;
    settings.mode = m;
    apply('mode');
  };
  return b;
});
const qualitySel = el(
  'select',
  { title: 'Preview resolution. Exports always render at full print size.' },
  ...([
    [0.5, 'Low (0.5×)'],
    [0.75, 'Medium (0.75×)'],
    [1, 'Standard (1×)'],
    [2, 'Sharp (2×)'],
  ] as const).map(([v, l]) => el('option', { value: v }, l)),
) as HTMLSelectElement;
qualitySel.onchange = () => {
  settings.previewQuality = +qualitySel.value as Quality;
  apply('quality');
};
const zoomBox = el('input', { type: 'number', class: 'zoom-box', min: 0, max: 22, step: 0.1 }) as HTMLInputElement;
const syncZoom = () => {
  if (document.activeElement !== zoomBox) zoomBox.value = map.getZoom().toFixed(2);
};
map.on('zoom', syncZoom);
syncZoom();
zoomBox.oninput = () => {
  const z = parseFloat(zoomBox.value);
  if (Number.isFinite(z)) map.jumpTo({ zoom: Math.max(0, Math.min(22, z)) });
};
zoomBox.onblur = syncZoom;
zoomBox.onkeydown = (e) => e.key === 'Enter' && zoomBox.blur();

header.append(
  el(
    'div',
    { class: 'header-row' },
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'View mode' }, ...modeButtons),
    el('label', { class: 'inline' }, 'Resolution', qualitySel),
    el('label', { class: 'inline', title: 'Exact map zoom; type a value or use the arrows' }, 'Zoom', zoomBox),
  ),
);

function syncModeUI() {
  modeButtons.forEach((b, i) => b.classList.toggle('active', MODES[i][0] === settings.mode));
  qualitySel.value = String(settings.previewQuality);
  document.body.classList.toggle('original', settings.mode === 'original');
  document.body.classList.toggle('preview', settings.mode === 'preview');
}

// --- panel ----------------------------------------------------------------
const exportInfo = el('div', { class: 'export-info' });
const exportBtn = el('button', { class: 'primary' }, 'Export PNG') as HTMLButtonElement;
const exportStatus = el('div', { class: 'export-status' });
const maxDim = maxCanvasDim();

function updateExportInfo() {
  const { width, height } = exportPixels(settings);
  const mp = ((width * height) / 1e6).toFixed(1);
  const over = width > maxDim || height > maxDim;
  exportInfo.innerHTML =
    `Output: <b>${width} × ${height}px</b> (${mp} MP)` +
    (settings.mode === 'original' ? '<br><i>Original map style will be exported</i>' : '') +
    (over ? `<br><span class="warn">Exceeds GPU limit of ${maxDim}px per side</span>` : '');
  exportBtn.disabled = over;
}

exportBtn.onclick = async () => {
  exportBtn.disabled = true;
  const f = frameRect();
  const t0 = performance.now();
  try {
    // Labels are fitted from what's on screen now, so the export matches Preview.
    const labels = settings.mode === 'original' ? undefined : await fitLabels(map, f, E());
    const blob = await renderPoster(settings, posterNow(), (m) => (exportStatus.textContent = m), labels);
    const { width, height } = exportPixels(settings);
    const e = settings.export;
    download(blob, `map-${e.width}x${e.height}${e.unit}-${e.dpi}dpi-${width}x${height}.png`);
    exportStatus.textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)}s (${(blob.size / 1e6).toFixed(1)} MB)`;
  } catch (err) {
    console.error(err);
    exportStatus.textContent = `Export failed: ${(err as Error).message}`;
  } finally {
    updateExportInfo();
  }
};

function setSettings(next: Settings) {
  settings = withDefaults(next);
  panel.refresh();
  map.jumpTo({ center: settings.view.center, zoom: settings.view.zoom, bearing: settings.view.bearing });
  apply('all');
}

function presetControls(): HTMLElement {
  const themeSel = el('select', {}, el('option', { value: '' }, 'Apply colour theme…'), ...Object.keys(THEMES).map((k) => el('option', { value: k }, k))) as HTMLSelectElement;
  themeSel.onchange = () => {
    if (!themeSel.value) return;
    settings = applyTheme(settings, THEMES[themeSel.value]);
    themeSel.value = '';
    panel.refresh();
    apply('palette');
  };

  const savedSel = el('select') as HTMLSelectElement;
  const fillSaved = () => {
    const presets = loadPresets();
    savedSel.replaceChildren(el('option', { value: '' }, 'Saved presets…'), ...Object.keys(presets).sort().map((k) => el('option', { value: k }, k)));
  };
  fillSaved();
  savedSel.onchange = () => {
    const p = loadPresets()[savedSel.value];
    if (p) setSettings(p);
  };

  const saveBtn = el('button', {}, 'Save as…') as HTMLButtonElement;
  saveBtn.onclick = () => {
    const name = prompt('Preset name', savedSel.value || 'My map');
    if (!name) return;
    const presets = loadPresets();
    presets[name] = structuredClone(settings);
    savePresets(presets);
    fillSaved();
    savedSel.value = name;
  };
  const delBtn = el('button', {}, 'Delete') as HTMLButtonElement;
  delBtn.onclick = () => {
    if (!savedSel.value || !confirm(`Delete preset “${savedSel.value}”?`)) return;
    const presets = loadPresets();
    delete presets[savedSel.value];
    savePresets(presets);
    fillSaved();
  };

  const exportJson = el('button', {}, 'Download JSON') as HTMLButtonElement;
  exportJson.onclick = () => download(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }), 'map-preset.json');
  const file = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' }) as HTMLInputElement;
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      setSettings(JSON.parse(await f.text()));
    } catch {
      alert('Could not read that preset file.');
    }
    file.value = '';
  };
  const importJson = el('button', {}, 'Load JSON') as HTMLButtonElement;
  importJson.onclick = () => file.click();
  const reset = el('button', {}, 'Reset all') as HTMLButtonElement;
  reset.onclick = () => {
    if (confirm('Reset all settings to defaults?')) setSettings({ ...structuredClone(DEFAULTS), view: settings.view });
  };

  return el(
    'div',
    { class: 'presets' },
    themeSel,
    savedSel,
    el('div', { class: 'btns' }, saveBtn, delBtn),
    el('div', { class: 'btns' }, exportJson, importJson, reset),
    file,
  );
}

const fontTargets = [
  { label: 'Capitals', path: 'labels.capitalFont' },
  { label: 'Cities', path: 'labels.cityFont' },
  { label: 'Towns', path: 'labels.placeFont' },
  { label: 'Water', path: 'labels.waterFont' },
  { label: 'Streets', path: 'labels.streetFont' },
  { label: 'Places of interest', path: 'labels.poiFont' },
  { label: 'Poster title', path: 'poster.title.font' },
  { label: 'Poster footer', path: 'poster.footer.font' },
];
const fontSelect = (path: string, label: string): Control => ({ type: 'select', path, label, options: () => fonts });

// Names the last searched place, with a button to stop enlarging it.
function searchedInfo(): HTMLElement {
  const text = el('span');
  const clear = el('button', { type: 'button' }, 'Clear') as HTMLButtonElement;
  clear.onclick = () => {
    settings.labels.searchedName = '';
    panel.refresh();
    apply('style');
  };
  const sync = () => {
    text.textContent = settings.labels.searchedName ? `“${settings.labels.searchedName}”` : 'Search for a place to enlarge its label.';
    clear.hidden = !settings.labels.searchedName;
  };
  searchedSyncs.push(sync);
  sync();
  return el('div', { class: 'searched-info' }, text, clear);
}

const fontPicker: Control = {
  type: 'custom',
  render: () =>
    createFontPicker({
      targets: fontTargets,
      onAdded: async (name, list) => {
        await loadFonts([name]);
        fonts = [...new Set([...fonts, ...list])];
        panel.refresh();
      },
      onAssign: (path, name) => {
        setPath(settings, path, name);
        panel.refresh();
        apply('style');
      },
    }),
};

const sections: Section[] = [
  { title: 'Presets & themes', controls: [{ type: 'custom', render: presetControls }] },
  {
    title: 'Poster size & export',
    open: true,
    controls: [
      { type: 'number', path: 'export.width', label: 'Width', step: 0.25 },
      { type: 'number', path: 'export.height', label: 'Height', step: 0.25 },
      { type: 'select', path: 'export.unit', label: 'Unit', options: ['in', 'cm'] },
      { type: 'number', path: 'export.dpi', label: 'DPI', min: 36, max: 1200, step: 1 },
      { type: 'toggle', path: 'export.showFrame', label: 'Show frame' },
      { type: 'custom', render: () => el('div', { class: 'export-box' }, exportInfo, exportBtn, exportStatus) },
    ],
  },
  {
    title: 'Poster layout',
    controls: [
      { type: 'note', text: 'Shown in Preview mode and the export. Lengths are in the poster unit; text sizes in points.' },
      { type: 'heading', text: 'Margins' },
      { type: 'number', path: 'poster.margins.top', label: 'Top', min: 0, step: 0.1 },
      { type: 'number', path: 'poster.margins.bottom', label: 'Bottom', min: 0, step: 0.1 },
      { type: 'number', path: 'poster.margins.left', label: 'Left', min: 0, step: 0.1 },
      { type: 'number', path: 'poster.margins.right', label: 'Right', min: 0, step: 0.1 },
      { type: 'heading', text: 'Border' },
      { type: 'select', path: 'poster.border', label: 'Style', options: ['none', 'single', 'double'] },
      { type: 'range', path: 'poster.borderWidth', label: 'Weight (pt)', min: 0.25, max: 6, step: 0.05 },
      { type: 'heading', text: 'Title' },
      { type: 'toggle', path: 'poster.title.show', label: 'Show' },
      { type: 'text', path: 'poster.title.text', label: 'Text', placeholder: () => settings.labels.searchedName || 'Searched place' },
      { type: 'text', path: 'poster.title.subtitle', label: 'Subtitle', placeholder: 'Optional' },
      fontSelect('poster.title.font', 'Font'),
      { type: 'range', path: 'poster.title.size', label: 'Size (pt)', min: 8, max: 300, step: 1 },
      { type: 'range', path: 'poster.title.subtitleSize', label: 'Subtitle (pt)', min: 6, max: 120, step: 1 },
      { type: 'range', path: 'poster.title.letterSpacing', label: 'Letter spacing', min: 0, max: 1.5, step: 0.01 },
      { type: 'toggle', path: 'poster.title.uppercase', label: 'Uppercase' },
      { type: 'select', path: 'poster.title.align', label: 'Align', options: ['left', 'center', 'right'] },
      { type: 'range', path: 'poster.title.offset', label: 'Nudge (pt)', min: -200, max: 200, step: 1 },
      { type: 'heading', text: 'Footer' },
      { type: 'toggle', path: 'poster.footer.attribution', label: 'Credits (left)' },
      { type: 'text', path: 'poster.footer.attributionText', label: 'Credit text', placeholder: DEFAULT_ATTRIBUTION },
      { type: 'note', text: 'Leave empty for the default credit, which follows each project’s print guidelines: OpenStreetMap with its ODbL licence and the printed URL openstreetmap.org/copyright, and “© OpenMapTiles” with openmaptiles.org. A custom credit should keep those parts and stay legible (about 8 pt or larger).' },
      { type: 'toggle', path: 'poster.footer.date', label: 'Date (right)' },
      { type: 'text', path: 'poster.footer.dateText', label: 'Date text', placeholder: () => currentMonthYear() },
      fontSelect('poster.footer.font', 'Font'),
      { type: 'range', path: 'poster.footer.size', label: 'Size (pt)', min: 5, max: 60, step: 0.5 },
      { type: 'range', path: 'poster.footer.offset', label: 'Gap below (pt)', min: 0, max: 144, step: 1 },
    ],
  },
  {
    title: 'Colour & paper',
    controls: [
      { type: 'heading', text: 'Overall adjustments' },
      { type: 'range', path: 'adjust.brightness', label: 'Brightness', min: -1, max: 1, step: 0.01 },
      { type: 'range', path: 'adjust.contrast', label: 'Contrast', min: -1, max: 1, step: 0.01 },
      { type: 'range', path: 'adjust.saturation', label: 'Saturation', min: -1, max: 1, step: 0.01 },
      { type: 'range', path: 'adjust.hue', label: 'Hue shift', min: -180, max: 180, step: 1 },
      { type: 'range', path: 'adjust.warmth', label: 'Warmth', min: -1, max: 1, step: 0.01 },
      { type: 'range', path: 'adjust.fade', label: 'Fade to paper', min: 0, max: 1, step: 0.01 },
      { type: 'heading', text: 'Base colours' },
      { type: 'color', path: 'palette.paper', label: 'Paper / land' },
      { type: 'color', path: 'palette.label', label: 'Labels & text' },
      { type: 'color', path: 'palette.waterLabel', label: 'Water labels' },
      { type: 'heading', text: 'Paper grain' },
      { type: 'range', path: 'paper.grain', label: 'Amount', min: 0, max: 1, step: 0.01 },
      { type: 'range', path: 'paper.grainSize', label: 'Size', min: 0.5, max: 6, step: 0.1 },
    ],
  },
  {
    title: 'Water',
    controls: [
      { type: 'heading', text: 'Engraved lines' },
      { type: 'toggle', path: 'water.enabled', label: 'Show' },
      { type: 'range', path: 'water.rings', label: 'Number of lines', min: 0, max: 200, step: 1 },
      { type: 'range', path: 'water.spacing', label: 'Spacing', min: 0.8, max: 15, step: 0.1 },
      { type: 'range', path: 'water.growth', label: 'Spacing growth', min: 1, max: 1.4, step: 0.005 },
      { type: 'range', path: 'water.lineWidth', label: 'Line width', min: 0.15, max: 4, step: 0.05 },
      { type: 'range', path: 'water.falloff', label: 'Fade-out', min: 0, max: 5, step: 0.05 },
      { type: 'range', path: 'water.opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
      { type: 'range', path: 'water.shoreWidth', label: 'Shoreline width', min: 0, max: 5, step: 0.05 },
      { type: 'range', path: 'water.jitter', label: 'Hand wobble', min: 0, max: 1.5, step: 0.01 },
      { type: 'range', path: 'water.jitterScale', label: 'Wobble size', min: 5, max: 300, step: 1 },
      { type: 'color', path: 'palette.waterLines', label: 'Colour' },
      { type: 'heading', text: 'Fill' },
      { type: 'color', path: 'palette.water', label: 'Tint' },
      { type: 'range', path: 'water.fillOpacity', label: 'Tint opacity', min: 0, max: 1, step: 0.01 },
      { type: 'toggle', path: 'water.inland', label: 'Lakes & rivers too' },
    ],
  },
  {
    title: 'Labels',
    controls: [
      { type: 'heading', text: 'Data' },
      { type: 'select', path: 'labels.detail', label: 'Label data', options: DETAILS },
      { type: 'note', text: 'standard: what each zoom normally includes. more: suburbs and hamlets at every zoom (from zoom 7). all: every neighbourhood and place of interest (from zoom 10), slower when zoomed out. Then lower each class’s Min zoom.' },
      { type: 'range', path: 'labels.padding', label: 'Spacing', min: 0, max: 30, step: 0.5 },
      { type: 'toggle', path: 'labels.allowOverlap', label: 'Allow overlaps' },
      { type: 'heading', text: 'Fonts' },
      fontSelect('labels.capitalFont', 'Capitals'),
      fontSelect('labels.cityFont', 'Cities'),
      fontSelect('labels.placeFont', 'Towns'),
      fontSelect('labels.waterFont', 'Water'),
      fontSelect('labels.streetFont', 'Streets'),
      fontSelect('labels.poiFont', 'Places of interest'),
      { type: 'group', label: 'Add a Google Font', controls: [fontPicker] },
      { type: 'heading', text: 'Style' },
      { type: 'toggle', path: 'labels.uppercase', label: 'Uppercase' },
      { type: 'range', path: 'labels.letterSpacing', label: 'Letter spacing', min: 0, max: 1.2, step: 0.01 },
      { type: 'range', path: 'labels.placeCurve', label: 'Curve: places', min: -1, max: 1, step: 0.01 },
      { type: 'range', path: 'labels.waterCurve', label: 'Curve: water', min: -1, max: 1, step: 0.01 },
      { type: 'heading', text: 'Halo' },
      { type: 'range', path: 'labels.haloWidth', label: 'Distance', min: 0, max: 8, step: 0.1 },
      { type: 'range', path: 'labels.haloBlur', label: 'Blur radius', min: 0, max: 8, step: 0.1 },
      { type: 'range', path: 'labels.haloOpacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
      { type: 'color', path: 'palette.halo', label: 'Colour' },
      { type: 'heading', text: 'Fitting to the frame' },
      { type: 'range', path: 'labels.framePadding', label: 'Edge padding', min: 0, max: 60, step: 1 },
      { type: 'range', path: 'labels.maxShift', label: 'Max nudge', min: 0, max: 400, step: 5 },
      { type: 'heading', text: 'Searched place' },
      { type: 'custom', render: searchedInfo },
      { type: 'range', path: 'labels.searchedScale', label: 'Size', min: 0.5, max: 4, step: 0.05 },
      { type: 'heading', text: 'Classes' },
      { type: 'labelClass', path: 'labels.capital', label: 'Capitals' },
      { type: 'labelClass', path: 'labels.city', label: 'Cities' },
      { type: 'labelClass', path: 'labels.town', label: 'Towns' },
      { type: 'labelClass', path: 'labels.village', label: 'Villages' },
      { type: 'labelClass', path: 'labels.suburb', label: 'Neighbourhoods' },
      { type: 'labelClass', path: 'labels.island', label: 'Islands' },
      { type: 'labelClass', path: 'labels.water', label: 'Water bodies' },
      { type: 'labelClass', path: 'labels.street', label: 'Streets' },
      { type: 'labelClass', path: 'labels.poi', label: 'Places of interest' },
      {
        type: 'group',
        label: 'Place-of-interest options',
        controls: [
          { type: 'toggle', path: 'labels.poiMarker', label: 'Dot marker' },
          ...(Object.keys(POI_GROUPS) as PoiGroup[]).map((g): Control => ({ type: 'toggle', path: `labels.poiGroups.${g}`, label: g[0].toUpperCase() + g.slice(1) })),
          { type: 'note', text: 'Place-of-interest names only exist in zoom-14 data; set Label data to “all” to see them zoomed out.' },
        ],
      },
    ],
  },
  {
    title: 'Roads & lines',
    controls: [
      { type: 'heading', text: 'Data' },
      { type: 'select', path: 'layers.roadDetail', label: 'Road data', options: DETAILS },
      { type: 'note', text: 'Residential streets start at zoom 12 in the map data; service roads (school drives, parking aisles) and paths at 13. more: residential streets from zoom 8. all: every road and path from zoom 10, slower when zoomed out. Then lower each type’s Min zoom and raise its Min width.' },
      { type: 'heading', text: 'Layers' },
      { type: 'line', path: 'layers.motorway', label: 'Highways', extras: [{ type: 'toggle', path: 'layers.motorway.double', label: 'Double-ruled' }] },
      { type: 'line', path: 'layers.major', label: 'Major roads' },
      { type: 'line', path: 'layers.minor', label: 'Residential streets' },
      { type: 'line', path: 'layers.service', label: 'Service roads & drives' },
      { type: 'line', path: 'layers.path', label: 'Paths & tracks' },
      { type: 'line', path: 'layers.rail', label: 'Railways', extras: [{ type: 'toggle', path: 'layers.rail.ties', label: 'Cross-ties' }] },
      { type: 'line', path: 'layers.runway', label: 'Runways', extras: [{ type: 'toggle', path: 'layers.runway.taxiways', label: 'Taxiways' }] },
      { type: 'line', path: 'layers.waterway', label: 'Rivers & streams' },
      { type: 'line', path: 'layers.boundary', label: 'Boundaries' },
    ],
  },
  {
    title: 'Areas & buildings',
    controls: [
      {
        type: 'area',
        path: 'layers.building',
        label: 'Buildings',
        extras: [{ type: 'toggle', path: 'layers.building.houses', label: 'Individual houses' }],
        note: () => {
          const b = settings.layers.building;
          const floor = b.houses ? 10 : 9;
          return (
            `Showing from zoom ${Math.max(floor, b.minzoom)}` +
            (b.minzoom < floor ? ` (Min zoom ${b.minzoom} is below the lowest supported, ${floor})` : '') +
            '. Houses only exist in zoom-14 data (zoom 13 has merged blocks); each zoom below that merges 4× more tiles, and 10 already needs 256 per tile.'
          );
        },
      },
      { type: 'area', path: 'layers.landuse', label: 'Residential areas' },
      { type: 'area', path: 'layers.industrial', label: 'Commercial & industrial' },
      { type: 'area', path: 'layers.institution', label: 'Schools, colleges, hospitals' },
      { type: 'area', path: 'layers.park', label: 'Parks & cemeteries' },
      { type: 'area', path: 'layers.recreation', label: 'Sports grounds & playgrounds' },
      { type: 'area', path: 'layers.grass', label: 'Grass & farmland' },
      { type: 'area', path: 'layers.wood', label: 'Woods' },
      { type: 'area', path: 'layers.wetland', label: 'Wetlands' },
      { type: 'area', path: 'layers.airport', label: 'Airport grounds' },
    ],
  },
];

const panel = new Panel(document.getElementById('panel-body')!, S, (_path, kind) => apply(kind), DEFAULTS);
panel.build(sections);
syncModeUI();

document.getElementById('collapse')!.onclick = () => document.body.classList.toggle('collapsed');

apply('init');
