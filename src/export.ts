import maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { exportPixels, type Settings } from './settings';
import { effective } from './colors';
import { buildStyle, EMPTY_FC, ORIGINAL_STYLE_URL } from './style/vintage';
import { attachPatterns } from './style/patterns';
import { registerTileProtocols } from './style/tiles';
import { createMaskMap, engrave, marginCss, readMask, viewportCorners, waitIdle, waterParams } from './waterlines/render';
import { drawDecor, type PosterLayout } from './poster';
import { drawGrain } from './paper';

const MAX_MASK_PIXELS = 32e6;

let maxDim = 0;
/** Largest canvas side this GPU can render (queried once: every query costs a WebGL context). */
export function maxCanvasDim(): number {
  if (!maxDim) {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dims = gl?.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | undefined;
    maxDim = gl && dims ? Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), dims[0], dims[1], 16384) : 4096;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return maxDim;
}

function offscreenHost(w: number, h: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'absolute', left: '-100000px', top: '0', width: `${w}px`, height: `${h}px`, visibility: 'hidden', pointerEvents: 'none' });
  return document.body.appendChild(el);
}

/** Renders the poster at print size; the map keeps its on-screen CSS size with a large pixelRatio, so it matches the Preview. */
export async function renderPoster(settings: Settings, layout: PosterLayout, onProgress: (msg: string) => void, labels: FeatureCollection = EMPTY_FC): Promise<Blob> {
  const s = effective(settings);
  registerTileProtocols();
  const original = s.mode === 'original';
  const { width: outW, height: outH } = exportPixels(s);
  if (outW > maxCanvasDim() || outH > maxCanvasDim()) {
    throw new Error(`Output ${outW}×${outH}px exceeds this GPU's limit of ${maxCanvasDim()}px per side. Lower the DPI or size.`);
  }
  const ratio = outW / layout.poster.width;
  const area = original ? layout.poster : layout.map;
  const mapW = Math.round(area.width * ratio), mapH = Math.round(area.height * ratio);
  const ox = Math.round((area.x - layout.poster.x) * ratio), oy = Math.round((area.y - layout.poster.y) * ratio);
  const cssW = area.width, cssH = mapH / ratio;
  const camera = { center: s.view.center, zoom: s.view.zoom, bearing: s.view.bearing };

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = s.palette.paper;
  ctx.fillRect(0, 0, outW, outH);

  // Water lines at print resolution, from a mask that sees `margin` past the edges.
  let water: HTMLCanvasElement | null = null;
  if (!original) {
    onProgress('Rendering water mask…');
    const margin = marginCss(s);
    const mw = cssW + 2 * margin, mh = cssH + 2 * margin;
    const maskRatio = Math.max(1, Math.min(ratio, Math.sqrt(MAX_MASK_PIXELS / (mw * mh)), maxCanvasDim() / Math.max(mw, mh)));
    const maskHost = offscreenHost(mw, mh);
    const maskMap = createMaskMap(maskHost, s, maskRatio);
    maskMap.jumpTo(camera);
    await waitIdle(maskMap);
    const m = readMask(maskMap);
    maskMap.remove();
    maskHost.remove();

    onProgress('Engraving water lines…');
    const k = m.w / mw;
    const pixels = await engrave({ mask: m.mask, mw: m.w, mh: m.h, scale: ratio / k, cropX: margin * k, cropY: margin * k, outW: mapW, outH: mapH, pxRatio: ratio, noiseOffset: [0, 0], params: waterParams(s) });
    water = document.createElement('canvas');
    water.width = mapW;
    water.height = mapH;
    water.getContext('2d')!.putImageData(new ImageData(pixels as ImageDataArray, mapW, mapH), 0, 0);
  }

  onProgress('Rendering map at print resolution…');
  const host = offscreenHost(cssW, cssH);
  const map = new maplibregl.Map({
    container: host,
    style: original ? ORIGINAL_STYLE_URL : buildStyle(s, { labels: { mode: 'fitted', data: labels } }),
    ...camera,
    interactive: false,
    attributionControl: false,
    pixelRatio: ratio,
    maxCanvasSize: [16384, 16384],
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  attachPatterns(map);
  await new Promise<void>((r) => map.once('load', () => r()));
  if (water) {
    // Same stacking as the preview: above land tints, below roads and labels.
    map.addSource('waterlines', { type: 'canvas', canvas: water, coordinates: viewportCorners(map, cssW, cssH), animate: false });
    map.addLayer({ id: 'waterlines', type: 'raster', source: 'waterlines', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'waterway');
  }
  await waitIdle(map);
  ctx.drawImage(map.getCanvas(), ox, oy, mapW, mapH);
  map.remove();
  host.remove();
  if (water) water.width = water.height = 0;

  onProgress('Finishing…');
  if (!original) {
    await drawDecor(ctx, s, { x: 0, y: 0, width: outW, height: outH }, { x: ox, y: oy, width: mapW, height: mapH }, layout.pxPerInch * ratio);
    // Grain on the map only; the white margins stay untextured.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, mapW, mapH);
    ctx.clip();
    drawGrain(ctx, outW, outH, ratio, s);
    ctx.restore();
  }

  onProgress('Encoding PNG…');
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
