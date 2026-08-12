# JSLibrary

Client-side HTML → PDF with print fidelity. Converts live DOM content into a
**real vector PDF** in the browser — no server, no headless Chrome, no
rasterization.

Text stays selectable and searchable, fonts are embedded and subset, inline SVG
becomes vector paths, and files stay small. Nothing is fetched at runtime.

> **Status: Milestone 8 complete — the brief's plan is done.** `render()` works
> end to end: measured DOM in, multi-page vector PDF out. Pages break where content
> allows, tables repeat their header and footer on every page they span, and
> output matches the browser's own rendering within a 0.5% pixel diff. The
> document's own `@page` rules drive page size and margins, all sixteen margin
> boxes print, `counter(page)`/`counter(pages)` and GCPM named strings resolve,
> and `break-before: right` generates the blank page it implies. `<a href>`
> becomes a link annotation per line box, in-document anchors become GoTo
> destinations, headings become a bookmark tree, and inline SVG becomes real
> vector paths — no rasterization anywhere. `@pkg/pro` adds Ed25519 licence
> verification and PDF/A-2b output, validated against veraPDF in CI. See
> [`CLAUDE.md`](./CLAUDE.md) for the full brief and milestone plan.
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
| Linear and radial gradients, in either units, with `gradientTransform` and `href` inheritance | Supported: emitted as PDF shadings, one per distinct gradient |
| `text` and `tspan` | Supported: real, selectable text, positioned by the browser so `text-anchor`, `dx`/`dy` and `textLength` all hold |
| `use` | Supported, including a `symbol` or `g` in `defs`, with cycle protection |
| `spreadMethod` other than `pad` | Degrades to `pad` |
| Gradient stop opacity | Paints at full strength: honouring it needs a luminosity soft mask |
| `pattern` fills | Not supported: the shape is left unpainted rather than filled with a wrong flat colour |
| `clipPath`, `mask`, filters, `textPath`, per-character `rotate` | Not supported: they draw nothing rather than something wrong |

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

## Known gaps

Deliberate, and each one is a decision rather than an oversight:

- **No text shaping.** Arabic, Persian, Urdu and Indic scripts render with
  isolated letter forms — wrong rather than merely imperfect, because glyphs
  are looked up through the font's `cmap` alone. The renderer detects these
  scripts and warns, naming the script and the symptom, rather than producing
  unreadable output silently.
- **WOFF2 is rejected.** Decoding it needs a Brotli decompressor and the
  reversal of WOFF2's transformed glyph encoding. Supply TTF, OTF or WOFF —
  the error names the conversion command.
- **CFF outlines cannot be subset**, so a font with PostScript outlines fails
  rather than embedding whole.
- **Memory is roughly 0.7–1 MB per output page**, with the measured tree, every
  image and the whole byte buffer held at once. The practical ceiling is around
  a thousand pages.
- **Named pages** (`@page cover` with `page: cover`) are parsed and ignored.
  Margin-box sizing is equal thirds of each edge rather than the
  specification's content-based sizing, and counters other than `page` and
  `pages` resolve to nothing.
- **SVG gaps** are listed in the table above; each draws nothing rather than
  something wrong.
- **Licence verification needs a secure context.** `crypto.subtle` does not
  exist on a page served over plain HTTP, so verification there reports
  `unsupported-platform` and Pro output is watermarked. That is reported
  rather than silently treated as a forged key.

## Commercial add-ons

`@pkg/pro` is licensed separately and is never published under an open
licence. Unlicensed use warns once and watermarks each page; it never throws
and never corrupts output.

The licence check is `buildDate <= license.updatesUntil` — deliberately not
`Date.now() <= license.updatesUntil`. A customer's build keeps working
forever; the key only gates whether *newer releases* accept it. There is no
phone-home, no revocation, and no network request of any kind.

Generate a signing keypair with `node scripts/license-keygen.mjs`, paste the
public half into `packages/pro/src/license/public-key.ts`, and keep the
private half off this repository. Issue keys with
`node scripts/sign-license.mjs`.

## License

Dual licensed: [AGPL-3.0](./LICENSE) or a
[commercial license](./COMMERCIAL-LICENSE.md). `@pkg/pro` is commercial only.
