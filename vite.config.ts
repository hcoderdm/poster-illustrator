import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import fs from 'node:fs/promises';
// @ts-ignore - plain JS module
import { addToManifest } from './scripts/fonts-lib.mjs';

const FONTS_DIR = path.resolve(import.meta.dirname, 'public/fonts');

const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
// Google variant id ("400", "700i") → name suffix ("Regular", "Bold Italic").
const variantLabel = (v: string) => {
  const w = parseInt(v, 10);
  return v.endsWith('i') ? (w === 400 ? 'Italic' : `${WEIGHT_NAMES[w] ?? w} Italic`) : (WEIGHT_NAMES[w] ?? String(w));
};

interface FamilyInfo {
  family: string;
  category: string;
  variants: { id: string; label: string }[];
  popularity: number;
}

// Dev-server endpoints for adding Google Fonts as label fonts (MapLibre renders labels from these TTFs):
//   GET  /api/google-fonts                → FamilyInfo[]
//   POST /api/fonts/add {family, variant} → saves public/fonts/ttf/<name>.ttf, lists it in fonts.json; returns {name, fonts}
function googleFonts(): Plugin {
  let catalog: FamilyInfo[] | null = null;

  async function loadCatalog() {
    if (catalog) return catalog;
    const text = await (await fetch('https://fonts.google.com/metadata/fonts')).text();
    const data = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
    catalog = data.familyMetadataList.map((f: any) => ({
      family: f.family,
      category: f.category,
      variants: Object.keys(f.fonts).map((id) => ({ id, label: variantLabel(id) })),
      popularity: f.popularity,
    }));
    return catalog!;
  }

  const json = (res: any, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  return {
    name: 'google-fonts',
    configureServer(server) {
      server.middlewares.use('/api/google-fonts', async (_req, res) => {
        try {
          json(res, 200, await loadCatalog());
        } catch (e) {
          json(res, 502, { error: String(e) });
        }
      });

      server.middlewares.use('/api/fonts/add', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        try {
          let body = '';
          for await (const chunk of req) body += chunk;
          const { family, variant } = JSON.parse(body) as { family: string; variant: string };
          const info = (await loadCatalog()).find((f) => f.family === family);
          if (!info?.variants.some((v) => v.id === variant)) return json(res, 400, { error: 'Unknown family or variant' });

          const italic = variant.endsWith('i') ? 1 : 0;
          const weight = parseInt(variant, 10);
          const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${italic},${weight}`;
          // A non-browser user agent makes Google serve TrueType instead of woff2.
          const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'node' } })).text();
          const url = css.match(/url\((https:[^)]+)\)\s*format\('truetype'\)/)?.[1];
          if (!url) return json(res, 502, { error: 'Google did not return a TrueType file for that font' });
          const ttf = Buffer.from(await (await fetch(url)).arrayBuffer());

          const name = `${family} ${variantLabel(variant)}`;
          await fs.mkdir(path.join(FONTS_DIR, 'ttf'), { recursive: true });
          await fs.writeFile(path.join(FONTS_DIR, 'ttf', name.replace(/ /g, '-') + '.ttf'), ttf);
          const fonts = await addToManifest(FONTS_DIR, [name]);
          json(res, 200, { name, fonts });
        } catch (e) {
          json(res, 500, { error: String(e) });
        }
      });
    },
  };
}

export default defineConfig({
  worker: { format: 'es' },
  // MapLibre alone is about 1 MB minified.
  build: { chunkSizeWarningLimit: 1500 },
  plugins: [googleFonts()],
  server: {
    // Don't reload the page when a font is added.
    watch: { ignored: ['**/public/fonts/**'] },
  },
});
