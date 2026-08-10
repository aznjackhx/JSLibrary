# JSLibrary

Client-side HTML → PDF with print fidelity. Converts live DOM content into a
**real vector PDF** in the browser — no server, no headless Chrome, no
rasterization.

Text stays selectable and searchable, fonts are embedded and subset, inline SVG
becomes vector paths, and files stay small. Nothing is fetched at runtime.

> **Status: Milestone 5 — fragmentation.** `render()` works end to end:
> measured DOM in, multi-page vector PDF out. Pages break where content allows,
> tables repeat their header and footer on every page they span, and output
> matches the browser's own rendering within a 0.5% pixel diff. Page furniture
> (`@page` rules, margin boxes, page counters) is M6. See
> [`CLAUDE.md`](./CLAUDE.md) for the full brief and milestone plan.

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
