import { el } from './ui';

interface Family {
  family: string;
  category: string;
  variants: { id: string; label: string }[];
  popularity: number; // rank, lower = more popular
}

const CATEGORIES = ['All', 'Serif', 'Display', 'Handwriting', 'Sans Serif', 'Monospace'];

/** Search Google Fonts, preview families in their own face, and add a weight as a map font (via the dev server). */
export function createFontPicker(opts: {
  targets: { label: string; path: string }[];
  onAdded: (name: string, fonts: string[]) => void | Promise<void>;
  onAssign: (path: string, name: string) => void;
}): HTMLElement {
  let catalog: Family[] | null = null;
  const query = el('input', { type: 'search', placeholder: 'Search Google Fonts…' }) as HTMLInputElement;
  const category = el('select', {}, ...CATEGORIES.map((c) => el('option', { value: c }, c))) as HTMLSelectElement;
  category.value = 'Serif';
  const list = el('div', { class: 'font-results' });
  const status = el('div', { class: 'font-status' });
  const loadedPreviews = new Set<string>();

  async function ensureCatalog() {
    if (catalog) return catalog;
    status.textContent = 'Loading Google Fonts catalogue…';
    try {
      const r = await fetch('/api/google-fonts');
      if (!r.ok) throw new Error();
      catalog = (await r.json()) as Family[];
      catalog.sort((a, b) => a.popularity - b.popularity);
      status.textContent = '';
    } catch {
      status.textContent = 'Google Fonts search needs the dev server (npm run dev) and an internet connection.';
      catalog = [];
    }
    return catalog;
  }

  function preview(family: string) {
    if (loadedPreviews.has(family)) return;
    loadedPreviews.add(family);
    // &text= limits the download to the glyphs of the family name.
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&text=${encodeURIComponent(family)}&display=swap`;
    document.head.append(el('link', { rel: 'stylesheet', href }));
  }

  async function add(f: Family, variant: Family['variants'][number], btn: HTMLButtonElement) {
    btn.disabled = true;
    status.textContent = `Adding ${f.family} ${variant.label}…`;
    try {
      const r = await fetch('/api/fonts/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ family: f.family, variant: variant.id }) });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error);
      await opts.onAdded(res.name, res.fonts);
      status.replaceChildren(
        el('div', {}, `Added “${res.name}”. Use it for:`),
        el(
          'div',
          { class: 'btns' },
          ...opts.targets.map((t) => {
            const b = el('button', { type: 'button' }, t.label) as HTMLButtonElement;
            b.onclick = () => {
              opts.onAssign(t.path, res.name);
              b.disabled = true;
            };
            return b;
          }),
        ),
      );
    } catch (e) {
      status.textContent = `Couldn't add font: ${(e as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  }

  async function render() {
    const cat = await ensureCatalog();
    const q = query.value.trim().toLowerCase();
    const matches = cat.filter((f) => (category.value === 'All' || f.category === category.value) && (!q || f.family.toLowerCase().includes(q))).slice(0, 12);
    list.replaceChildren(
      ...matches.map((f) => {
        preview(f.family);
        const variant = el('select', {}, ...f.variants.map((v) => el('option', { value: v.id }, v.label))) as HTMLSelectElement;
        if (f.variants.some((v) => v.id === '400')) variant.value = '400';
        const btn = el('button', { type: 'button' }, 'Add') as HTMLButtonElement;
        btn.onclick = () => add(f, f.variants.find((v) => v.id === variant.value)!, btn);
        return el('div', { class: 'font-row' }, el('span', { class: 'font-name', style: `font-family:'${f.family}',serif` }, f.family), variant, btn);
      }),
    );
    if (!matches.length && cat.length) list.replaceChildren(el('div', { class: 'muted' }, 'No matches'));
  }

  let t = 0;
  query.oninput = () => {
    clearTimeout(t);
    t = window.setTimeout(render, 200);
  };
  query.onfocus = () => !list.childElementCount && render();
  category.onchange = render;

  return el('div', { class: 'fontpicker' }, el('div', { class: 'font-search' }, query, category), list, status);
}
