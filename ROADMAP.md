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

### 0. Text shaping — XL

Found by the corpus, and not previously on this list. Characters are mapped to
glyphs through `cmap`, which is correct only for scripts where one character is
one glyph in one form. Arabic needs contextual forms and ligatures; Indic
scripts need reordering and conjuncts. Both come from the font's `GSUB`/`GPOS`
tables, which nothing here reads.

**Why it blocks a sale:** any customer with Arabic, Persian, Urdu, Hindi,
Bengali or Thai content gets unreadable output. Not degraded — wrong.

**The decision this forces:** implement shaping (a HarfBuzz-class problem, and
a WASM build of HarfBuzz is far outside the 60 KB budget), or read the shaped
result back out of the browser, which already did the work. The second is much
more in keeping with the architecture — the browser is the layout engine —
but needs a way to recover glyph ids and positions from a laid-out run, which
the DOM does not expose directly. Investigate that first; it may be cheap or
it may be impossible.

**Interim, and worth doing regardless:** detect scripts that need shaping and
refuse with a clear error, rather than silently emitting nonsense.

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

### 6. Split a table row taller than a page — M

Carried since M5. Such a row currently overflows the page. A financial table
with a long note in a cell hits this immediately.

**Done when:** a too-tall row divides across pages with its borders closed and
reopened correctly, with a golden image.

### 7. Ship the commerce, not just the code — M

None of this exists yet:

- Real package names (`@pkg/*` are placeholders) and a published npm package
- A generated signing keypair, with the public half committed and the private
  half stored somewhere durable and secret
- A purchase → key delivery path, however manual at first
- `CHANGELOG.md`, semantic versioning, and a tagged release
- A documentation site, or at minimum a README that stands on its own
- A stated support policy and a security contact

**Why it blocks a sale:** literally nobody can buy or install it today.

---

## P1 — needed for a credible 1.0

### 8. Cross-browser evidence beyond the test suite — M

CI runs Chromium, Firefox and WebKit, which is good. But three separate times
a test failed on an engine for reasons that were about the test, not the
library. Real documents on real browsers, compared by eye, are still missing.

### 9. Performance on documents people actually have — M

The 50-page budget was measured on a synthetic fixture of repeated paragraphs.
Measure a 200-page report, a 5,000-row table, and a page with fifty SVG charts.
Publish the numbers.

### 10. Error handling and diagnostics — M

Today a malformed font throws a bare `Error`. A paying customer needs to know
which font, which element, and what to do about it. Audit every throw for a
message that names the input and the fix.

### 11. A second Pro feature — L

`PRO_FEATURES` declares eight; one exists. PDF/A-2b alone is a thin paid tier.
The two with the clearest demand are **PDF/UA tagged output** (anyone under an
accessibility mandate, and it has a real deadline-driven buyer) and
**AcroForm generation** (insurance, banking, HR).

### 12. Memory behaviour on large documents — M

Everything is held in memory: the measured tree, every image, the whole byte
buffer. Find where that falls over and either fix it or document the ceiling.

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
