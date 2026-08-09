import { describe, expect, it } from "vitest";

import { ptToPx, pxToPt, round, toPt } from "../src/units.js";

describe("unit conversion", () => {
  it("converts CSS pixels to points at 72/96", () => {
    expect(pxToPt(96)).toBe(72);
    expect(pxToPt(0)).toBe(0);
    expect(ptToPx(72)).toBe(96);
  });

  it("round-trips px through pt", () => {
    for (const px of [1, 16, 100, 1024.5]) {
      expect(ptToPx(pxToPt(px))).toBeCloseTo(px, 10);
    }
  });

  it("parses every supported unit", () => {
    expect(toPt("1in")).toBe(72);
    expect(toPt("72pt")).toBe(72);
    expect(toPt("96px")).toBe(72);
    expect(toPt("6pc")).toBe(72);
    expect(toPt("25.4mm")).toBeCloseTo(72, 10);
    expect(toPt("2.54cm")).toBeCloseTo(72, 10);
    expect(toPt("101.6q")).toBeCloseTo(72, 10);
  });

  it("treats bare and unitless numbers as CSS pixels", () => {
    expect(toPt(96)).toBe(72);
    expect(toPt("96")).toBe(72);
  });

  it("accepts signs, whitespace and mixed case", () => {
    expect(toPt("  1IN ")).toBe(72);
    expect(toPt("-1in")).toBe(-72);
    expect(toPt("+.5in")).toBe(36);
  });

  it("rejects garbage rather than guessing", () => {
    for (const bad of ["", "auto", "10em", "10 in", "1e3px", "NaN"]) {
      expect(() => toPt(bad)).toThrow(RangeError);
    }
    expect(() => toPt(Number.NaN)).toThrow(RangeError);
    expect(() => toPt(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("round", () => {
  it("quantises to 4 decimals by default", () => {
    expect(round(1 / 3)).toBe(0.3333);
    expect(round(841.8897637795277)).toBe(841.8898);
  });

  it("normalises negative zero so it never serialises as -0", () => {
    expect(Object.is(round(-0.00001), 0)).toBe(true);
  });

  it("is stable across repeated application", () => {
    const once = round(Math.PI, 3);
    expect(round(once, 3)).toBe(once);
  });
});
