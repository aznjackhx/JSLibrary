# JSLibrary

Client-side HTML → PDF with print fidelity. Converts live DOM content into a
**real vector PDF** in the browser — no server, no headless Chrome, no
rasterization.

Text stays selectable and searchable, fonts are embedded and subset, inline SVG
becomes vector paths, and files stay small. Nothing is fetched at runtime.

> **Status: Milestone 3 — DOM measurement.** The writer emits valid PDFs with
> subset, embedded fonts, and the measurement stage extracts stable geometry
> from a real browser. `render()` still throws `NotImplementedError` until
> emission joins the two in M4. See [`CLAUDE.md`](./CLAUDE.md) for the full
> brief and milestone plan.

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

## Packages

| Package | License | Contents |
| --- | --- | --- |
| `@pkg/core` | AGPL-3.0 or commercial | Measurement, fragmentation, font subsetting, page furniture, links, bookmarks, SVG |
| `@pkg/pro` | Commercial only | PDF/A, PDF/UA, AcroForms, signatures, encryption, print production, merge, streaming writer |

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

Golden images and geometry goldens currently exist for Chromium only; those
comparisons skip on Firefox and WebKit until goldens are generated on a machine
with them installed. Structural assertions run on all three.

Visual regression goldens live in `tests/browser/goldens`, one set per browser.
Refresh with `UPDATE_GOLDENS=1 pnpm test:browser` and review the diff before
committing — an updated golden asserts the new rendering is correct.

## License

Dual licensed: [AGPL-3.0](./LICENSE) or a
[commercial license](./COMMERCIAL-LICENSE.md). `@pkg/pro` is commercial only.
