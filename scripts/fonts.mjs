// Downloads the bundled period serif fonts (all SIL OFL, from the google/fonts repo)
// into public/fonts/ttf. MapLibre renders labels straight from them as web fonts.
// More fonts can be added at runtime from the app's Google Fonts search.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addToManifest } from './fonts-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts/.cache');
const OUT = path.join(ROOT, 'public/fonts');
const BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/';
const FONTS = [
  { name: 'IM Fell English Regular', file: 'imfellenglish/IMFeENrm28P.ttf' },
  { name: 'IM Fell English Italic', file: 'imfellenglish/IMFeENit28P.ttf' },
  { name: 'IM Fell English SC Regular', file: 'imfellenglishsc/IMFeENsc28P.ttf' },
  { name: 'IM Fell DW Pica Regular', file: 'imfelldwpica/IMFePIrm28P.ttf' },
  { name: 'IM Fell DW Pica Italic', file: 'imfelldwpica/IMFePIit28P.ttf' },
  { name: 'Old Standard TT Regular', file: 'oldstandardtt/OldStandard-Regular.ttf' },
  { name: 'Old Standard TT Italic', file: 'oldstandardtt/OldStandard-Italic.ttf' },
  { name: 'Old Standard TT Bold', file: 'oldstandardtt/OldStandard-Bold.ttf' },
  { name: 'Libre Caslon Text Regular', file: 'librecaslontext/LibreCaslonText[wght].ttf' },
  { name: 'Libre Caslon Text Italic', file: 'librecaslontext/LibreCaslonText-Italic[wght].ttf' },
];

async function fetchFont(file) {
  const local = path.join(CACHE, file.replace(/[\/\[\]]/g, '_'));
  try {
    return await fs.readFile(local);
  } catch {}
  const url = BASE + file.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(local, buf);
  return buf;
}

await fs.mkdir(path.join(OUT, 'ttf'), { recursive: true });
for (const f of FONTS) {
  await fs.writeFile(path.join(OUT, 'ttf', f.name.replace(/ /g, '-') + '.ttf'), await fetchFont(f.file));
  console.log(f.name);
}
await addToManifest(OUT, FONTS.map((f) => f.name));
