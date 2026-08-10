# JSLibrary

Client-side HTML → PDF with print fidelity. Converts live DOM content into a
**real vector PDF** in the browser — no server, no headless Chrome, no
rasterization.

Text stays selectable and searchable, fonts are embedded and subset, inline SVG
becomes vector paths, and files stay small. Nothing is fetched at runtime.

> **Status: Milestone 7 complete — links, bookmarks and vector SVG.** `render()` works end to
> end: measured DOM in, multi-page vector PDF out. Pages break where content
> allows, tables repeat their header and footer on every page they span, and
> output matches the browser's own rendering within a 0.5% pixel diff. The
> document's own `@page` rules drive page size and margins, all sixteen margin
> boxes print, `counter(page)`/`counter(pages)` and GCPM named strings resolve,
> and `break-before: right` generates the blank page it implies. `<a href>`
> becomes a link annotation per line box, in-document anchors become GoTo
> destinations, headings become a bookmark tree, and inline SVG becomes real
> vector paths — no rasterization anywhere. License verification and the Pro
> package are M8. See [`CLAUDE.md`](./CLAUDE.md) for the full brief and
> milestone plan.
>
> Note that `@page` and `string-set` are read from authored CSS rather than the
> CSSOM: a browser discards declarations it does not implement, so a `<style>`
> element's text is the only faithful record. Rules in a linked stylesheet are
> subject to that stripping, and a cross-origin sheet cannot be read at all.

## Approach

The browser is the layout engine. This library owns the two things it will not
do for you — **fragmentation policy** and **PDF emission**:

1. **Measure** — clone the target DOM into a hidden container sized to the exact
   page content box, and let the browser lay it out.
2. **Fragment** — walk the laid-out tree, decide breaks, chunk content into page
   containers, and let the browser reflow each one.
3. **Extract** — read final geometry back via `Range.getClientRects()`, computed
   styles, backgrounds, borders, images, SVG.
4. **Emit** — map boxes to PDF content-stream operators and write the byte
   stream.

Browser-only by design. Node support would require headless Chrome, which
defeats the purpose.

## Usage

```ts
import { render } from "@pkg/core";

const pdf = await render(document.querySelector("#report"), {
  pageSize: "Letter",
  margins: "0.5in",
  fonts: [{ family: "Inter", data: interRegularBytes }],
});
```

Fonts are passed as bytes. The browser does not expose the bytes of a font it
has loaded, and fetching them would break the no-network guarantee that makes
this library work offline and behind a corporate firewall.

## Packages

| Package | License | Contents |
| --- | --- | --- |
| `@pkg/core` | AGPL-3.0 or commercial | Measurement, fragmentation, font subsetting, page furniture, links, bookmarks, SVG |
| `@pkg/pro` | Commercial only | PDF/A, PDF/UA, AcroForms, signatures, encryption, print production, merge, streaming writer |

## Fragmentation

| Rule | Status |
| --- | --- |
| `break-before` / `break-after` (page, always, left, right, recto, verso) | Supported |
| `break-inside: avoid` | Supported |
| `orphans` / `widows` | Supported, with `options.orphans` / `options.widows` for engines that do not expose the CSS properties |
| Repeating `<thead>` on every page a table spans | Supported |
| `<tfoot>` at the foot of every page a table spans | Supported |
| Images, canvas and SVG never divided | Supported; an element taller than the page overflows rather than being cut |
| `box-decoration-break: slice` / `clone` | Both supported |
| Floats and absolutely positioned boxes | Kept whole, never duplicated |
| `position: sticky` | Degrades to its static position |
| Splitting a tall table row across pages | Not yet: a row taller than the page overflows |

## Font support

Fonts are parsed and subset in-house rather than with fontkit, which bundles to
146 KB gzip — more than twice this library's entire 60 KB budget.

| Format | Status |
| --- | --- |
| TrueType (`glyf` outlines), `.ttf` | Supported |
| OpenType with TrueType outlines | Supported |
| WOFF 1 | Supported (zlib, via pako) |
| OpenType with CFF outlines | Rejected with an explicit message |
| WOFF 2 | Rejected: needs a Brotli decoder, which alone exceeds the bundle budget |

