// Map label fonts are rendered by MapLibre itself from web fonts (the style has
// no glyph server): it rasterises each glyph at 48px with the browser's own
// font engine, so hairlines and serifs survive instead of eroding in 24px
// pre-built glyph files. Each font file is registered under its full name
// ("Old Standard TT Bold"), with the weight and style MapLibre will sniff from
// that name, so the browser uses the real face rather than faking bold/italic.

// Mirrors GlyphManager._fontWeight / _fontStyle in maplibre-gl.
const WEIGHTS: Record<string, number> = {
  thin: 100, hairline: 100,
  'extra light': 200, 'ultra light': 200,
  light: 300,
  normal: 400, regular: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  'extra bold': 800, 'ultra bold': 800,
  black: 900, heavy: 900,
  'extra black': 950, 'ultra black': 950,
};

export function fontWeight(name: string): string {
  let match = 'normal';
  for (const [w, value] of Object.entries(WEIGHTS)) if (new RegExp(`\\b${w}\\b`, 'i').test(name)) match = String(value);
  return match;
}

export function fontStyle(name: string): string {
  return /italic/i.test(name) ? 'italic' : /oblique/i.test(name) ? 'oblique' : 'normal';
}

/** CSS font shorthand matching what MapLibre asks the canvas for. */
export function cssFont(name: string, size: number) {
  return `${fontStyle(name)} ${fontWeight(name)} ${size}px "${name}"`;
}

const loaded = new Map<string, Promise<void>>();

/** Registers and loads map fonts from /fonts/ttf/<Name-With-Dashes>.ttf. */
export function loadFonts(names: string[]): Promise<void> {
  return Promise.all(
    names.map((name) => {
      let p = loaded.get(name);
      if (!p) {
        const url = `/fonts/ttf/${encodeURIComponent(name.replace(/ /g, '-'))}.ttf`;
        const face = new FontFace(name, `url("${url}")`, { weight: fontWeight(name), style: fontStyle(name) });
        p = face.load().then(
          (f) => void document.fonts.add(f),
          () => console.warn(`Font "${name}" could not be loaded from ${url}`),
        );
        loaded.set(name, p);
      }
      return p;
    }),
  ).then(() => undefined);
}
