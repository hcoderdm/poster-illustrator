# Map Art

An interactive map styled after 19th-century engraved maps, for exporting print-resolution poster PNGs. It uses OpenStreetMap data through OpenFreeMap vector tiles, so no API key is needed.

## Inspiration

The style is modelled on the 1875 *Map of Boston* in the New York Public Library's Digital Collections: [digitalcollections.nypl.org/items/9633a260-88d4-0134-3429-00505686a51c](https://digitalcollections.nypl.org/items/9633a260-88d4-0134-3429-00505686a51c?canvasIndex=0). That map's sepia palette, engraved shoreline rings and spaced serif lettering are what the defaults recreate. Copies used for reference are in `old_map_boston.jpg` and `old_map_boston_large.jpg`.

## Run

```bash
npm install
npm run fonts    # one-time: downloads the bundled OFL serif fonts into public/fonts/ttf
npm run dev
```

Open http://localhost:5173.

## Use

The header has the place search, the view mode, the on-screen resolution and an exact zoom box. Searching centres the place in the poster frame and fits it inside.

- **Original / Styled / Preview** switches the view:
  - **Original** is OpenFreeMap's standard style, with none of your settings.
  - **Styled** is your style on the whole live map.
  - **Preview** is the poster exactly as it will export. Labels poking out of the frame are nudged inside or hidden.
- **Resolution** (0.5×–2×) is for the screen only; **Export PNG** always renders at full print size.

The panel has three groups. Every row has a number box with up/down arrows and a ↺ reset button, layers and label classes are collapsible groups with a visibility checkbox, and every section has **Reset section**.

**Poster**

- **Size & export**: width, height, unit and DPI, and **Export PNG**. 18×24 in at 300 DPI (5400×7200 px) takes a few seconds. Each side is capped at the GPU's limit (16384 px on Apple Silicon).
- **Layout**:
  - Margins (plain white when printed) and a single or double border.
  - **Searched place position**: optionally place the searched place off-centre, by a percentage of the distance from the map's centre to its edge (for example 33% up).
- **Title & credits**:
  - A title (the searched place by default) with subtitle, font, size, spacing, case, alignment and nudge.
  - Credits bottom-left and the month and year bottom-right. The default credit follows each project's print attribution guidelines: OpenStreetMap with its ODbL licence and the printed URL openstreetmap.org/copyright, © OpenMapTiles with openmaptiles.org, and OpenFreeMap.

**Map style** (ordered the way the map is drawn, from the bottom up)

- **Colour & paper**: one of 11 colour themes; overall brightness, contrast, saturation, hue, warmth and fade, which shift every colour at once; base colours; and paper grain, which is applied to the map only.
- **Water**: the tint, whether lakes and rivers count, and the engraved shoreline rings (number of lines, spacing, growth, width, fade, shoreline, hand-drawn wobble).
- **Land & buildings**: each area class has a fill, an engraved pattern (hatch, cross-hatch, dots, stipple and more) and a border. Buildings sit on an opaque base, can show individual houses, and can appear from zoom 10.
- **Roads & lines**:
  - Road data: *standard*, *more* or *all*. Residential streets start at zoom 12 in the data, and service roads and paths at 13.
  - Each road type, railway, runway, river and boundary has its own colour, width, minimum width, opacity, dash style and minimum zoom.
- **Labels**:
  - Fonts per class, including **Add a Google Font** (works under `npm run dev` only).
  - Lettering (case, spacing, curves) and halo (colour, distance, blur, opacity).
  - Per-class size and minimum zoom.
  - Places of interest (schools, churches, museums…) by category.
- **Label placement**: Label data (*standard*, *more* or *all*, which merges names from detailed tiles so small places show when zoomed out), density, fitting to the frame, and the searched place's size.

**Saved settings**

- **Presets & files**: named presets saved in the browser, JSON download and upload, and reset all.

## How it works

- `src/style/vintage.ts` builds the MapLibre style from the settings. Point labels are placed by MapLibre invisibly, then redrawn from computed copies (`src/labels/fit.ts`). Every halo is drawn beneath every label's text, curved labels are set letter by letter, and Preview and the export fit labels to the frame.
- `src/style/tiles.ts` registers the `buildings://`, `roads://` and `detail://` protocols. They build low-zoom tiles by merging and clipping their higher-zoom descendants, because OpenMapTiles drops houses, small roads and minor names from low-zoom tiles.
- `src/waterlines/` renders a water-only mask with a hidden second map. A Web Worker turns it into a signed distance field and engraves anti-aliased rings along its isolines. The result is an opaque raster layer drawn above land tints and below roads.
- `src/export.ts` renders an offscreen map at the on-screen map area's CSS size with a large `pixelRatio`, so it matches the Preview. It then adds the margins, title and footer (`src/poster.ts`) and the grain (`src/paper.ts`), and encodes a PNG.
- Labels are drawn by MapLibre straight from the TTFs, which `src/fonts.ts` registers as web fonts. The style has no glyph server, so MapLibre rasterises each glyph at double resolution with the browser's font engine, and fine serifs survive.
