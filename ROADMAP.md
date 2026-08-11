# Road to a sellable product

Where this stands, and what stands between it and money changing hands.

Milestones M0–M8 of `CLAUDE.md` are complete: the engine renders, fragments,
embeds fonts, draws vector SVG, and produces PDF/A-2b that veraPDF accepts.
That is an engine. It is not yet a product.

## The honest starting point

After eight milestones and 156 passing browser tests, the first realistic
document the renderer met printed a `.notdef` box in every paragraph, because
ordinary HTML wraps paragraphs across source lines. The bug was trivial. What
it revealed is not: every fixture in the suite was written by the same person
who wrote the engine, and they all happened to avoid the case.

So the sequencing below is deliberate. **Reality first, features second.** The
fastest way to find out what is actually broken is to render documents nobody
here designed, and the answer to "what else is wrong" changes everything after
it.

Sizes are rough: **S** ≈ a day, **M** ≈ a few days, **L** ≈ a week or more,
**XL** ≈ multiple weeks and a real design decision.

---

## What the corpus found on its first run

Item 1 is now partly done — five documents, held to shared invariants — and it
paid for itself immediately.

- **Arabic renders as disconnected letters.** There is no text shaping: glyphs
  are looked up through the font's `cmap` alone, so every letter gets its
  isolated form and the words come out unjoined and badly positioned. This is
  new item **0** below, and it is larger than anything else on this list.
- **Hebrew renders correctly.** Right-to-left flow, spacing and an embedded
  Latin number all check out by eye against the browser. Its text round-trip
  needed the unordered comparison, because pdf.js reports right-to-left runs
  in a different order from `innerText` — an extractor difference, not a
  renderer one.
- **Japanese renders correctly**, including line breaking between characters
  and inside table cells.
- **A framework-shaped invoice and nested tables with `colspan`/`rowspan`
  render correctly.** Flexbox, grid, badges and per-side borders all held.
- **Two documents silently lost their heading.** Content sitting above the top
  of the first page belonged to no page at all and was never painted — the
  invoice's heading on WebKit alone, a fraction below zero where the other two
  engines said exactly zero, and then the long report's title on every engine,
  five pixels up, because a heading whose font is taller than its line box
  overflows above it. Both are fixed: the first page now owns everything above
  it and the last everything below, since there is no page beyond them for that
  text to belong to. Neither was visible to any test that only compared the
  emitter against itself.

The Arabic document is committed with its gap asserted as an *expected
failure*, so the day shaping lands, CI turns red and the annotation has to go.

## P0 — cannot sell without these

### 0. Text shaping — L, and now scoped

Found by the corpus. Characters are mapped to glyphs through `cmap`, which is
correct only where one character is one glyph in one form. Arabic needs
contextual forms and ligatures; Indic scripts need reordering and conjuncts.
Both come from the font's `GSUB` table, which nothing here reads.

**Why it blocks a sale:** any customer with Arabic, Persian, Urdu, Hindi,
Bengali or Thai content gets unreadable output. Not degraded — wrong.

**Investigated, and the answer changed the plan.** Two findings, both from
evidence rather than argument. `scripts/inspect-gsub.mjs` reproduces the
second against any font.

*The escape hatch does not exist.* "Read the shaped result back out of the
browser" was the preferred option because the browser has already done the
work. It cannot be done: no web API exposes glyph identity. `Range` rects give
positions, `measureText` gives advances, `document.fonts` gives no glyph
access at all. Nothing returns which glyph a character became.

*But only half the problem needs solving.* Shaping is `GSUB` (which glyph) plus
`GPOS` (where it goes). Positions here already come from the browser, measured
per cluster and pinned in the output — so `GPOS` is not needed at all. That is
the expensive half, and it is already handled.

**What `GSUB` actually demands**, from Noto Sans Arabic:

- `init`, `medi` and `fina` are present — the joining forms — using single and
  multiple substitution, lookup types 1 and 2. There is no `isol` feature: the
  isolated form is what `cmap` already returns, which is exactly what the
  corpus document renders today.
- `rlig` carries 23 lookups and includes chained-context substitution, lookup
  type 6. This is the hard part, and it cannot be skipped: lam-alef is a
  required ligature and appears in ordinary words.

So a shaper for Arabic needs Unicode joining classes plus `GSUB` lookup types
1, 2, 4 and 6 — bounded, unlike a general HarfBuzz port, and with no
positioning work. **L, not XL.** Indic reordering is a separate and larger
problem, and should be quoted separately rather than folded into this.

**Interim, and worth doing regardless:** detect scripts that need shaping and
say so, rather than silently emitting nonsense. This is a product decision —
refusing outright versus rendering wrongly with a warning — so it is not made
here.

**Done when:** the Arabic corpus document renders as joined words and its
expected-failure annotation is removed.

### 1. Fixture corpus — done

Eight documents, all in CI, all held to the same invariants: a framework-shaped
invoice, nested tables with spans, Hebrew, Arabic, Japanese, a thirty-page
report in proportional type with running headers and page counters, raster
images at three densities with an alpha channel, and a dashboard of charts with
legends and axis labels.

