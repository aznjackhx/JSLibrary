import { describe, expect, it } from "vitest";

import { ownsLine } from "../src/emit/emit.js";
import { paginate } from "../src/emit/pages.js";

describe("paginate", () => {
  it("cuts the column into page-height bands", () => {
    expect(paginate(250, 100)).toEqual([
      { index: 0, top: 0, bottom: 100 },
      { index: 1, top: 100, bottom: 200 },
      { index: 2, top: 200, bottom: 300 },
    ]);
  });

  it("emits one page for content that fits", () => {
    expect(paginate(80, 100)).toHaveLength(1);
    expect(paginate(100, 100)).toHaveLength(1);
  });

  it("emits one page for empty content — a PDF with no pages is invalid", () => {
    expect(paginate(0, 100)).toEqual([{ index: 0, top: 0, bottom: 100 }]);
  });

  it("adds a page for the last partial band", () => {
    expect(paginate(101, 100)).toHaveLength(2);
  });

  it("leaves no gap or overlap between bands", () => {
    const slices = paginate(1000, 96);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i]?.top).toBe(slices[i - 1]?.bottom);
    }
    expect(slices[0]?.top).toBe(0);
  });

  it("covers the whole column", () => {
    const slices = paginate(250, 100);
    expect(slices[slices.length - 1]?.bottom).toBeGreaterThanOrEqual(250);
  });

  it("rejects a non-positive page height", () => {
    expect(() => paginate(100, 0)).toThrow(RangeError);
    expect(() => paginate(100, -1)).toThrow(RangeError);
  });
});

describe("ownsLine", () => {
  const band = { top: 100, bottom: 200 };

  it("claims a line whose top is inside the band", () => {
    expect(ownsLine({ rect: { y: 100 } }, band)).toBe(true);
    expect(ownsLine({ rect: { y: 199 } }, band)).toBe(true);
  });

  it("rejects lines belonging to the neighbouring pages", () => {
    expect(ownsLine({ rect: { y: 99 } }, band)).toBe(false);
    expect(ownsLine({ rect: { y: 200 } }, band)).toBe(false);
  });

  it("assigns a line to exactly one band", () => {
    // The boundary case that decides whether text is dropped or duplicated.
    const bands = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ];
    for (const y of [0, 50, 99, 100, 150, 199]) {
      const owners = bands.filter((candidate) => ownsLine({ rect: { y } }, candidate));
      expect(owners, `line at y=${y}`).toHaveLength(1);
    }
  });
});
