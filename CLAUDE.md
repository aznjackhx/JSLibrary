# Project Brief: Client-Side HTML → PDF Engine with Print Fidelity

> **How to use this:** Save this file as `CLAUDE.md` at the root of a new empty repo, then start Claude Code and say: *"Read CLAUDE.md. Confirm you understand the architecture, then begin Milestone 0. Stop at the end of each milestone and show me the verification output before proceeding."*
>
> Do not ask Claude Code to build all of this in one session. It is a multi-month product. The milestones are ordered so each one is independently verifiable.

---

## 1. What we are building

A TypeScript library that converts live DOM content into a **real vector PDF** entirely in the browser — no server, no headless Chrome, no rasterization.

The differentiator is **fragmentation quality**: correctly deciding where pages break and what repeats across them. Everything else in this space either rasterizes (html2canvas → jsPDF, producing huge blurry PDFs with unselectable text) or requires server infrastructure (Puppeteer, WeasyPrint, Prince).

### Non-negotiable output properties

- Text is real, selectable, searchable, and copy-pasteable — never an image of text.
- Fonts are embedded and subset, so output renders identically everywhere.
- Inline SVG becomes PDF vector paths, not raster.
- File sizes are small (a 20-page report should be well under 1 MB, not 40 MB).
- Zero network requests at runtime. Works fully offline, works behind a corporate firewall.

---

## 2. Core architectural decision (read this carefully before writing code)

**Do not reimplement CSS layout.** That path leads to a five-year project.

Instead, use **the browser as the layout engine and own the fragmentation policy and PDF emission**. The pipeline:

```
1. MEASURE   Clone target DOM into a hidden container sized to the exact
             page content box (e.g. 8.5in − margins). Let the browser lay it out.

2. FRAGMENT  Walk the laid-out tree. Decide page breaks. Physically chunk
             content into N page containers in the DOM, then let the browser
             reflow each one. (This is the technique Paged.js uses — it is
             proven and it is correct, because the browser does the reflow.)

3. EXTRACT   Read final geometry back out: line-box rects via
             Range.getClientRects(), computed styles, backgrounds, borders,
             images, SVG.

4. EMIT      Map extracted boxes to PDF content-stream operators. Write a
             valid PDF byte stream.
```

Steps 1–3 are the hard part and the moat. Step 4 is well-specified grunt work.

### Known tradeoff, accepted deliberately

This approach requires a real browser layout engine, so Node.js support would need headless Chrome — which defeats the purpose. **v1 is browser-only.** Do not add a Node target. If server-side rendering is ever needed, it ships as a separate optional adapter package, not as a core concern.

---

## 3. Technical requirements by subsystem

### 3.1 PDF writer (`@pkg/core/pdf`)

Hand-rolled, no dependency on jsPDF or pdf-lib. We need control over the object graph for PDF/A and tagging later.

- Indirect object model, cross-reference table, trailer. Support both classic xref tables and xref streams.
- Content stream operator emission: `cm`, `re`, `f`, `S`, `BT/ET`, `Tf`, `Td`, `TJ`, `Do`, `q/Q`, `W n` (clipping), `gs` (ExtGState for opacity).
- Flate compression via `pako` for all streams. Object streams for the catalog to reduce size.
- Page tree, resource dictionaries with proper deduplication — the same font or image referenced 200 times must be one object.

### 3.2 Font pipeline (`@pkg/core/fonts`)

This is where most competitors fail. Get it right early.

- Parse TTF/OTF/WOFF2 (`fontkit` is acceptable; WOFF2 needs a Brotli decoder).
- **Subset** to only the glyphs actually used. Non-negotiable for file size.
- Embed as `CIDFontType2` with `Identity-H` encoding so the full Unicode range works.
- Emit a `ToUnicode` CMap so text extraction and search work in the output PDF.
- Correct `W` width arrays and `CIDToGIDMap`.
- Resolve which font file corresponds to a computed `font-family` / `weight` / `style` triple, including `@font-face` sources and system-font fallbacks.

