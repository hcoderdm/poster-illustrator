import type { Settings } from './settings';

// Global palette adjustments, baked into every hex colour in the settings (a CSS
// filter wouldn't reach the export).

export interface Adjust {
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
  hue: number; // degrees
  warmth: number; // -1..1, toward amber (+) or blue (-)
  fade: number; // 0..1, wash every colour toward the paper colour
}

const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** '#rrggbb' → [r, g, b] in 0–255. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const unit = (hex: string) => rgb(hex).map((v) => v / 255) as [number, number, number];

function rgbToHex([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

function adjustColor(hex: string, a: Adjust, paper?: [number, number, number]): string {
  let [r, g, b] = unit(hex);
  if (a.hue || a.saturation) {
    const [h, s, l] = rgbToHsl([r, g, b]);
    [r, g, b] = hslToRgb([(h + a.hue + 360) % 360, clamp(s * (1 + a.saturation)), l]);
  }
  if (a.warmth) {
    r += a.warmth * 0.08;
    g += a.warmth * 0.02;
    b -= a.warmth * 0.1;
  }
  if (a.contrast) {
    const c = a.contrast >= 0 ? 1 + a.contrast * 1.5 : 1 + a.contrast;
    r = (r - 0.5) * c + 0.5;
    g = (g - 0.5) * c + 0.5;
    b = (b - 0.5) * c + 0.5;
  }
  if (a.brightness > 0) {
    r += (1 - r) * a.brightness;
    g += (1 - g) * a.brightness;
    b += (1 - b) * a.brightness;
  } else if (a.brightness < 0) {
    r *= 1 + a.brightness;
    g *= 1 + a.brightness;
    b *= 1 + a.brightness;
  }
  if (a.fade && paper) {
    r += (paper[0] - r) * a.fade;
    g += (paper[1] - g) * a.fade;
    b += (paper[2] - b) * a.fade;
  }
  return rgbToHex([r, g, b]);
}

function mapColors(v: unknown, f: (hex: string) => string): unknown {
  if (typeof v === 'string') return HEX.test(v) ? f(v) : v;
  if (Array.isArray(v)) return v.map((x) => mapColors(x, f));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapColors(x, f)]));
  }
  return v;
}

/** Settings with the global adjustments baked into every colour. */
export function effective(s: Settings): Settings {
  const a = s.adjust;
  if (!a.brightness && !a.contrast && !a.saturation && !a.hue && !a.warmth && !a.fade) return s;
  // Fade washes toward the adjusted paper, so the paper itself isn't faded.
  const paperHex = adjustColor(s.palette.paper, { ...a, fade: 0 });
  const paper = unit(paperHex);
  const out = mapColors(s, (h) => adjustColor(h, a, paper)) as Settings;
  out.palette.paper = paperHex;
  return out;
}
