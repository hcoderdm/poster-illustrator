import maplibregl from 'maplibre-gl';
import { VectorTile, type VectorTileLayer } from '@mapbox/vector-tile';
import Pbf from 'pbf';

// OpenMapTiles drops detail from low-zoom tiles (houses below 14, small streets
// below 12–13, minor place names below 11–14). These custom protocols build a
// low-zoom tile by merging its higher-zoom descendants, so that detail can be
// shown when zoomed out. URL: {kind}://{sourceZoom}/{z}/{x}/{y}

export const TILES_URL = 'https://tiles.openfreemap.org/planet';

export type MergedKind = 'buildings' | 'roads' | 'detail';
export const mergedUrl = (kind: MergedKind, sourceZoom: number) => `${kind}://${sourceZoom}/{z}/{x}/{y}`;
/** Lowest zoom worth merging for a source zoom: 4 levels down is already 256 tiles per tile. */
export const minMergedZoom = (sourceZoom: number) => sourceZoom - 4;
export const NATIVE_BUILDING_ZOOM = 13;

// MapLibre stores tile geometry on an 8192 grid; using all of it keeps small shapes intact.
const EXTENT = 8192;

type Pt = [number, number];
type Value = string | number | boolean;
type Feat = { type: 1 | 2 | 3; parts: Pt[][]; props?: Record<string, Value> };

let template: Promise<string> | null = null;

async function fetchTile(z: number, x: number, y: number, signal: AbortSignal): Promise<VectorTile | null> {
  // A failed lookup isn't cached, so the next tile retries it.
  template ??= fetch(TILES_URL).then((r) => r.json()).then((j) => j.tiles[0] as string, (e) => ((template = null), Promise.reject(e)));
  const url = (await template).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url, { signal });
  return res.ok ? new VectorTile(new Pbf(await res.arrayBuffer())) : null;
}

const pick = (props: Record<string, Value>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => props[k] !== undefined).map((k) => [k, props[k]]));

// Sutherland–Hodgman clip of a ring to [0, size]²; children carry a buffer that would otherwise overlap.
function clipRing(ring: Pt[], size: number): Pt[] {
  let pts = ring;
  for (const [axis, v, upper] of [[0, 0, false], [0, size, true], [1, 0, false], [1, size, true]] as const) {
    const inside = (p: Pt) => (upper ? p[axis] <= v : p[axis] >= v);
    const out: Pt[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) {
        const t = (v - a[axis]) / (b[axis] - a[axis]);
        out.push(axis === 0 ? [v, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), v]);
      }
    });
    pts = out;
  }
  return pts;
}

// Splits a clipped ring into open paths without the clip edges, so outlines don't show tile seams.
function outlinePaths(ring: Pt[], size: number): Pt[][] {
  const onEdge = (a: Pt, b: Pt) => (a[0] === b[0] && (a[0] <= 0 || a[0] >= size)) || (a[1] === b[1] && (a[1] <= 0 || a[1] >= size));
  const n = ring.length;
  let start = 0;
  for (let i = 0; i < n; i++) if (onEdge(ring[i], ring[(i + 1) % n])) start = (i + 1) % n;
  const paths: Pt[][] = [];
  let cur: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = ring[(start + k) % n], b = ring[(start + k + 1) % n];
    if (onEdge(a, b)) {
      if (cur.length > 1) paths.push(cur);
      cur = [];
    } else {
      if (!cur.length) cur.push(a);
      cur.push(b);
    }
  }
  if (cur.length > 1) paths.push(cur);
  return paths;
}

// Liang–Barsky clip of a polyline to [0, size]², split where it leaves and re-enters.
function clipLine(line: Pt[], size: number): Pt[][] {
  const parts: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1, inside = true;
    for (const [p, q] of [[-dx, a[0]], [dx, size - a[0]], [-dy, a[1]], [dy, size - a[1]]]) {
      if (p === 0 ? q < 0 : p < 0 ? q / p > t1 : q / p < t0) inside = false;
      else if (p < 0) t0 = Math.max(t0, q / p);
      else if (p > 0) t1 = Math.min(t1, q / p);
    }
    if (!inside) {
      if (cur.length > 1) parts.push(cur);
      cur = [];
      continue;
    }
    const s: Pt = [a[0] + t0 * dx, a[1] + t0 * dy], e: Pt = [a[0] + t1 * dx, a[1] + t1 * dy];
    const last = cur[cur.length - 1];
    if (!last || last[0] !== s[0] || last[1] !== s[1]) {
      if (cur.length > 1) parts.push(cur);
      cur = [s];
    }
    cur.push(e);
    if (t1 < 1) {
      parts.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}

function ringArea(r: Pt[]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

/** Feature extractors per kind: given a child layer and a child→parent transform, emit features per layer name. */
const MERGERS: Record<MergedKind, { layers: string[]; merge: (src: Record<string, VectorTileLayer>, toParent: (pts: Pt[]) => Pt[], out: Record<string, Feat[]>) => void }> = {
  buildings: {
    layers: ['building', 'building_outline'],
    merge(src, toParent, out) {
      const layer = src.building;
      if (!layer) return;
      const scale = EXTENT / layer.extent;
      for (let i = 0; i < layer.length; i++) {
        const rings: Pt[][] = [];
        const paths: Pt[][] = [];
        for (const ring of layer.feature(i).loadGeometry()) {
          const pts: Pt[] = ring.map((p) => [p.x * scale, p.y * scale]);
          if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
          const clipped = clipRing(pts, EXTENT);
          if (clipped.length < 3) continue;
          const r = toParent(clipped);
          if (r.length > 2 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
          if (r.length >= 3 && Math.abs(ringArea(r)) >= 0.5) rings.push(r);
          for (const path of outlinePaths(clipped, EXTENT)) {
            const pp = toParent(path);
            if (pp.length > 1) paths.push(pp);
          }
        }
        if (rings.length) out.building.push({ type: 3, parts: rings });
        if (paths.length) out.building_outline.push({ type: 2, parts: paths });
      }
    },
  },
  roads: {
    layers: ['transportation'],
    merge(src, toParent, out) {
      const layer = src.transportation;
      if (!layer) return;
      const scale = EXTENT / layer.extent;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 2) continue;
        const parts = f
          .loadGeometry()
          .flatMap((line) => clipLine(line.map((p) => [p.x * scale, p.y * scale] as Pt), EXTENT))
          .map(toParent)
          .filter((p) => p.length > 1);
        if (parts.length) out.transportation.push({ type: 2, parts, props: pick(f.properties, ['class', 'subclass', 'brunnel', 'service', 'ramp']) });
      }
    },
  },
  detail: {
    layers: ['place', 'poi'],
    merge(src, toParent, out) {
      for (const name of ['place', 'poi']) {
        const layer = src[name];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          const p = f.loadGeometry()[0]?.[0];
          // A point in a child's buffer also appears in its neighbour; keep only its own.
          if (f.type !== 1 || !p || p.x < 0 || p.y < 0 || p.x >= layer.extent || p.y >= layer.extent) continue;
          const scale = EXTENT / layer.extent;
          out[name].push({ type: 1, parts: [toParent([[p.x * scale, p.y * scale]])], props: pick(f.properties, ['name', 'name:en', 'name:latin', 'class', 'subclass', 'rank', 'capital']) });
        }
      }
    },
  },
};

