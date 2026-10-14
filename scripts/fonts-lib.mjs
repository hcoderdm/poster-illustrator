import fs from 'node:fs/promises';
import path from 'node:path';

/** Adds names to {outDir}/fonts.json (the list the app offers), keeping order and uniqueness. */
export async function addToManifest(outDir, names) {
  const file = path.join(outDir, 'fonts.json');
  let list = [];
  try {
    list = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {}
  for (const n of names) if (!list.includes(n)) list.push(n);
  await fs.writeFile(file, JSON.stringify(list, null, 2));
  return list;
}
