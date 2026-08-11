import { describe, expect, it } from "vitest";

import {
  isNamedPageSize,
  pageGeometry,
  resolveMargins,
  resolvePageSize,
} from "../src/page/geometry.js";
import { toPt } from "../src/units.js";

describe("resolvePageSize", () => {
  it("resolves named sizes case-insensitively", () => {
    expect(resolvePageSize("Letter")).toEqual({ width: 612, height: 792 });
    expect(resolvePageSize("letter")).toEqual({ width: 612, height: 792 });
    expect(resolvePageSize("Legal")).toEqual({ width: 612, height: 1008 });
    expect(resolvePageSize("Tabloid")).toEqual({ width: 792, height: 1224 });
  });

  it("resolves A4 to 210x297mm in points", () => {
    const a4 = resolvePageSize("A4");
    expect(a4.width).toBeCloseTo(toPt("210mm"), 10);
    expect(a4.height).toBeCloseTo(toPt("297mm"), 10);
  });

  it("defaults to A4 portrait", () => {
    expect(resolvePageSize()).toEqual(resolvePageSize("A4", "portrait"));
  });

  it("swaps axes for landscape, and only when needed", () => {
    const portrait = resolvePageSize("Letter", "portrait");
    const landscape = resolvePageSize("Letter", "landscape");
    expect(landscape).toEqual({ width: portrait.height, height: portrait.width });
    // Already landscape: orientation must not flip it back.
    expect(resolvePageSize({ width: "10in", height: "5in" }, "landscape")).toEqual({
      width: 720,
      height: 360,
    });
  });

  it("takes an explicit size exactly as given", () => {
    // A caller who writes the width and height has already said which way
    // round the page is. Normalising to portrait regardless turned a request
    // for a 400x320 page into a 320x400 one, and nothing said so.
    expect(resolvePageSize({ width: "400px", height: "320px" })).toEqual({
      width: 300,
      height: 240,
    });
  });

  it("applies orientation to custom sizes too", () => {
    expect(resolvePageSize({ width: "5in", height: "10in" }, "landscape")).toEqual({
      width: 720,
      height: 360,
    });
  });

  it("rejects unknown names and non-positive sizes", () => {
    expect(() => resolvePageSize("A11")).toThrow(RangeError);
    expect(() => resolvePageSize({ width: 0, height: "10in" })).toThrow(RangeError);
    expect(() => resolvePageSize({ width: "-1in", height: "10in" })).toThrow(RangeError);
  });

  it("reports which names are known", () => {
    expect(isNamedPageSize("a4")).toBe(true);
    expect(isNamedPageSize("A4")).toBe(true);
    expect(isNamedPageSize("foolscap")).toBe(false);
  });
});

describe("resolveMargins", () => {
  it("expands a shorthand length to all four sides", () => {
    expect(resolveMargins("1in")).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
  });

  it("fills unspecified sides with the default", () => {
    const margins = resolveMargins({ top: "1in" });
    expect(margins.top).toBe(72);
    expect(margins.right).toBe(36);
    expect(margins.bottom).toBe(36);
    expect(margins.left).toBe(36);
  });

  it("defaults to half an inch", () => {
    expect(resolveMargins()).toEqual({ top: 36, right: 36, bottom: 36, left: 36 });
  });

  it("rejects negative margins", () => {
    expect(() => resolveMargins({ left: "-1in" })).toThrow(RangeError);
  });
});

describe("pageGeometry", () => {
  it("computes the content box in PDF user space", () => {
    const { size, content } = pageGeometry("Letter", "portrait", "1in");
    expect(size).toEqual({ width: 612, height: 792 });
    // Origin is bottom-left, so the content box sits at (left, bottom).
    expect(content).toEqual({ x: 72, y: 72, width: 612 - 144, height: 792 - 144 });
  });

  it("handles asymmetric margins", () => {
    const { content } = pageGeometry("Letter", "portrait", {
      top: "1in",
      bottom: "0.5in",
      left: "0.75in",
      right: "0.25in",
    });
    expect(content).toEqual({ x: 54, y: 36, width: 612 - 72, height: 792 - 108 });
  });

  it("throws when margins leave no room rather than emitting a degenerate page", () => {
    expect(() => pageGeometry("A5", "portrait", "6in")).toThrow(RangeError);
  });

  it("is deterministic: identical input yields identical geometry", () => {
    expect(pageGeometry("A4", "landscape", "12mm")).toEqual(
      pageGeometry("A4", "landscape", "12mm"),
    );
  });
});