Between them they found the missing-heading bug, the silent page rotation, and
the absence of text shaping. The images document found nothing — source pixels
and soft masks both survive — which is worth as much as the others: it was
checked against the browser by eye before its assertions were written.

Each new bug has a regression test that fails without its fix, and each
document's own weak spot is named where the invariants cannot reach it — SVG
labels are asserted directly, because `innerText` cannot see inside an `<svg>`
and the round-trip comparison would pass with every axis label gone.

### 2. WOFF2 support — L

Rejected outright today (`sfnt.ts`): decoding needs a Brotli decompressor,
which does not fit the 60 KB budget. WOFF2 is the dominant web font format, so
a customer's brand font is more likely WOFF2 than anything else.

**The decision this forces:** either ship Brotli in a lazily-loaded chunk
outside the core budget, or require callers to hand over decompressed bytes and
document it loudly. Both are defensible; the current behaviour — a hard error —
is not, for a paid product.

**Done when:** a WOFF2 brand font renders, and the size budget still holds for
callers who do not use one.

### 3. CFF / OpenType outline support — XL

`subset.ts` rejects CFF outlines: only TrueType `glyf` can be subset. A large
share of commercial and foundry typefaces are CFF. This is a genuine chunk of
work — a CFF parser and subsetter — and it is the single biggest engineering
item on this list.

**Interim option worth considering:** embed CFF fonts unsubset rather than
failing. Bigger files, but a rendered document beats an exception.

**Done when:** a CFF font renders with correct metrics and extractable text.

### 4. Text inside SVG — done

`<text>` and `<tspan>` render as real PDF text with embedded fonts, and the
labels extract. Positions come from the browser via `getStartPositionOfChar`,
so `text-anchor`, `dx`/`dy`, `letter-spacing` and `textLength` are honoured
without any of SVG text layout being reimplemented.

It found a bug of its own, in page geometry rather than SVG: an explicit
`pageSize` was silently rotated to portrait, so a 400x320 page came out
320x400 and anything near the right edge fell off it. The M7 comparison test
had been comparing a portrait PDF against a landscape screenshot since it was
written, and passing, because the shapes it checks sit well inside both.

Still missing inside `<text>`: `textPath`, and per-character `rotate`.

### 5. Gradients and `use` in SVG — done

Linear and radial gradients paint as PDF shadings — vector, not rasterised —
in both `objectBoundingBox` and `userSpaceOnUse` units, with
`gradientTransform`, percentage coordinates, an off-centre radial focus, and
`href` inheritance from another gradient. One shading is embedded per distinct
gradient rather than per filled shape. `use` resolves and instances its
referent, including a `symbol` or `g` in `defs`, with cycle protection.

Two gaps left deliberately, both documented where they live: `spreadMethod`
values other than `pad` degrade to `pad`, and stop opacity paints at full
strength because honouring it needs a luminosity soft mask. A paint server
that is not a gradient — a `pattern` — still paints nothing rather than a
wrong flat colour.

### 6. Split a box taller than a page — done

Carried since M5, and broader than tables: *any* atom taller than the page had
its tail clipped away — a row marked `break-inside: avoid`, a tall figure, an
unbreakable block. The page ended below the atom, so everything past the page
edge was written into the content stream and then hidden by the page clip,
with nothing to indicate content was missing.

Such an atom is now divided at the page edge and continues overleaf, which is
what a browser does. The `overflowed` flag still reports it, because a box that
asked not to be broken was broken anyway.

Worth recording how nearly this shipped untested. The first regression test
passed with the fix reverted, twice over: text extraction finds glyphs that are
painted off the visible page, and a plain `<tr>` is not an atom at all, so its
lines were already breaking normally and the oversized path never ran. The test
now marks the rows `break-inside: avoid` — the authored intent that creates the
problem — and is confirmed to fail without the fix.

### 7. Ship the commerce, not just the code — M

None of this exists yet:

- Real package names (`@pkg/*` are placeholders) and a published npm package
- A generated signing keypair, with the public half committed and the private
  half stored somewhere durable and secret
- A purchase → key delivery path, however manual at first
- Semantic versioning and a tagged release. `CHANGELOG.md` now exists, with
  everything so far under **Unreleased** and the known gaps named in it
- A documentation site, or at minimum a README that stands on its own
- A stated support policy and a security contact

**Why it blocks a sale:** literally nobody can buy or install it today.

---

## P1 — needed for a credible 1.0

### 8. Cross-browser evidence beyond the test suite — M

CI runs Chromium, Firefox and WebKit, which is good. But three separate times
a test failed on an engine for reasons that were about the test, not the
library. Real documents on real browsers, compared by eye, are still missing.

### 9. Performance on documents people actually have — measured

`scripts/benchmark.mjs` renders the three documents this asked for and reports
the median of five runs. On a CI-class container, not a laptop:

