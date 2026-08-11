# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org/).

Nothing is released yet: the package names are placeholders and no version has
been published, so everything below sits under **Unreleased**. Entries are
written for someone deciding whether to upgrade, which means a fix says what
was wrong rather than what was touched.

## Unreleased

### Added

- **Text inside SVG.** `<text>` and `<tspan>` render as real, selectable,
  searchable PDF text with embedded fonts — not outlines and not pixels.
  Positions come from the browser, so `text-anchor`, `dx`/`dy`,
  `letter-spacing` and `textLength` are honoured. Chart axis labels previously
  drew nothing at all.
- **SVG gradients.** Linear and radial gradients paint as PDF shadings, in both
  `objectBoundingBox` and `userSpaceOnUse` units, with `gradientTransform`,
  percentage coordinates, an off-centre radial focus, and `href` inheritance
  between gradients. One shading is embedded per distinct gradient rather than
  per filled shape.
- **SVG `use`.** Resolves and instances its referent, including a `symbol` or
  `g` inside `defs`, with cycle protection. Icon sprites previously drew
  nothing.
- **`FontError`.** A font that cannot be used now names the face — the family
  and weight as the caller declared them — keeps the underlying reason as its
  message and `cause`, and says what to check.
- **A fixture corpus of eight documents** held to shared invariants, covering a
  framework-shaped invoice, nested tables with spans, Hebrew, Arabic, Japanese,
  a thirty-page report with running headers, raster images at three densities
  with transparency, and a dashboard of charts.
- **`scripts/benchmark.mjs`** for timings and peak heap, and
  **`scripts/inspect-gsub.mjs`** for what a font's `GSUB` table actually
  contains.

### Fixed

- **Text flush with the top of the page was never painted.** Content measuring
  above the first page's content box — a heading whose font is taller than its
  line box does this routinely — belonged to no page at all and was silently
  dropped. Two corpus documents lost their heading, one of them on WebKit only.
- **A box taller than the page lost everything past the first page edge.** The
  page ended below the oversized box, so the remainder was written into the
  content stream and then hidden by the page clip, with nothing to indicate
  content was missing. Such a box is now divided and continues overleaf.
- **An explicit `pageSize` was silently rotated to portrait.** A caller asking
  for a 400×320 page received 320×400, and anything near the right edge fell
  off it. Orientation now applies to named sheet sizes only; explicit
  dimensions are taken as given. Pass `orientation` to rotate one deliberately.
- **Paragraphs wrapped across source lines printed a `.notdef` box at each
  wrap.** The newline was recorded as a character to render, and no font has a
  glyph for it.

### Known gaps

Named here rather than discovered later:

- **No text shaping.** Arabic, Persian, Urdu and Indic scripts render with
  isolated letter forms — wrong, not merely degraded. Scoped in `ROADMAP.md`.
- **WOFF2 fonts are rejected**; decompressed TrueType or OpenType bytes are
  required.
- **CFF outlines cannot be subset**, so a font with PostScript outlines fails.
- **SVG:** `spreadMethod` other than `pad` degrades to `pad`, gradient stop
  opacity paints at full strength, and `pattern` fills paint nothing. `textPath`
  and per-character `rotate` are unsupported.
- **Memory** is roughly 0.7–1 MB per output page with everything held at once,
  which puts the practical ceiling near a thousand pages.
