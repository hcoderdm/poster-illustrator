import type { Map as MLMap } from 'maplibre-gl';
import type { Pattern } from '../settings';

// Engraving-style fill patterns, drawn on demand at the map's pixel ratio from ids
// like "pat:hatch:3a2e21:4:0.5", so they stay crisp in high-DPI exports.

export function patternId(kind: Pattern, color: string, spacing: number, width: number) {
  return `pat:${kind}:${color.replace('#', '')}:${spacing}:${width}`;
}

function draw(kind: string, color: string, spacing: number, width: number, pr: number) {
  // A side of spacing·√2 makes 45° lines tile seamlessly.
  const diag = kind.startsWith('hatch') || kind === 'crosshatch';
  const side = Math.max(2, Math.round((diag ? spacing * Math.SQRT2 : spacing) * pr));
  const c = document.createElement('canvas');
  c.width = c.height = side;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = ctx.fillStyle = `#${color}`;
  ctx.lineWidth = Math.max(0.5, width * pr);
  ctx.lineCap = 'square';
  const lineSeg = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const s = side;
  if (kind === 'hatch' || kind === 'crosshatch') for (const o of [-s, 0, s]) lineSeg(o, s, o + s, 0);
  if (kind === 'hatch-back' || kind === 'crosshatch') for (const o of [-s, 0, s]) lineSeg(o, 0, o + s, s);
  if (kind === 'horizontal') lineSeg(0, s / 2, s, s / 2);
  if (kind === 'vertical') lineSeg(s / 2, 0, s / 2, s);
  if (kind === 'dots' || kind === 'dots-offset') {
    // The offset variant staggers alternate rows.
    const cell = Math.max(2, Math.round(spacing * pr));
    const staggered = kind === 'dots-offset';
    c.width = cell * (staggered ? 2 : 1);
    c.height = cell * (staggered ? 2 : 1);
    ctx.fillStyle = `#${color}`;
    const r = Math.max(0.6, (width * pr) / 2);
    const dot = (x: number, y: number) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (staggered) {
      dot(cell / 2, cell / 2);
      dot(cell * 1.5, cell * 1.5);
    } else dot(cell / 2, cell / 2);
  }
  if (kind === 'stipple') {
    // A few seeded random dots on a 3× tile, so the repeat is less obvious.
    const big = Math.round(spacing * 3 * pr);
    c.width = c.height = big;
    ctx.fillStyle = `#${color}`;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const r = Math.max(0.5, (width * pr) / 2);
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(rnd() * big, rnd() * big, r * (0.7 + rnd() * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return ctx.getImageData(0, 0, c.width, c.height);
}

export function attachPatterns(map: MLMap) {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id.startsWith('pat:') || map.hasImage(e.id)) return;
    const [, kind, color, spacing, width] = e.id.split(':');
    const pr = map.getPixelRatio();
    map.addImage(e.id, draw(kind, color, +spacing, +width, pr), { pixelRatio: pr });
  });
}