const zigzag = (n: number) => (n << 1) ^ (n >> 31);

function encode(layers: Record<string, Feat[]>): ArrayBuffer {
  const pbf = new Pbf();
  for (const [name, feats] of Object.entries(layers)) {
    const keys: string[] = [], values: Value[] = [];
    const keyIdx = new Map<string, number>(), valIdx = new Map<string, number>();
    pbf.writeMessage(3, (_: unknown, lp: Pbf) => {
      lp.writeVarintField(15, 2);
      lp.writeStringField(1, name);
      for (const f of feats) {
        const tags: number[] = [];
        for (const [k, v] of Object.entries(f.props ?? {})) {
          if (!keyIdx.has(k)) keyIdx.set(k, keys.push(k) - 1);
          const vk = `${typeof v}:${v}`;
          if (!valIdx.has(vk)) valIdx.set(vk, values.push(v) - 1);
          tags.push(keyIdx.get(k)!, valIdx.get(vk)!);
        }
        const geom: number[] = [];
        let cx = 0, cy = 0;
        for (const part of f.parts) {
          geom.push(1 | (1 << 3), zigzag(part[0][0] - cx), zigzag(part[0][1] - cy));
          [cx, cy] = part[0];
          if (part.length > 1) geom.push(2 | ((part.length - 1) << 3));
          for (const [x, y] of part.slice(1)) {
            geom.push(zigzag(x - cx), zigzag(y - cy));
            [cx, cy] = [x, y];
          }
          if (f.type === 3) geom.push(7 | (1 << 3));
        }
        lp.writeMessage(2, (_: unknown, fp: Pbf) => {
          if (tags.length) fp.writePackedVarint(2, tags);
          fp.writeVarintField(3, f.type);
          fp.writePackedVarint(4, geom);
        }, null);
      }
      for (const k of keys) lp.writeStringField(3, k);
      for (const v of values) {
        lp.writeMessage(4, (_: unknown, vp: Pbf) => {
          if (typeof v === 'string') vp.writeStringField(1, v);
          else if (typeof v === 'boolean') vp.writeBooleanField(7, v);
          else if (Number.isInteger(v)) vp.writeSVarintField(6, v);
          else vp.writeDoubleField(3, v);
        }, null);
      }
      lp.writeVarintField(5, EXTENT);
    }, null);
  }
  const bytes = pbf.finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function synthesise(kind: MergedKind, sourceZoom: number, z: number, x: number, y: number, signal: AbortSignal) {
  const { layers, merge } = MERGERS[kind];
  const srcZ = Math.max(sourceZoom, Math.min(z, 14));
  const n = 1 << (srcZ - z);
  const out: Record<string, Feat[]> = Object.fromEntries(layers.map((l) => [l, []]));
  await Promise.all(
    Array.from({ length: n * n }, async (_, i) => {
      const cx = i % n, cy = Math.floor(i / n);
      const tile = await fetchTile(srcZ, x * n + cx, y * n + cy, signal);
      if (!tile) return;
      const toParent = (pts: Pt[]) => {
        const res: Pt[] = [];
        for (const [px, py] of pts) {
          const q: Pt = [Math.round((px + cx * EXTENT) / n), Math.round((py + cy * EXTENT) / n)];
          const last = res[res.length - 1];
          if (!last || last[0] !== q[0] || last[1] !== q[1]) res.push(q);
        }
        return res;
      };
      merge(tile.layers, toParent, out);
    }),
  );
  return encode(out);
}

let registered = false;
export function registerTileProtocols() {
  if (registered) return;
  registered = true;
  for (const kind of Object.keys(MERGERS) as MergedKind[]) {
    maplibregl.addProtocol(kind, async (params, abort) => {
      const [src, z, x, y] = params.url.slice(kind.length + 3).split('/').map(Number);
      return { data: await synthesise(kind, src, z, x, y, abort.signal) };
    });
  }
}