**Positional accuracy — implement two modes:**

- *Fast path:* one positioned text run per line box, letting PDF advance widths handle intra-line spacing.
- *Precise path:* per-cluster x-positions read from `Range.getClientRects()`, emitted as a `TJ` array with explicit kerning adjustments.

The precise path is slower but guarantees the PDF matches the screen glyph-for-glyph. Default to precise; expose fast as an option.

### 3.3 Fragmentation engine (`@pkg/core/fragment`)

**The heart of the product.** Everything below must work:

- `break-before` / `break-after` / `break-inside: avoid` on any element.
- `orphans` and `widows` — never strand a single line of a paragraph across a break.
- **Repeating `<thead>` on every page a table spans**, and `<tfoot>` at the bottom of each. This is the single most requested missing feature in every competing library.
- Splitting a tall table row across pages, or moving it whole if `break-inside: avoid`.
- Never bisect an image, chart, canvas, or SVG — treat as atomic unless taller than one page.
- Nested containers with borders and backgrounds that continue correctly across the break (the box must be visually closed on page N and reopened on page N+1).
- Floats, absolutely positioned elements, and `position: sticky` degraded sensibly.
- Deterministic output: identical input must produce byte-identical PDF (given a fixed creation date), or visual regression testing is impossible.

### 3.4 Page furniture (`@pkg/core/page`)

- `@page` rules: size (A4, Letter, custom), margins, `:first`, `:left`, `:right` for duplex.
- All 16 `@page` margin boxes (`@top-left`, `@bottom-center`, …).
- `counter(page)` and `counter(pages)` — page N of M. Note that M is only known after fragmentation completes, so emit a placeholder and patch it in a second pass.
- **CSS GCPM named strings:** `string-set: chapter content()` on headings plus `content: string(chapter)` in a margin box. This is how running headers that track the current section are done, and almost nothing on the market supports it.

### 3.5 Interactivity preservation

- `<a href>` → PDF link annotations with correct rects.
- In-document anchors → `GoTo` destinations.
- Heading hierarchy → PDF outline (bookmarks) tree.

---

## 4. Free vs Pro split

Two packages. The core must be genuinely excellent — adoption is the whole funnel. The commercial *license* is the primary gate, not feature crippling.

### `@pkg/core` — dual licensed AGPL-3.0 / commercial

Full engine: measurement, fragmentation, font subsetting, page furniture, headers/footers, repeating table headers, orphans/widows, links, bookmarks, SVG vector output.

### `@pkg/pro` — commercial license only, never published under an open license

Features only companies need, each mapping to a budget line:

| Feature | Buyer |
| --- | --- |
| PDF/A-1b, 2b, 3b + XMP metadata + ICC OutputIntent | regulated industries, archival, government |
| PDF/UA tagged output (structure tree, alt text, reading order) | anyone under accessibility mandates |
| AcroForm generation and form filling | insurance, banking, HR |
| Digital signature support (PAdES; signing via a pluggable hook to an HSM or signing service) | legal, finance |
| Encryption + permissions (AES-256) | enterprise document control |
| CMYK, spot colors, bleed, crop marks, imposition | print production |
| Append/merge existing PDFs into the output | almost everyone eventually |
| Streaming writer for 1,000+ page documents | data-heavy reporting |

Validate PDF/A output against **veraPDF** in CI. If it does not pass veraPDF, the feature is not done.

---

## 5. Licensing implementation

Implement exactly this — the details matter and are easy to get subtly wrong.

**Dual licensing is the real enforcement mechanism.** Client-side JS can always be cracked; the license key is compliance hygiene, not DRM. Any company with a legal department cannot ship AGPL code inside a proprietary product, so they buy a commercial license. Do not waste effort on obfuscation or anti-tamper.

