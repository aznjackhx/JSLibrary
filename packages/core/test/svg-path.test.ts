import { describe, expect, it } from "vitest";

import { parsePathData, type PathSegment } from "../src/svg/path.js";

/** Endpoint of each segment, which is what a reader can check by eye. */
function points(segments: readonly PathSegment[]): Array<[number, number] | "close"> {
  return segments.map((segment) =>
    segment.kind === "close" ? "close" : [segment.x, segment.y],
  );
}

describe("parsePathData", () => {
  it("reads absolute moves and lines", () => {
    expect(points(parsePathData("M 10 20 L 30 40"))).toEqual([
      [10, 20],
      [30, 40],
    ]);
  });

  it("reads relative commands against the current point", () => {
    expect(points(parsePathData("M 10 10 l 5 5 l 5 5"))).toEqual([
      [10, 10],
      [15, 15],
      [20, 20],
    ]);
  });

  it("repeats a command given more arguments than it takes", () => {
    expect(points(parsePathData("M 0 0 L 1 1 2 2 3 3"))).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("treats extra arguments after a move as lines", () => {
    // The one irregular case in the grammar: "M 0 0 1 1" is a move then a line.
    const segments = parsePathData("M 0 0 1 1");
    expect(segments.map((segment) => segment.kind)).toEqual(["move", "line"]);
  });

  it("handles numbers run together without separators", () => {
    // "1-2.5.3" is three numbers; a naive split on whitespace reads one.
    expect(points(parsePathData("M0 0L1-2.5"))).toEqual([
      [0, 0],
      [1, -2.5],
    ]);
  });

  it("reads exponent notation", () => {
    expect(points(parsePathData("M 0 0 L 1e2 2E-1"))).toEqual([
      [0, 0],
      [100, 0.2],
    ]);
  });

  it("keeps horizontal and vertical lines on their axis", () => {
    expect(points(parsePathData("M 5 5 H 20 V 30"))).toEqual([
      [5, 5],
      [20, 5],
      [20, 30],
    ]);
  });

  it("returns to the subpath start after a close", () => {
    const segments = parsePathData("M 10 10 L 20 20 Z l 5 0");
    // The relative line after Z is measured from (10, 10), not (20, 20).
    expect(points(segments).at(-1)).toEqual([15, 10]);
  });

  it("converts a quadratic to an equivalent cubic", () => {
    const [, curve] = parsePathData("M 0 0 Q 10 0 10 10");

    expect(curve?.kind).toBe("cubic");
    // The standard elevation: control points sit two thirds of the way from
    // each endpoint towards the quadratic's own control point.
    const cubic = curve as { x1: number; y1: number; x2: number; y2: number; x: number; y: number };
    expect(cubic.x1).toBeCloseTo(20 / 3, 10);
    expect(cubic.y1).toBeCloseTo(0, 10);
    expect(cubic.x2).toBeCloseTo(10, 10);
    expect(cubic.y2).toBeCloseTo(10 / 3, 10);
    expect(cubic.x).toBeCloseTo(10, 10);
    expect(cubic.y).toBeCloseTo(10, 10);
  });

  it("mirrors the previous control point for a smooth cubic", () => {
    const [, , smooth] = parsePathData("M 0 0 C 1 1 2 2 3 3 S 5 5 6 6");
    expect(smooth).toMatchObject({ x1: 4, y1: 4 });
  });

  it("uses the current point when a smooth curve has nothing to mirror", () => {
    const [, smooth] = parsePathData("M 1 1 S 5 5 6 6");
    expect(smooth).toMatchObject({ x1: 1, y1: 1 });
  });

  it("mirrors for a smooth quadratic too", () => {
    const [, , smooth] = parsePathData("M 0 0 Q 4 0 8 0 T 16 0");
    expect(smooth?.kind).toBe("cubic");
    expect(points([smooth as PathSegment])).toEqual([[16, 0]]);
  });

  it("draws a straight line for an arc with a zero radius", () => {
    const segments = parsePathData("M 0 0 A 0 0 0 0 1 10 10");
    expect(segments.map((segment) => segment.kind)).toEqual(["move", "line"]);
  });

  it("approximates an arc with cubics that end where asked", () => {
    const segments = parsePathData("M 0 0 A 50 50 0 0 1 50 50");
    const last = segments.at(-1) as PathSegment;

    expect(segments.length).toBeGreaterThan(1);
    expect(last.kind).toBe("cubic");
    expect((last as { x: number }).x).toBeCloseTo(50, 6);
    expect((last as { y: number }).y).toBeCloseTo(50, 6);
  });

  it("splits a half turn into more than one cubic", () => {
    // A single Bézier cannot approximate more than about a quarter turn.
    const segments = parsePathData("M 0 0 A 50 50 0 1 1 100 0");
    expect(segments.filter((segment) => segment.kind === "cubic").length).toBeGreaterThan(1);
  });

  it("stays on the arc at its midpoint", () => {
    // A quarter circle from (50,0) to (0,50) centred on the origin: every
    // point should be 50 from the centre, which catches a wrong sweep.
    const segments = parsePathData("M 50 0 A 50 50 0 0 1 0 50");
    for (const segment of segments) {
      if (segment.kind === "close") continue;
      const radius = Math.hypot(segment.x, segment.y);
      expect(radius).toBeCloseTo(50, 4);
    }
  });

  it("scales up radii too small to span the endpoints", () => {
    // The specification says to grow them rather than give up.
    const segments = parsePathData("M 0 0 A 1 1 0 0 1 100 0");
    const last = segments.at(-1) as { x: number; y: number };
    expect(last.x).toBeCloseTo(100, 6);
    expect(last.y).toBeCloseTo(0, 6);
  });

  it("ignores an arc that goes nowhere", () => {
    expect(parsePathData("M 10 10 A 5 5 0 0 1 10 10")).toHaveLength(1);
  });

  it("truncates malformed data rather than throwing", () => {
    // A browser draws what it can, and so does this.
    expect(points(parsePathData("M 0 0 L 10"))).toEqual([[0, 0]]);
    expect(parsePathData("")).toEqual([]);
    expect(parsePathData("nonsense")).toEqual([]);
  });
});
