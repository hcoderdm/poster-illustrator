// A small declarative control panel: each control binds to a dotted path in Settings.

import { DASHES, PATTERNS, type Settings } from './settings';

export type ChangeKind = 'style' | 'water' | 'mask' | 'grain' | 'frame' | 'palette' | 'mode' | 'quality' | 'none';

type Path = string;

export type Control =
  | { type: 'color'; path: Path; label: string }
  | { type: 'range'; path: Path; label: string; min: number; max: number; step: number }
  | { type: 'number'; path: Path; label: string; min?: number; max?: number; step?: number }
  | { type: 'toggle'; path: Path; label: string }
  | { type: 'select'; path: Path; label: string; options: string[] | (() => string[]) }
  | { type: 'line'; path: Path; label: string; extras?: Control[] }
  | { type: 'area'; path: Path; label: string; note?: string | (() => string); extras?: Control[] }
  | { type: 'text'; path: Path; label: string; placeholder?: string | (() => string) }
  | { type: 'labelClass'; path: Path; label: string }
  | { type: 'heading'; text: string }
  | { type: 'note'; text: string | (() => string) }
  | { type: 'group'; label: string; controls: Control[] }
  | { type: 'custom'; render: () => HTMLElement };

export interface Section {
  title: string;
  open?: boolean;
  controls: Control[];
}

function getPath(obj: unknown, path: Path): any {
  return path.split('.').reduce((o: any, k) => o?.[k], obj);
}

export function setPath(obj: unknown, path: Path, value: unknown) {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce((o: any, k) => o[k], obj);
  target[last] = value;
}

function kindFor(path: Path): ChangeKind {
  if (path === 'mode') return 'mode';
  if (path === 'previewQuality') return 'quality';
  if (path === 'water.inland') return 'mask';
  if (path.startsWith('palette.') || path.startsWith('adjust.')) return 'palette';
  if (path.startsWith('water.')) return 'water';
  if (path.startsWith('layers.') || path.startsWith('labels.')) return 'style';
  if (path.startsWith('paper.')) return 'grain';
  if (path.startsWith('export.') || path.startsWith('poster.')) return 'frame';
  return 'none';
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) (e as any)[k.toLowerCase()] = v;
    else if (v !== undefined) e.setAttribute(k, String(v));
  }
  e.append(...children);
  return e;
}

