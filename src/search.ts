import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { el } from './ui';
import type { Rect } from './poster';

interface Hit {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // south, north, west, east
}

/** Nominatim place search (on Enter only, per its usage policy); a result is centred in the frame and fitted to it. */
export function createSearch(
  map: MLMap,
  getFrame: () => Rect,
  stage: HTMLElement,
  onPick: (name: string) => void,
): HTMLElement {
  const input = el('input', { type: 'search', placeholder: 'Search a place and press Enter…', 'aria-label': 'Search a place' }) as HTMLInputElement;
  const results = el('ul', { class: 'search-results', hidden: '' });
  const form = el('form', { class: 'search' }, input, results);

  const close = () => results.setAttribute('hidden', '');

  function go(hit: Hit) {
    close();
    input.value = hit.display_name.split(',').slice(0, 2).join(',');
    const [s, n, w, e] = hit.boundingbox.map(Number);
    const f = getFrame();
    const pad = 24;
    // Padding confines the fit to the frame rather than the whole stage.
    const padding = {
      top: f.y + pad,
      left: f.x + pad,
      bottom: stage.clientHeight - f.y - f.height + pad,
      right: stage.clientWidth - f.x - f.width + pad,
    };
    const cam = map.cameraForBounds(new maplibregl.LngLatBounds([w, s], [e, n]), { padding });
    // The frame is centred on the stage, so the map centre is the frame centre.
    map.flyTo({ center: [+hit.lon, +hit.lat], zoom: Math.min(cam?.zoom ?? 13, 15), bearing: map.getBearing(), duration: 1400 });
    onPick(hit.display_name.split(',')[0].trim());
  }

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    results.replaceChildren(el('li', { class: 'muted' }, 'Searching…'));
    results.removeAttribute('hidden');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`);
      const hits: Hit[] = await r.json();
      if (!hits.length) {
        results.replaceChildren(el('li', { class: 'muted' }, 'No matches'));
        return;
      }
      if (hits.length === 1) return go(hits[0]);
      results.replaceChildren(
        ...hits.map((h) => {
          const li = el('li', { tabindex: '0' }, el('b', {}, h.display_name.split(',')[0]), el('span', {}, h.display_name.split(',').slice(1, 4).join(',')));
          li.onclick = () => go(h);
          li.onkeydown = (k) => k.key === 'Enter' && go(h);
          return li;
        }),
      );
    } catch {
      results.replaceChildren(el('li', { class: 'muted' }, 'Search failed — check your connection'));
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.addEventListener('click', (e) => !form.contains(e.target as Node) && close());
  return form;
}
