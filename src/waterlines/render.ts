import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import type { Settings } from '../settings';
import { rgb } from '../colors';
import { buildMaskStyle } from '../style/vintage';
import type { WaterParams, WaterRequest, WaterResponse } from './distance.worker';
import WaterWorker from './distance.worker?worker';

export function waterParams(s: Settings): WaterParams {
  const w = s.water;
  return {
    spacing: w.spacing,
    growth: w.growth,
    lineWidth: w.lineWidth,
    rings: Math.round(w.rings),
    falloff: w.falloff,
    opacity: w.opacity,
    shoreWidth: w.shoreWidth,
    jitter: w.jitter,
    jitterScale: w.jitterScale,
    fillOpacity: w.fillOpacity,
    paperColor: rgb(s.palette.paper),
    waterColor: rgb(s.palette.water),
    lineColor: rgb(s.palette.waterLines),
    drawLines: w.enabled,
  };
}

// How far offshore (CSS px) the rings reach; the mask must see that far past the edge.
export function marginCss(s: Settings): number {
  const w = s.water;
  const g = Math.max(1, w.growth);
  const k = Math.round(w.rings);
  const reach = g === 1 ? k * w.spacing : (w.spacing * (Math.pow(g, k) - 1)) / (g - 1);
  return Math.min(600, Math.ceil(reach * (1 + w.jitter) + w.shoreWidth + 8));
}

export function waitIdle(map: MLMap): Promise<void> {
  return new Promise((resolve) => {
    map.once('idle', () => resolve());
    map.triggerRepaint();
  });
}

export function readMask(map: MLMap): { mask: Uint8Array; w: number; h: number } {
  const src = map.getCanvas();
  const w = src.width, h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4];
  return { mask, w, h };
}

export function createMaskMap(container: HTMLElement, s: Settings, pixelRatio: number): MLMap {
  return new maplibregl.Map({
    container,
    style: buildMaskStyle(s),
    center: s.view.center,
    zoom: s.view.zoom,
    bearing: s.view.bearing,
    interactive: false,
    attributionControl: false,
    pixelRatio,
    maxCanvasSize: [16384, 16384],
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false },
  });
}

// One worker shared by the preview and exports; replies are matched by id.
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (pixels: Uint8ClampedArray) => void>();

export function engrave(req: Omit<WaterRequest, 'id'>): Promise<Uint8ClampedArray> {
  if (!worker) {
    worker = new WaterWorker();
    worker.onmessage = (e: MessageEvent<WaterResponse>) => {
      pending.get(e.data.id)?.(e.data.pixels);
      pending.delete(e.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ ...req, id }, [req.mask.buffer]);
  });
}

export type Corners = [[number, number], [number, number], [number, number], [number, number]];

/** The four corners (TL, TR, BR, BL) of a map's viewport, as image-source coordinates. */
export function viewportCorners(map: MLMap, w: number, h: number): Corners {
  return ([[0, 0], [w, 0], [w, h], [0, h]] as const).map(([x, y]) => {
    const c = map.unproject([x, y]);
    return [c.lng, c.lat] as [number, number];
  }) as Corners;
}

/** Keeps the water raster current: a hidden mask map follows the camera and is engraved after each move. */
export class WaterPreview {
  private maskHost: HTMLDivElement;
  private mask: MLMap;
  private canvas = document.createElement('canvas');
  private margin = 0;
  private generation = 0;
  private timer = 0;
  private lastUrl = '';

  constructor(
    private main: MLMap,
    private getSettings: () => Settings,
    private getFrameOrigin: () => [number, number],
    private onImage: (url: string, corners: Corners) => void,
  ) {
    this.maskHost = document.createElement('div');
    Object.assign(this.maskHost.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
    });
    document.body.appendChild(this.maskHost);
    this.sizeHost();
    this.mask = createMaskMap(this.maskHost, getSettings(), Math.min(1, getSettings().previewQuality));
    this.syncCamera();

    main.on('move', () => this.syncCamera());
    main.on('moveend', () => this.schedule());
    main.on('resize', () => this.resize());
    this.mask.once('load', () => this.schedule(0));
  }

  private sizeHost() {
    const s = this.getSettings();
    this.margin = marginCss(s);
    const c = this.main.getContainer();
    this.maskHost.style.width = `${c.clientWidth + 2 * this.margin}px`;
    this.maskHost.style.height = `${c.clientHeight + 2 * this.margin}px`;
  }

  private syncCamera() {
    this.mask.jumpTo({
      center: this.main.getCenter(),
      zoom: this.main.getZoom(),
      bearing: this.main.getBearing(),
      pitch: this.main.getPitch(),
    });
  }

  resize() {
    this.sizeHost();
    this.mask.resize();
    this.syncCamera();
    this.schedule();
  }

  /** Re-engrave after a settings change; maskChanged rebuilds the water mask style. */
  update(maskChanged: boolean) {
    const s = this.getSettings();
    if (marginCss(s) !== this.margin) {
      this.sizeHost();
      this.mask.resize();
      this.syncCamera();
    }
    if (maskChanged) this.mask.setStyle(buildMaskStyle(s));
    // 1 mask px per CSS px is plenty: distances are interpolated.
    const maskRatio = Math.min(1, s.previewQuality);
    if (this.mask.getPixelRatio() !== maskRatio) this.mask.setPixelRatio(maskRatio);
    this.schedule();
  }

  schedule(delay = 120) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), delay);
  }

  private async render() {
    const gen = ++this.generation;
    await waitIdle(this.mask);
    if (gen !== this.generation) return;

    const s = this.getSettings();
    if (s.mode === 'original') return;
    const c = this.main.getContainer();
    const dpr = s.previewQuality;
    const outW = Math.round(c.clientWidth * dpr);
    const outH = Math.round(c.clientHeight * dpr);
    const corners = viewportCorners(this.main, c.clientWidth, c.clientHeight);
    const { mask, w, h } = readMask(this.mask);
    const maskRatio = w / (c.clientWidth + 2 * this.margin);
    const [fx, fy] = this.getFrameOrigin();

    const pixels = await engrave({
      mask,
      mw: w,
      mh: h,
      scale: dpr / maskRatio,
      cropX: this.margin * maskRatio,
      cropY: this.margin * maskRatio,
      outW,
      outH,
      pxRatio: dpr,
      noiseOffset: [-fx, -fy],
      params: waterParams(s),
    });
    if (gen !== this.generation) return;

    this.canvas.width = outW;
    this.canvas.height = outH;
    this.canvas.getContext('2d')!.putImageData(new ImageData(pixels as ImageDataArray, outW, outH), 0, 0);
    const blob = await new Promise<Blob | null>((r) => this.canvas.toBlob(r, 'image/png'));
    if (!blob || gen !== this.generation) return;
    const url = URL.createObjectURL(blob);
    const old = this.lastUrl;
    this.lastUrl = url;
    this.onImage(url, corners);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 5000);
  }
}
