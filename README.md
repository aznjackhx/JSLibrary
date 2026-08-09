# JSLibrary

Client-side HTML → PDF with print fidelity. Converts live DOM content into a
**real vector PDF** in the browser — no server, no headless Chrome, no
rasterization.

Text stays selectable and searchable, fonts are embedded and subset, inline SVG
becomes vector paths, and files stay small. Nothing is fetched at runtime.

> **Status: Milestone 0 — scaffolding.** `render()` throws `NotImplementedError`
> until emission lands in M4. See [`CLAUDE.md`](./CLAUDE.md) for the full brief
> and milestone plan.

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

Visual regression goldens live in `tests/browser/goldens`, one set per browser.
Refresh with `UPDATE_GOLDENS=1 pnpm test:browser` and review the diff before
committing — an updated golden asserts the new rendering is correct.

## License

Dual licensed: [AGPL-3.0](./LICENSE) or a
[commercial license](./COMMERCIAL-LICENSE.md). `@pkg/pro` is commercial only.
