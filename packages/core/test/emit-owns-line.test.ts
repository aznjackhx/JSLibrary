import { describe, expect, it } from "vitest";

import { ownsLine } from "../src/emit/emit.js";

const line = (y: number): { rect: { y: number } } => ({ rect: { y } });

/** Pages tile the document: each band's bottom is the next band's top. */
const FIRST = { top: 0, bottom: 700 };
const SECOND = { top: 700, bottom: 1400 };

describe("ownsLine", () => {
  it("gives the first page a line that measures a hair above its top", () => {
    // The bug this exists for: sub-pixel layout puts a line flush with the top
    // of the content box a fraction either side of zero, and engines disagree
    // about which. A strict `y >= top` drops it from every page, so text the
    // browser painted is simply absent from the PDF — which is what happened
    // to the corpus invoice's heading on WebKit, and only on WebKit.
    expect(ownsLine(line(-0.02), FIRST)).toBe(true);
    expect(ownsLine(line(-0.4), FIRST)).toBe(true);
  });

  it("gives every line exactly one owner across a boundary", () => {
    for (const y of [-0.4, 0, 1, 699.4, 699.6, 700, 700.4, 1399]) {
      const owners = [FIRST, SECOND].filter((band) => ownsLine(line(y), band));
      expect(owners, `y=${y}`).toHaveLength(1);
    }
  });

  it("does not pull a line from the next page onto this one", () => {
    // The tolerance shifts both edges together, so it must not widen the band:
    // a line clearly belonging to page two stays on page two.
    expect(ownsLine(line(700), FIRST)).toBe(false);
    expect(ownsLine(line(699.6), FIRST)).toBe(false);
    expect(ownsLine(line(699.6), SECOND)).toBe(true);
  });
});
