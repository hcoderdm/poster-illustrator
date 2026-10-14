import type { Settings } from './settings';
import { cssFont, loadFonts } from './fonts';

// The map sits inside the poster, inset by the margins, which carry a border, a
// title and a footer. drawDecor() is shared by the Preview overlay and the export.

export type Rect = { x: number; y: number; width: number; height: number };
export interface PosterLayout {
  poster: Rect;
  map: Rect;
  /** Screen px per poster inch. */
  pxPerInch: number;
}

/** Fits the poster into the stage with the map area centred, so the map centre is the stage centre. */
export function posterLayout(s: Settings, stageW: number, stageH: number, pad = 36): PosterLayout {
  const m = s.poster.margins;
  const W = s.export.width, H = s.export.height;
  const l = Math.min(m.left, W * 0.45), r = Math.min(m.right, W * 0.45);
  const t = Math.min(m.top, H * 0.45), b = Math.min(m.bottom, H * 0.45);
  const mapW = W - l - r, mapH = H - t - b;
  // Room needed so the poster fits even though the map (not the poster) is centred.
  const needW = mapW + 2 * Math.max(l, r), needH = mapH + 2 * Math.max(t, b);
  const k = Math.min((stageW - 2 * pad) / needW, (stageH - 2 * pad) / needH);
  const mw = Math.round(mapW * k), mh = Math.round(mapH * k);
  const mx = (stageW - mw) / 2, my = (stageH - mh) / 2;
  return {
    map: { x: mx, y: my, width: mw, height: mh },
    poster: { x: mx - l * k, y: my - t * k, width: W * k, height: H * k },
    pxPerInch: s.export.unit === 'in' ? k : k * 2.54,
  };
}

export function currentMonthYear() {
  return new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Height of the actual ink above and below the baseline, for optical centring.
function inkExtent(ctx: CanvasRenderingContext2D, text: string) {
  const m = ctx.measureText(text);
  return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
}

/** Draws text with letter spacing, aligned left/center/right at x, on baseline y. */
function spacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'center' | 'right') {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
}

/** Paints margins, border, title and footer in canvas px; `s` must be effective settings. */
export async function drawDecor(ctx: CanvasRenderingContext2D, s: Settings, poster: Rect, map: Rect, pxPerInch: number) {
  const P = s.poster;
  await loadFonts([P.title.font, P.footer.font]);
  const pt = (v: number) => (v / 72) * pxPerInch;
  ctx.save();

  // Margins are plain white (no paper tint or grain) so prints have a clean border.
  ctx.beginPath();
  ctx.rect(poster.x, poster.y, poster.width, poster.height);
  ctx.rect(map.x, map.y, map.width, map.height);
  ctx.fillStyle = '#ffffff';
  ctx.fill('evenodd');

  // Neatline: a single rule, or a thin inner and heavy outer rule like engraved maps.
  ctx.strokeStyle = s.palette.label;
  const bw = Math.max(0.5, pt(P.borderWidth));
  const borderOut = P.border === 'double' ? bw * 6.5 : P.border === 'single' ? bw : 0;
  if (P.border !== 'none') {
    ctx.lineWidth = bw;
    ctx.strokeRect(map.x - bw / 2, map.y - bw / 2, map.width + bw, map.height + bw);
  }
  if (P.border === 'double') {
    const gap = bw * 4;
    ctx.lineWidth = bw * 2.5;
    ctx.strokeRect(map.x - gap - bw * 1.25, map.y - gap - bw * 1.25, map.width + 2 * gap + bw * 2.5, map.height + 2 * gap + bw * 2.5);
  }

  ctx.fillStyle = s.palette.label;
  const alignX = (a: 'left' | 'center' | 'right') => (a === 'left' ? map.x : a === 'right' ? map.x + map.width : poster.x + poster.width / 2);

  // Title and subtitle, centred on their ink between the poster's top edge and the border.
  const T = P.title;
  const title = (T.text || s.labels.searchedName).trim();
  if (T.show && title) {
    const ts = pt(T.size), ss = pt(T.subtitleSize);
    const main = T.uppercase ? title.toUpperCase() : title;
    const sub = T.uppercase ? T.subtitle.trim().toUpperCase() : T.subtitle.trim();
    ctx.font = cssFont(T.font, ts);
    const mi = inkExtent(ctx, main);
    let si = { ascent: 0, descent: 0 };
    if (sub) {
      ctx.font = cssFont(T.font, ss);
      si = inkExtent(ctx, sub);
    }
    const gap = sub ? ss * 0.6 : 0;
    const block = mi.ascent + mi.descent + (sub ? gap + si.ascent + si.descent : 0);
    const bandTop = poster.y, bandBottom = map.y - borderOut;
    const top = (bandTop + bandBottom) / 2 - block / 2 + pt(T.offset);
    ctx.font = cssFont(T.font, ts);
    spacedText(ctx, main, alignX(T.align), top + mi.ascent, T.letterSpacing * ts, T.align);
    if (sub) {
      ctx.font = cssFont(T.font, ss);
      spacedText(ctx, sub, alignX(T.align), top + mi.ascent + mi.descent + gap + si.ascent, T.letterSpacing * ss, T.align);
    }
  }

  // Footer: credits left and date right, a set gap below the border (inside the map if there's no room).
  const F = P.footer;
  const fs = pt(F.size);
  const lh = fs * 1.25;
  ctx.font = cssFont(F.font, fs);
  const credit = F.attributionText || DEFAULT_ATTRIBUTION;
  const date = F.dateText || currentMonthYear();
  const ink = inkExtent(ctx, `${credit}${date}`);
  // The credit wraps at its " · " separators where it would run into the date.
  const room = map.width - (F.date ? ctx.measureText(date).width + fs * 2 : 0);
  const lines: string[] = [];
  for (const part of F.attribution ? credit.split(' · ') : []) {
    const last = lines[lines.length - 1];
    if (last && ctx.measureText(`${last} · ${part}`).width <= room) lines[lines.length - 1] = `${last} · ${part}`;
    else lines.push(part);
  }
  const below = map.y + map.height + borderOut + pt(F.offset);
  const fits = below + ink.ascent + Math.max(0, lines.length - 1) * lh + ink.descent <= poster.y + poster.height;
  const inset = fits ? 0 : fs * 0.8;
  const baseline = fits ? below + ink.ascent : map.y + map.height - inset - ink.descent;
  if (F.date) spacedText(ctx, date, map.x + map.width - inset, baseline, 0, 'right');
  lines.forEach((line, i) => spacedText(ctx, line, map.x + inset, fits ? baseline + i * lh : baseline - (lines.length - 1 - i) * lh, 0, 'left'));
  ctx.restore();
}

// Print credit per each project's guidelines: OpenStreetMap needs its ODbL licence and the printed
// URL openstreetmap.org/copyright; OpenMapTiles asks for "© OpenMapTiles" with openmaptiles.org;
// OpenFreeMap has no formal requirement and is credited as in its own examples.
export const DEFAULT_ATTRIBUTION =
  'Map data © OpenStreetMap contributors, ODbL · openstreetmap.org/copyright · © OpenMapTiles · openmaptiles.org · Tiles by OpenFreeMap';