const fmt = (v: number, step: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(Math.min(3, Math.max(0, -Math.floor(Math.log10(step))))));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class Panel {
  private refreshers: (() => void)[] = [];
  private sectionPaths: Path[] = [];

  constructor(
    private root: HTMLElement,
    private settings: () => Settings,
    private onChange: (path: Path, kind: ChangeKind) => void,
    private defaults: Settings,
  ) {}

  build(sections: Section[]) {
    this.root.innerHTML = '';
    this.refreshers = [];
    for (const sec of sections) {
      this.sectionPaths = [];
      const body = el('div', { class: 'section-body' });
      for (const c of sec.controls) body.append(this.control(c));
      const paths = this.sectionPaths;
      if (paths.length) {
        const reset = el('button', { type: 'button', class: 'section-reset' }, 'Reset section') as HTMLButtonElement;
        reset.onclick = () => this.reset(paths);
        body.append(reset);
      }
      const det = el('details', { class: 'section' }, el('summary', {}, sec.title), body);
      if (sec.open) det.setAttribute('open', '');
      this.root.append(det);
    }
  }

  /** Restore paths to their defaults, firing one change per affected kind. */
  reset(paths: Path[]) {
    // A focused number box skips syncing (so typing isn't overwritten); release it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const kinds = new Map<ChangeKind, Path>();
    for (const p of paths) {
      setPath(this.settings(), p, structuredClone(getPath(this.defaults, p)));
      kinds.set(kindFor(p), p);
    }
    this.refresh();
    for (const [kind, p] of kinds) this.onChange(p, kind);
  }

  // A ↺ button that resets one setting; dimmed while the value is already the default.
  private resetBtn(path: Path) {
    this.sectionPaths.push(path);
    const b = el('button', { type: 'button', class: 'reset', title: 'Reset to default' }, '↺') as HTMLButtonElement;
    b.onclick = (e) => {
      e.preventDefault();
      this.reset([path]);
    };
    const sync = () => b.classList.toggle('changed', !same(getPath(this.settings(), path), getPath(this.defaults, path)));
    this.refreshers.push(sync);
    sync();
    return b;
  }

  /** Re-read every control from settings (after loading a preset, etc). */
  refresh() {
    for (const r of this.refreshers) r();
  }

  private set(path: Path, v: unknown) {
    setPath(this.settings(), path, v);
    this.onChange(path, kindFor(path));
    this.refresh();
  }

  // Slider plus a number box (with the browser's up/down arrows) for exact values.
  private range(path: Path, label: string, min: number, max: number, step: number) {
    const slider = el('input', { type: 'range', min, max, step }) as HTMLInputElement;
    const box = el('input', { type: 'number', step, class: 'num' }) as HTMLInputElement;
    const sync = () => {
      const v = getPath(this.settings(), path);
      slider.value = String(v);
      if (document.activeElement !== box) box.value = fmt(v, step);
    };
    slider.oninput = () => {
      box.value = fmt(+slider.value, step);
      this.set(path, +slider.value);
    };
    // Typed values may go beyond the slider's range on purpose.
    box.oninput = () => {
      const v = parseFloat(box.value);
      if (Number.isFinite(v)) this.set(path, v);
    };
    box.onblur = sync;
    this.refreshers.push(sync);
    sync();
    return el('label', { class: 'row range' }, el('span', {}, label), slider, box, this.resetBtn(path));
  }

  private toggle(path: Path, label: string, compact = false) {
    const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
    const sync = () => (input.checked = !!getPath(this.settings(), path));
    input.onchange = () => this.set(path, input.checked);
    this.refreshers.push(sync);
    sync();
    if (compact) {
      this.sectionPaths.push(path);
      return input;
    }
    return el('label', { class: 'row toggle' }, el('span', {}, label), input, this.resetBtn(path));
  }

  private note(text: string | (() => string)) {
    const n = el('div', { class: 'note' });
    const sync = () => (n.textContent = typeof text === 'function' ? text() : text);
    this.refreshers.push(sync);
    sync();
    return n;
  }

  // Collapsible group; with showPath its header carries the layer's visibility checkbox.
  private layerGroup(label: string, showPath: Path | null, body: HTMLElement[]) {
    const head = el('summary', {}, ...(showPath ? [this.toggle(showPath, '', true)] : []), el('span', {}, label));
    head.querySelector('input')?.addEventListener('click', (e) => e.stopPropagation());
    return el('details', { class: 'group layer' }, head, el('div', { class: 'group-body' }, ...body));
  }

  private control(c: Control): HTMLElement {
    switch (c.type) {
      case 'color': {
        const input = el('input', { type: 'color' }) as HTMLInputElement;
        const sync = () => (input.value = getPath(this.settings(), c.path));
        input.oninput = () => this.set(c.path, input.value);
        this.refreshers.push(sync);
        sync();
        return el('label', { class: 'row color' }, el('span', {}, c.label), input, this.resetBtn(c.path));
      }
      case 'range':
        return this.range(c.path, c.label, c.min, c.max, c.step);
      case 'number': {
        const input = el('input', { type: 'number', min: c.min, max: c.max, step: c.step ?? 'any' }) as HTMLInputElement;
        const sync = () => {
          if (document.activeElement !== input) input.value = String(getPath(this.settings(), c.path));
        };
        input.oninput = () => {
          const v = +input.value;
          // With an explicit min (e.g. 0 for margins) that's the floor; otherwise values must be positive.
          if (input.value !== '' && Number.isFinite(v) && (c.min !== undefined ? v >= c.min : v > 0)) this.set(c.path, v);
        };
        input.onblur = sync;
        this.refreshers.push(sync);
        sync();
        return el('label', { class: 'row number' }, el('span', {}, c.label), input, this.resetBtn(c.path));
      }
      case 'toggle':
        return this.toggle(c.path, c.label);
      case 'select': {
        const input = el('select') as HTMLSelectElement;
        const sync = () => {
          const opts = typeof c.options === 'function' ? c.options() : c.options;
          const v = getPath(this.settings(), c.path);
          // Keep a saved value selectable even if it's not in the list (e.g. a font that was removed).
          const all = opts.includes(v) ? opts : [v, ...opts];
          if (input.options.length !== all.length || [...input.options].some((o, i) => o.value !== all[i])) {
            input.replaceChildren(...all.map((o) => el('option', { value: o }, o)));
          }
          input.value = v;
        };
        input.onchange = () => this.set(c.path, input.value);
        this.refreshers.push(sync);
        sync();
        return el('label', { class: 'row select' }, el('span', {}, c.label), input, this.resetBtn(c.path));
      }
      case 'line': {
        const p = c.path;
        return this.layerGroup(c.label, `${p}.show`, [
          this.control({ type: 'color', path: `${p}.color`, label: 'Colour' }),
          this.range(`${p}.width`, 'Width', 0.1, 5, 0.05),
          this.range(`${p}.opacity`, 'Opacity', 0, 1, 0.01),
          this.control({ type: 'select', path: `${p}.dash`, label: 'Line style', options: DASHES }),
          this.range(`${p}.minzoom`, 'Min zoom', 0, 18, 0.5),
          this.range(`${p}.minWidth`, 'Min width', 0, 3, 0.05),
          ...(c.extras ?? []).map((x) => this.control(x)),
        ]);
      }
      case 'area': {
        const p = c.path;
        return this.layerGroup(c.label, `${p}.show`, [
          this.control({ type: 'heading', text: 'Fill' }),
          this.control({ type: 'color', path: `${p}.fill`, label: 'Colour' }),
          this.range(`${p}.fillOpacity`, 'Opacity', 0, 1, 0.01),
          this.control({ type: 'heading', text: 'Engraved pattern' }),
          this.control({ type: 'select', path: `${p}.pattern`, label: 'Pattern', options: PATTERNS }),
          this.control({ type: 'color', path: `${p}.patternColor`, label: 'Colour' }),
          this.range(`${p}.patternOpacity`, 'Opacity', 0, 1, 0.01),
          this.range(`${p}.patternSpacing`, 'Spacing', 1.5, 20, 0.5),
          this.range(`${p}.patternWidth`, 'Line width', 0.2, 3, 0.05),
          this.control({ type: 'heading', text: 'Border' }),
          this.toggle(`${p}.outline`, 'Show border'),
          this.control({ type: 'color', path: `${p}.outlineColor`, label: 'Colour' }),
          this.range(`${p}.outlineWidth`, 'Width', 0.1, 4, 0.05),
          this.range(`${p}.outlineOpacity`, 'Opacity', 0, 1, 0.01),
          this.control({ type: 'select', path: `${p}.outlineDash`, label: 'Line style', options: DASHES }),
          this.control({ type: 'heading', text: 'Visibility' }),
          this.range(`${p}.minzoom`, 'Min zoom', 0, 18, 0.5),
          ...(c.extras ?? []).map((x) => this.control(x)),
          ...(c.note ? [this.note(c.note)] : []),
        ]);
      }
      case 'text': {
        const input = el('input', { type: 'text' }) as HTMLInputElement;
        const sync = () => {
          if (document.activeElement !== input) input.value = getPath(this.settings(), c.path) ?? '';
          input.placeholder = typeof c.placeholder === 'function' ? c.placeholder() : (c.placeholder ?? '');
        };
        input.oninput = () => this.set(c.path, input.value);
        input.onblur = sync;
        this.refreshers.push(sync);
        sync();
        return el('label', { class: 'row text' }, el('span', {}, c.label), input, this.resetBtn(c.path));
      }
      case 'labelClass':
        return this.layerGroup(c.label, `${c.path}.show`, [this.range(`${c.path}.size`, 'Size', 4, 60, 0.5), this.range(`${c.path}.minzoom`, 'Min zoom', 0, 18, 0.5)]);
      case 'heading':
        return el('div', { class: 'sub' }, c.text);
      case 'note':
        return this.note(c.text);
      case 'group':
        return this.layerGroup(c.label, null, c.controls.map((x) => this.control(x)));
      case 'custom':
        return c.render();
    }
  }
}
