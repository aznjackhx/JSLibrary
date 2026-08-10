import { describe, expect, it } from "vitest";

import type { BreakAtom, FragmentModel } from "../src/fragment/atoms.js";
import { paginate } from "../src/fragment/paginate.js";

/** Evenly spaced lines, the shape most documents reduce to. */
function lines(count: number, height: number, gap = 0, from = 0): BreakAtom[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "line" as const,
    top: from + index * (height + gap),
    bottom: from + index * (height + gap) + height,
  }));
}

const model = (atoms: BreakAtom[], forced: number[] = []): FragmentModel => ({
  atoms,
  forced: forced.map((y) => ({ y })),
});

describe("paginate", () => {
  it("emits one page when everything fits", () => {
    const slices = paginate(model(lines(4, 20)), { pageHeight: 100, contentHeight: 80 });
    expect(slices).toHaveLength(1);
    expect(slices[0]?.top).toBe(0);
  });

  it("emits one page for empty content", () => {
    const slices = paginate(model([]), { pageHeight: 100, contentHeight: 0 });
    expect(slices).toHaveLength(1);
  });

  it("never divides an atom", () => {
    // Ten 20px lines in a 90px page: four fit, the fifth would straddle.
    const atoms = lines(10, 20);
    const slices = paginate(model(atoms), { pageHeight: 90, contentHeight: 200 });

    for (const atom of atoms) {
      const straddled = slices.filter(
        (slice) => atom.top < slice.bottom && atom.bottom > slice.bottom,
      );
      expect(straddled, `atom ${atom.top}-${atom.bottom} straddles a break`).toEqual([]);
    }
  });

  it("breaks above the first atom that does not fit", () => {
    const slices = paginate(model(lines(10, 20)), { pageHeight: 90, contentHeight: 200 });
    // Lines at 0,20,40,60 fit in 90; the line at 80 would end at 100.
    expect(slices[0]?.bottom).toBe(80);
  });

  it("covers the column with no gap or overlap", () => {
    const slices = paginate(model(lines(20, 20)), { pageHeight: 90, contentHeight: 400 });

    expect(slices[0]?.top).toBe(0);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]?.top).toBe(slices[i - 1]?.bottom);
    }
    expect(slices[slices.length - 1]?.bottom).toBeGreaterThanOrEqual(400);
  });

  it("keeps every page within the page height", () => {
    const slices = paginate(model(lines(20, 20)), { pageHeight: 90, contentHeight: 400 });
    for (const slice of slices.slice(0, -1)) {
      expect(slice.bottom - slice.top).toBeLessThanOrEqual(90);
    }
  });

  it("honours a forced break", () => {
    const slices = paginate(model(lines(20, 20), [55]), {
      pageHeight: 200,
      contentHeight: 400,
    });
    expect(slices[0]?.bottom).toBe(55);
  });

  it("ignores a forced break beyond the page it would land on", () => {
    // A forced break below the limit cannot pull content onto this page.
    const slices = paginate(model(lines(20, 20), [500]), {
      pageHeight: 90,
      contentHeight: 400,
    });
    expect(slices[0]?.bottom).toBeLessThanOrEqual(90);
  });

  it("places an atom taller than the page and flags the overflow", () => {
    const tall: BreakAtom[] = [{ kind: "replaced", top: 0, bottom: 250 }];
    const slices = paginate(model(tall), { pageHeight: 100, contentHeight: 250 });

    expect(slices[0]?.overflowed).toBe(true);
    // And it terminates rather than looping for a break that cannot exist.
    expect(slices.length).toBeGreaterThanOrEqual(1);
  });

  it("resumes normally after an oversized atom", () => {
    const atoms: BreakAtom[] = [
      { kind: "replaced", top: 0, bottom: 250 },
      ...lines(4, 20, 0, 250),
    ];
    const slices = paginate(model(atoms), { pageHeight: 100, contentHeight: 330 });

    expect(slices[0]?.overflowed).toBe(true);
    expect(slices.length).toBeGreaterThan(1);
    expect(slices[1]?.top).toBe(250);
    expect(slices[1]?.overflowed).toBe(false);
  });

  it("terminates on pathological input", () => {
    // Many atoms all taller than the page, back to back.
    const atoms: BreakAtom[] = Array.from({ length: 20 }, (_, index) => ({
      kind: "avoid" as const,
      top: index * 200,
      bottom: index * 200 + 200,
    }));
    const slices = paginate(model(atoms), { pageHeight: 50, contentHeight: 4000 });
    expect(slices.length).toBeLessThanOrEqual(40);
  });

  it("rejects a non-positive page height", () => {
    expect(() => paginate(model([]), { pageHeight: 0, contentHeight: 10 })).toThrow(RangeError);
  });
});