| Document | Pages | Median | Per page | Output | Peak heap |
| --- | --- | --- | --- | --- | --- |
| Long report, 1,200 justified paragraphs | 88 | 2.3 s | 26 ms | 132 KB | 65 MB |
| 5,000-row table with a repeating header | 105 | 2.6 s | 25 ms | 298 KB | 103 MB |
| Fifty SVG charts with labels | 2 | 47 ms | 23 ms | 7 KB | 8 MB |

The brief's budget is fifty pages in under five seconds. Both long documents
clear it with room to spare — roughly 30 ms a page against a 100 ms budget —
and this hardware is slower than the mid-range laptop the budget names, so a
real machine has more headroom still.

Two things the numbers say beyond the pass. Cost is close to linear in pages
rather than in content: the 5,000-row table is *cheaper* per page than justified
prose, so fragmentation is not the bottleneck. And vector output stays small —
a hundred pages of table is under 300 KB, against the tens of megabytes a
rasterising library produces.

It is a script and not a test, deliberately. A timing threshold asserted in CI
fails on a noisy runner for reasons that have nothing to do with the change
under review, and a suite that cries wolf gets ignored.

Still unmeasured: a document mixing all three at once.

### 10. Error handling and diagnostics — partly done

Audited every `throw` in the core. Most already named their input — page sizes,
margins, lengths, PDF object errors all quote the offending value. The gap was
the one that matters commercially: a font the caller supplied failed with a
message about bytes and no indication of *which* font, in a document that may
pass a dozen faces.

Font failures now carry the face. `FontError` names the family and weight the
caller declared, keeps the original reason as its message and its `cause`, and
says what to check — the common real cause being a WOFF2 file, a truncated
response, or an error page fetched instead of the font. Subsetting failures,
which happen at the end of the render far from the call that supplied the font,
carry the name from inside the file, since the declared family is not carried
that far and inventing one would send the reader to the wrong file.

Still to do: name the *element* as well as the input, which needs the measured
tree to carry a source reference; and audit the `@pkg/pro` throws, which this
pass did not cover.

### 11. A second Pro feature — L

`PRO_FEATURES` declares eight; one exists. PDF/A-2b alone is a thin paid tier.
The two with the clearest demand are **PDF/UA tagged output** (anyone under an
accessibility mandate, and it has a real deadline-driven buyer) and
**AcroForm generation** (insurance, banking, HR).

### 12. Memory behaviour on large documents — ceiling documented

Measured alongside the timings, in the same script. Everything is held at once
— the measured tree, every image, the whole byte buffer — and the cost is
roughly **0.7 to 1 MB of heap per output page**, dominated by the measured
tree rather than by the PDF being built: the 5,000-row table costs more per
page than justified prose because it carries far more boxes.

So the working ceiling is about **1,000 pages before a browser tab is in
trouble**, and a tab that dies takes the render with it. That is the number to
quote to anyone asking, and it is what makes the streaming writer a real Pro
feature rather than a nice-to-have.

The measurement needed `--enable-precise-memory-info`. Without it Chromium
buckets `usedJSHeapSize` and reports the same 13 MB for a two-page document
and a hundred-page one — a number that looks like an answer and is only the
baseline heap. Worth knowing before anyone quotes a memory figure from a
casual measurement.

Not fixed, deliberately: fixing it means streaming, which is an architectural
change and already scoped as a Pro feature.

---

## P2 — after the first customers

13. The remaining Pro features: digital signatures (PAdES), AES-256
    encryption, CMYK and print production, merging existing PDFs, and the
    streaming writer for 1,000+ page documents. **L–XL each.**
14. Named pages (`@page cover` with `page: cover`), content-based margin-box
    sizing, and counters beyond `page`/`pages`. **M**
15. SVG `clipPath`, `mask` and filters. **L**
16. `position: sticky` and float handling beyond the current degradation. **M**
17. A hosted playground, so an evaluator can try it without installing
    anything. **M**

---

## Suggested order

1. **Fixture corpus (#1)** — everything else is guesswork until this is done.
2. **Fix what it finds** — unknown size, and that is the point of doing it first.
3. **WOFF2 (#2), SVG text (#4), gradients and `use` (#5)** — these block whole
   customers rather than degrading output.
4. **Commerce (#7)** in parallel; it is not engineering-blocked.
5. **Tall row (#6), diagnostics (#10), performance (#9)**.
6. **CFF (#3)** — the largest item; start it once the cheaper blockers are gone,
   unless a specific customer's font forces it sooner.
7. **PDF/UA or AcroForm (#11)** to make the paid tier worth buying.

## What is already strong

Worth protecting while the above happens: fragmentation quality genuinely beats
the alternatives on the thing people complain about — repeating `thead` and
`tfoot`, orphans and widows, atomic figures. Output is deterministic, text is
real and searchable, SVG is vector, files are small, PDF/A-2b passes an
independent validator, and CI checks that non-conformant output is rejected
too. The architecture holds; none of the work above requires unpicking it.
