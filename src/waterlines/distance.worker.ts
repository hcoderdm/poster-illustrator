// Engraves a water mask: a signed distance transform (Felzenszwalb & Huttenlocher),
// then anti-aliased ink wherever the bilinearly sampled distance falls on a ring.

export interface WaterParams {
  spacing: number;
  growth: number;
  lineWidth: number;
  rings: number;
  falloff: number;
  opacity: number;
  shoreWidth: number;
  jitter: number;
  jitterScale: number;
  fillOpacity: number;
  paperColor: [number, number, number];
  waterColor: [number, number, number];
  lineColor: [number, number, number];
  drawLines: boolean;
}

export interface WaterRequest {
  id: number;
  mask: Uint8Array; // 1 byte per pixel, >127 = water
  mw: number;
  mh: number;
  scale: number; // output px per mask px
  cropX: number; // mask px of output origin
  cropY: number;
  outW: number;
  outH: number;
  pxRatio: number; // output px per CSS px
  noiseOffset: [number, number]; // CSS px, keeps wobble stable between preview and export
  params: WaterParams;
}

export interface WaterResponse {
  id: number;
  pixels: Uint8ClampedArray;
}

const INF = 1e20;

function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const r = v[k];
      s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
}

// In-place squared EDT of grid (0 at seeds, INF elsewhere).
function edt(grid: Float32Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float32Array(n);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
}

// Signed distance in mask px (+ water, - land), seeded sub-pixel from the anti-aliased edge like TinySDF.
function signedDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const toLand = new Float32Array(w * h);
  const toWater = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = mask[i] / 255;
    if (a >= 1) {
      toLand[i] = INF;
      toWater[i] = 0;
    } else if (a <= 0) {
      toLand[i] = 0;
      toWater[i] = INF;
    } else {
      const dLand = Math.max(0, a - 0.5);
      const dWater = Math.max(0, 0.5 - a);
      toLand[i] = dLand * dLand;
      toWater[i] = dWater * dWater;
    }
  }
  edt(toLand, w, h);
  edt(toWater, w, h);
  const out = toLand;
  for (let i = 0; i < w * h; i++) {
    const v = Math.sqrt(toLand[i]) - Math.sqrt(toWater[i]);
    out[i] = Math.max(-1e6, Math.min(1e6, v));
  }
  return out;
}

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 0x7fff - 1; // [-1, 1]
}

function valueNoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function render(req: WaterRequest): Uint8ClampedArray {
  const { mw, mh, scale, cropX, cropY, outW, outH, pxRatio, params: P } = req;
  const sd = signedDistance(req.mask, mw, mh);
  const out = new Uint8ClampedArray(outW * outH * 4);

  const s0 = Math.max(0.5, P.spacing * pxRatio);
  const g = Math.max(1, P.growth);
  const lnG = Math.log(g);
  const halfW = (P.lineWidth * pxRatio) / 2;
  const shoreHalf = (P.shoreWidth * pxRatio) / 2;
  const jitterAmp = P.jitter * s0;
  const jScale = 1 / Math.max(1, P.jitterScale);
  const [pr, pg, pb] = P.paperColor;
  const [wr, wg, wb] = P.waterColor;
  // Water is opaque (paper, then tint) so land tints beneath it never show through.
  const fo = P.fillOpacity;
  const br = pr + (wr - pr) * fo, bg = pg + (wg - pg) * fo, bb = pb + (wb - pb) * fo;
  const [lr, lg, lb] = P.lineColor;
  const ringPos = (k: number) => (g === 1 ? k * s0 : (s0 * (Math.pow(g, k) - 1)) / (g - 1));

  for (let y = 0; y < outH; y++) {
    let my = cropY + (y + 0.5) / scale - 0.5;
    my = Math.max(0, Math.min(mh - 1.001, my));
    const y0 = Math.floor(my), fy = my - y0;
    const r0 = y0 * mw, r1 = r0 + mw;
    const cy = y / pxRatio + req.noiseOffset[1];
    for (let x = 0; x < outW; x++) {
      let mx = cropX + (x + 0.5) / scale - 0.5;
      mx = Math.max(0, Math.min(mw - 1.001, mx));
      const x0 = Math.floor(mx), fx = mx - x0;
      const top = sd[r0 + x0] + (sd[r0 + x0 + 1] - sd[r0 + x0]) * fx;
      const bot = sd[r1 + x0] + (sd[r1 + x0 + 1] - sd[r1 + x0]) * fx;
      const dist = (top + (bot - top) * fy) * scale; // output px, + in water

      if (dist < -shoreHalf - 1) continue;
      const cover = Math.max(0, Math.min(1, dist + 0.5));

      let ink = 0;
      if (P.drawLines) {
        ink = Math.max(0, Math.min(1, shoreHalf + 0.5 - Math.abs(dist)));
        if (cover > 0 && P.rings > 0) {
          let d = dist;
          if (jitterAmp > 0) {
            const cx = x / pxRatio + req.noiseOffset[0];
            d += jitterAmp * (valueNoise(cx * jScale, cy * jScale) + 0.5 * valueNoise(cx * jScale * 3.1 + 17, cy * jScale * 3.1 - 9));
          }
          if (d > 0) {
            const u = g === 1 ? d / s0 : Math.log(1 + (d * (g - 1)) / s0) / lnG;
            const k = Math.max(1, Math.round(u));
            if (k <= P.rings) {
              const fade = Math.pow(1 - (k - 1) / P.rings, P.falloff);
              const a = Math.max(0, Math.min(1, halfW + 0.5 - Math.abs(d - ringPos(k))));
              // Sub-pixel lines fade instead of vanishing.
              const thin = halfW < 0.5 ? halfW * 2 : 1;
              ink = Math.max(ink, a * fade * thin * cover);
            }
          }
        }
        ink *= P.opacity;
      }

      const alpha = ink + cover * (1 - ink);
      if (alpha <= 0) continue;
      const i = (y * outW + x) * 4;
      out[i] = (lr * ink + br * cover * (1 - ink)) / alpha;
      out[i + 1] = (lg * ink + bg * cover * (1 - ink)) / alpha;
      out[i + 2] = (lb * ink + bb * cover * (1 - ink)) / alpha;
      out[i + 3] = alpha * 255;
    }
  }
  return out;
}

self.onmessage = (e: MessageEvent<WaterRequest>) => {
  const pixels = render(e.data);
  const res: WaterResponse = { id: e.data.id, pixels };
  (self as unknown as Worker).postMessage(res, [pixels.buffer]);
};
