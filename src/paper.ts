import type { Settings } from './settings';

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 0xffff; // [0, 1]
}

/** Multiplies paper grain (speckle plus mottling) keyed to CSS px from the poster origin, so preview and export match. */
export function drawGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pxRatio: number,
  s: Settings,
  origin: [number, number] = [0, 0],
) {
  const amount = s.paper.grain;
  if (amount <= 0) return;
  const cell = Math.max(0.5, s.paper.grainSize);
  // One noise sample per grain cell, scaled up.
  const gw = Math.ceil(w / (cell * pxRatio)) + 1;
  const gh = Math.ceil(h / (cell * pxRatio)) + 1;
  const ox = Math.floor(origin[0] / cell), oy = Math.floor(origin[1] / cell);
  const fine = document.createElement('canvas');
  fine.width = gw;
  fine.height = gh;
  const fctx = fine.getContext('2d')!;
  const img = fctx.createImageData(gw, gh);
  const mottle = 40 / cell; // mottling wavelength in grain cells
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const gx = x + ox, gy = y + oy;
      const speck = hash(gx, gy);
      const mx = gx / mottle, my = gy / mottle;
      const xi = Math.floor(mx), yi = Math.floor(my);
      const fx = mx - xi, fy = my - yi;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = hash(xi + 9000, yi), b = hash(xi + 9001, yi), c = hash(xi + 9000, yi + 1), d = hash(xi + 9001, yi + 1);
      const m = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      const dark = amount * (speck * 38 + m * 30);
      const i = (y * gw + x) * 4;
      img.data[i] = 255 - dark;
      img.data[i + 1] = 255 - dark * 1.05;
      img.data[i + 2] = 255 - dark * 1.2;
      img.data[i + 3] = 255;
    }
  }
  fctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  const offX = (origin[0] / cell - ox) * cell * pxRatio;
  const offY = (origin[1] / cell - oy) * cell * pxRatio;
  ctx.drawImage(fine, -offX, -offY, gw * cell * pxRatio, gh * cell * pxRatio);
  ctx.restore();
}
