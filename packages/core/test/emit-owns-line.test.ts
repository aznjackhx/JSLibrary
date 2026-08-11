import { describe, expect, it } from "vitest";

import { ownsLine } from "../src/emit/emit.js";

const line = (y: number): { rect: { y: number } } => ({ rect: { y } });

/** Pages tile the document: each band's bottom is the next band's top. */
const FIRST = { top: 0, bottom: 700, first: true };
const MIDDLE = { top: 700, bottom: 1400 };
const LAST = { top: 1400, bottom: 2100, last: true };

describe("ownsLine", () => {
  it("gives the first page a line measuring above the top of the document", () => {
    // A heading whose font is taller than its line box sits above the content
    // box, and the browser paints it there. There is no page before the first
    // one, so a strict `y >= top` assigns it to no page at all and it is
    // simply absent from the PDF. Two corpus documents lost their heading
    // this way: the invoice on WebKit at a fraction below zero, the long
    // report on every engine at a full five pixels above it.
    expect(ownsLine(line(-0.02), FIRST)).toBe(true);
    expect(ownsLine(line(-5), FIRST)).toBe(true);
    expect(ownsLine(line(-400), FIRST)).toBe(true);
  });

  it("gives the last page a line measuring past the end of the document", () => {
    expect(ownsLine(line(2100), LAST)).toBe(true);
    expect(ownsLine(line(2600), LAST)).toBe(true);
  });

  it("gives every line exactly one owner", () => {
    for (const y of [-400, -0.4, 0, 1, 699.4, 699.6, 700, 1399, 1400, 2099, 2100, 2600]) {
      const owners = [FIRST, MIDDLE, LAST].filter((band) => ownsLine(line(y), band));
      expect(owners, `y=${y}`).toHaveLength(1);
    }
  });

  it("does not let a page reach into its neighbour", () => {
    // The interior tolerance shifts both edges together, so it absorbs
    // sub-pixel disagreement without widening the band.
    expect(ownsLine(line(700), FIRST)).toBe(false);
    expect(ownsLine(line(699.6), FIRST)).toBe(false);
    expect(ownsLine(line(699.6), MIDDLE)).toBe(true);
    expect(ownsLine(line(-5), MIDDLE)).toBe(false);
    expect(ownsLine(line(2600), MIDDLE)).toBe(false);
  });

  it("keeps a band that is not a whole page to its own span", () => {
    // Repeated table headers paint against the span they occupy in the
    // measured column. Letting one absorb everything above or below it would
    // repeat the whole document under every table header.
    const section = { top: 300, bottom: 340 };
    expect(ownsLine(line(-5), section)).toBe(false);
    expect(ownsLine(line(310), section)).toBe(true);
    expect(ownsLine(line(900), section)).toBe(false);
  });
});
