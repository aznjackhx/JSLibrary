import { describe, expect, it } from "vitest";

import type { BreakAtom, ForcedBreak, FragmentModel } from "../src/fragment/atoms.js";
import { paginate } from "../src/fragment/paginate.js";

/** Evenly spaced lines, the shape most documents reduce to. */
function lines(count: number, height: number, gap = 0, from = 0): BreakAtom[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "line" as const,
    top: from + index * (height + gap),
    bottom: from + index * (height + gap) + height,
  }));
}

const model = (
  atoms: BreakAtom[],
  forced: Array<number | ForcedBreak> = [],
): FragmentModel => ({
  atoms,
  forced: forced.map((entry) =>
    typeof entry === "number" ? { y: entry, parity: "any" as const } : entry,
  ),
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

  it("divides an atom taller than the page instead of losing its tail", () => {
    // 250 of content into 100-high pages. Ending the page below the atom would
    // put 150 of it past the bottom of a page, where it is clipped away: a
    // table row with a long note in a cell printed its first page and nothing
    // after it.
    const tall: BreakAtom[] = [{ kind: "avoid", top: 0, bottom: 250 }];
    const slices = paginate(model(tall), { pageHeight: 100, contentHeight: 250 });

    expect(slices[0]?.overflowed).toBe(true);
    expect(slices[0]?.bottom).toBe(100);

    // Every part of the atom is on some page, and the pages tile it.
    expect(slices.length).toBeGreaterThan(1);
    expect(slices[slices.length - 1]?.bottom).toBeGreaterThanOrEqual(250);
    for (let index = 1; index < slices.length; index += 1) {
      expect(slices[index]?.top).toBe(slices[index - 1]?.bottom);
    }
  });

  it("resumes normally after an oversized atom", () => {
    const atoms: BreakAtom[] = [
      { kind: "avoid", top: 0, bottom: 250 },
      ...lines(4, 20, 0, 250),
    ];
    const slices = paginate(model(atoms), { pageHeight: 100, contentHeight: 330 });

    expect(slices[0]?.overflowed).toBe(true);
    expect(slices.length).toBeGreaterThan(2);

    // The page that starts after the tall atom ends is an ordinary page again.
    const after = slices.find((slice) => slice.top >= 250);
    expect(after?.overflowed).toBe(false);
  });

  it("terminates on pathological input", () => {
    // Many atoms all taller than the page, back to back.
    const atoms: BreakAtom[] = Array.from({ length: 20 }, (_, index) => ({
      kind: "avoid" as const,
      top: index * 200,
      bottom: index * 200 + 200,
    }));
    const slices = paginate(model(atoms), { pageHeight: 50, contentHeight: 4000 });

    // 4000 of content into pages of 50 is 80 pages, and every one of them
    // carries content. The bound that matters is that pagination is
    // proportional to the document and always advances — not that it is short.
    // A tighter bound would only be satisfiable by throwing content away,
    // which is what ending each page below an oversized atom used to do.
    expect(slices.length).toBe(80);
    for (let index = 1; index < slices.length; index += 1) {
      expect(slices[index]?.top).toBeGreaterThan(slices[index - 1]?.top as number);
    }
  });

  it("rejects a non-positive page height", () => {
    expect(() => paginate(model([]), { pageHeight: 0, contentHeight: 10 })).toThrow(RangeError);
  });
});

describe("side-specific breaks", () => {
  it("leaves a blank page when the demanded side is the wrong one", () => {
    // The break falls at 100, which would put the content on page index 1 —
    // a left-hand page. `right` demands index 2, so index 1 is left blank.
    const slices = paginate(model(lines(10, 20), [{ y: 100, parity: "right" }]), {
      pageHeight: 100,
      contentHeight: 200,
    });

    expect(slices.map((slice) => slice.blank)).toEqual([false, true, false]);
    expect(slices[1]?.top).toBe(slices[1]?.bottom);
    // The blank page holds nothing, so the content it displaced starts the
    // page after it rather than being skipped.
    expect(slices[2]?.top).toBe(100);
  });

  it("inserts nothing when the demanded side is already correct", () => {
    const slices = paginate(model(lines(10, 20), [{ y: 100, parity: "left" }]), {
      pageHeight: 100,
      contentHeight: 200,
    });

    expect(slices.map((slice) => slice.blank)).toEqual([false, false]);
  });

  it("never inserts more than one blank page for a break", () => {
    // Parity alternates, so one blank always resolves the demand; a second
    // would mean the loop was not converging.
    const slices = paginate(model(lines(30, 20), [{ y: 100, parity: "right" }]), {
      pageHeight: 100,
      contentHeight: 600,
    });

    expect(slices.filter((slice) => slice.blank)).toHaveLength(1);
  });

  it("treats a plain page break as satisfied by either side", () => {
    const slices = paginate(model(lines(10, 20), [{ y: 100, parity: "any" }]), {
      pageHeight: 100,
      contentHeight: 200,
    });

    expect(slices.some((slice) => slice.blank)).toBe(false);
  });
});