- `LICENSE` — AGPL-3.0 for core. `COMMERCIAL-LICENSE.md` — the paid terms.
- License key = an **Ed25519-signed token**. Payload: licensee name, seat count, `updatesUntil` date, edition. Verify the signature offline in-browser with WebCrypto. The public key ships in the bundle; the private key never leaves your machine.

**The perpetual-license rule — implement precisely:**

```
Validity check MUST be:   buildDate <= license.updatesUntil
Validity check MUST NOT be:  Date.now() <= license.updatesUntil
```

The customer's build keeps working forever. The key only gates whether *newer releases* accept it. This is what makes it a perpetual license rather than a subscription, and getting it backwards would break every customer's production app on renewal day.

- No phone-home. No runtime revocation. No network calls, ever. Enterprises will reject the library outright if it makes outbound requests.
- Unlicensed `@pkg/pro` usage: a `console.warn` and a small watermark. Never throw, never silently corrupt output.

---

## 6. Build milestones

Stop after each. Show verification output. Do not proceed without approval.

**M0 — Scaffolding.** pnpm workspaces monorepo. TypeScript strict mode, `noUncheckedIndexedAccess` on. Vitest for unit tests, Playwright for browser tests. Build to ESM + CJS + IIFE via tsup. Bundle-size budget enforced in CI: core ≤ 60 KB gzip excluding embedded fonts.

**M1 — PDF primitives.** Object model, xref, streams, compression. *Exit test:* emit a PDF containing one filled rectangle; `qpdf --check` reports no errors and pdf.js parses it.

**M2 — Font pipeline.** Load, subset, embed, ToUnicode. *Exit test:* a PDF containing "Hello — Ünïcödé ✓" where pdf.js text extraction returns that string exactly and the embedded font is under 20 KB.

**M3 — DOM measurement.** Hidden container, tree walk, line-box extraction, computed-style capture. *Exit test:* dump extracted geometry for a fixture page as JSON and assert stability across runs.

**M4 — Emission.** Map geometry to content-stream ops. *Exit test:* a single-page document is visually identical to the browser rendering within a 0.5% pixel diff.

**M5 — Fragmentation.** The big one. All of §3.3. *Exit test:* a 30-page report fixture with tables, headings, and images breaks correctly; repeating `<thead>` verified on every page.

**M6 — Page furniture.** `@page`, margin boxes, counters, named strings.

**M7 — Links, bookmarks, SVG vector paths.**

**M8 — License verification + `@pkg/pro` skeleton** with PDF/A-2b as the first Pro feature.

---

## 7. Testing strategy

Standard unit tests are insufficient here. Build this infrastructure during M0–M1:

- **Visual regression:** render each output PDF page to PNG via pdf.js in Playwright, compare against a committed golden image with `pixelmatch`. This is the primary safety net — fragmentation regressions are otherwise invisible.
- **Structural assertions:** text extraction round-trips; fonts are embedded and subset; link annotation rects match source `<a>` positions; no rasterized text anywhere.
- **Fixture corpus:** build these early and grow them — invoice, multi-page financial table, dashboard with charts, RTL Arabic/Hebrew text, CJK text, long-form report with running headers.
- **Compliance:** veraPDF for PDF/A, PAC or veraPDF for PDF/UA, `qpdf --check` on every generated fixture.
- **Cross-browser:** Chrome, Firefox, Safari all in CI. Safari's `getClientRects` behavior differs subtly and will bite you.

---

## 8. Standing constraints

- No runtime network requests. No telemetry. No analytics.
- No `eval`, no `new Function` — must pass strict CSP.
- Public API surface stays small: `render(element, options): Promise<Uint8Array>` plus a handful of option types. Everything else internal.
- Every fragmentation rule gets a fixture and a golden image before it is considered implemented.
- Prefer correctness over speed, but a 50-page document should render in under 5 seconds on a mid-range laptop.