Subset fonts are embedded as `CIDFontType2` with `Identity-H` encoding and a
`ToUnicode` CMap, so the full Unicode range works and extracted text round-trips.

## SVG

Inline `<svg>` is converted to PDF path operators. Nothing is rasterized, so a
drawing stays sharp at any zoom and costs a few hundred bytes.

| Feature | Status |
| --- | --- |
| `path` (all commands, absolute and relative, arcs and smooth curves) | Supported |
| `rect` (with `rx`/`ry`), `circle`, `ellipse`, `line`, `polyline`, `polygon` | Supported |
| `g` and nested `transform` (matrix, translate, scale, rotate, skew) | Supported |
| `viewBox` and `preserveAspectRatio`, including `slice` and `none` | Supported |
| Fill and stroke colour, `fill-rule`, width, cap, join, dashes, opacity | Supported |
| Styling from CSS rules, presentation attributes or inheritance | Supported: computed style is what is read |
| Gradients and patterns (`fill="url(#id)"`) | Not supported: the shape is left unpainted rather than filled with a wrong flat colour |
| `text` inside SVG | Not supported |
| `use`, `clipPath`, `mask`, filters | Not supported: they draw nothing rather than something wrong |

Quadratic curves are converted to cubics exactly. Arcs have no exact Bézier
form and are split into segments of at most 90°, which is the standard
construction and is accurate to far less than a printer dot.

## Interactivity

| Feature | Status |
| --- | --- |
| `<a href>` → link annotation | Supported, one rectangle per line box a link occupies |
| Link split across a page break | Supported: each page gets its own clipped rectangle |
| In-document `#anchor` → `GoTo` destination | Supported |
| Relative hrefs | Resolved against the document's base URL |
| A fragment naming no element | No annotation is written, rather than one that goes nowhere |
| Named destinations (`report.pdf#sec-2`) | Published as a `/Names /Dests` name tree |
| Heading hierarchy → bookmarks | Supported; a skipped level nests under whatever is open |

Both can be turned off with `options.links` and `options.outline`.

## Development

```bash
pnpm install
pnpm verify          # typecheck, unit tests, build, size budget, CSP guard
pnpm test:browser --project=chromium
```

`pnpm verify` is what CI runs. The bundle-size budget (core ≤ 60 KB gzip,
excluding fonts) and the strict-CSP guard both fail the build.

Browser tests need browsers: `pnpm exec playwright install chromium`. In a
container that already ships one whose build does not match this Playwright
version, point at it instead:
`PW_CHROMIUM_EXECUTABLE=/path/to/chromium pnpm test:browser --project=chromium`.

The PDF conformance test needs `qpdf` on PATH (`apt-get install qpdf`). It skips
locally when absent and fails when absent in CI — validating output against an
independent implementation is not optional there.

### What may be a golden

Goldens live in `tests/browser/goldens`, one set per browser. Refresh with
`UPDATE_GOLDENS=1 pnpm test:browser` and review the diff before committing — an
updated golden asserts the new rendering is correct.

Only output that does **not** depend on browser text metrics may be committed as
a golden. Engines disagree about glyph advances on identical content — one
Chrome build reports 9.633px where another snaps to 10 — so a golden over
measured geometry records the machine that produced it rather than anything
about this code.

Everything that does depend on layout is verified within a single environment
instead:

| Property | How it is checked |
| --- | --- |
| Measurement is repeatable | Same input measured repeatedly, across page loads and contexts |
| Measurement is sane | Structural invariants: baselines inside line boxes, clusters ordered, content box inside border box |
| Output matches the browser | The rendered PDF is diffed against that same browser's screenshot |
| PDF construction is stable | Pixel goldens, for output built without any browser layout |

## License

Dual licensed: [AGPL-3.0](./LICENSE) or a
[commercial license](./COMMERCIAL-LICENSE.md). `@pkg/pro` is commercial only.
