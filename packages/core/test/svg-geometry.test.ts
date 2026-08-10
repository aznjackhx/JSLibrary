import { describe, expect, it } from "vitest";

import {
  apply,
  averageScale,
  IDENTITY,
  multiply,
  parseTransform,
  parseViewBox,
  viewBoxTransform,
  type Matrix,
} from "../src/svg/matrix.js";
import {
  ellipseSegments,
  parsePoints,
  polySegments,
  rectSegments,
} from "../src/svg/shapes.js";

/** Bounding box of a set of segments, ignoring control points. */
function bounds(segments: ReturnType<typeof rectSegments>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const segment of segments) {
    if (segment.kind === "close") continue;
    minX = Math.min(minX, segment.x);
    minY = Math.min(minY, segment.y);
    maxX = Math.max(maxX, segment.x);
    maxY = Math.max(maxY, segment.y);
  }

  return { minX, minY, maxX, maxY };
}

describe("rectSegments", () => {
  it("draws a closed rectangle", () => {
    const segments = rectSegments({ x: 10, y: 20, width: 30, height: 40 });

    expect(segments.at(-1)?.kind).toBe("close");
    expect(bounds(segments)).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
  });

  it("draws nothing for a rectangle with no area", () => {
    expect(rectSegments({ x: 0, y: 0, width: 0, height: 10 })).toEqual([]);
    expect(rectSegments({ x: 0, y: 0, width: 10, height: -1 })).toEqual([]);
  });

  it("caps corner radii at half the side", () => {
    // A radius larger than half the side would make the corners cross.
    const capped = rectSegments({ x: 0, y: 0, width: 20, height: 20, rx: 100, ry: 100 });
    const exact = rectSegments({ x: 0, y: 0, width: 20, height: 20, rx: 10, ry: 10 });

    expect(capped).toEqual(exact);
  });

  it("takes one radius as implying the other", () => {
    expect(rectSegments({ x: 0, y: 0, width: 20, height: 20, rx: 4 })).toEqual(
      rectSegments({ x: 0, y: 0, width: 20, height: 20, rx: 4, ry: 4 }),
    );
  });

  it("draws square corners when a radius is zero", () => {
    const square = rectSegments({ x: 0, y: 0, width: 10, height: 10, rx: 0, ry: 5 });
    expect(square.some((segment) => segment.kind === "cubic")).toBe(false);
  });
});

describe("ellipseSegments", () => {
  it("spans twice its radii", () => {
    const segments = ellipseSegments(50, 40, 10, 20);
    const box = bounds(segments);

    expect(box.minX).toBeCloseTo(40, 6);
    expect(box.maxX).toBeCloseTo(60, 6);
    expect(box.minY).toBeCloseTo(20, 6);
    expect(box.maxY).toBeCloseTo(60, 6);
  });

  it("draws nothing for a zero or negative radius", () => {
    expect(ellipseSegments(0, 0, 0, 10)).toEqual([]);
    expect(ellipseSegments(0, 0, 10, -5)).toEqual([]);
  });
});

describe("parsePoints", () => {
  it("accepts commas, spaces, or both", () => {
    expect(parsePoints("0,0 10,10 20 20")).toEqual([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
  });

  it("drops a trailing coordinate with no pair", () => {
    expect(parsePoints("0 0 10")).toEqual([[0, 0]]);
  });
});

describe("polySegments", () => {
  it("closes a polygon and leaves a polyline open", () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];

    expect(polySegments(points, true).at(-1)?.kind).toBe("close");
    expect(polySegments(points, false).at(-1)?.kind).toBe("line");
  });

  it("draws nothing from no points", () => {
    expect(polySegments([], true)).toEqual([]);
  });
});

describe("parseTransform", () => {
  const at = (matrix: Matrix, x: number, y: number): [number, number] => {
    const point = apply(matrix, x, y);
    return [Number(point.x.toFixed(6)), Number(point.y.toFixed(6))];
  };

  it("reads a translation", () => {
    expect(at(parseTransform("translate(10, 20)"), 0, 0)).toEqual([10, 20]);
  });

  it("takes a single translate argument as x only", () => {
    expect(at(parseTransform("translate(10)"), 0, 0)).toEqual([10, 0]);
  });

  it("takes a single scale argument as both axes", () => {
    expect(at(parseTransform("scale(2)"), 3, 4)).toEqual([6, 8]);
  });

  it("rotates about the origin", () => {
    expect(at(parseTransform("rotate(90)"), 1, 0)).toEqual([0, 1]);
  });

  it("rotates about a given point", () => {
    // The centre of rotation must not move.
    expect(at(parseTransform("rotate(90, 5, 5)"), 5, 5)).toEqual([5, 5]);
  });

  it("applies a list left to right", () => {
    // translate then scale: the translation is scaled too.
    expect(at(parseTransform("scale(2) translate(10, 0)"), 0, 0)).toEqual([20, 0]);
  });

  it("skips a function it does not know without losing the rest", () => {
    expect(at(parseTransform("bogus(1) translate(5, 5)"), 0, 0)).toEqual([5, 5]);
  });

  it("is the identity for empty or malformed input", () => {
    expect(parseTransform("")).toEqual(IDENTITY);
    expect(parseTransform("translate()")).toEqual(IDENTITY);
  });
});

describe("multiply", () => {
  it("applies the first matrix, then the second", () => {
    const combined = multiply([1, 0, 0, 1, 10, 0], [2, 0, 0, 2, 0, 0]);
    expect(apply(combined, 0, 0)).toEqual({ x: 20, y: 0 });
  });
});

describe("averageScale", () => {
  it("returns the uniform scale exactly", () => {
    expect(averageScale([3, 0, 0, 3, 0, 0])).toBeCloseTo(3, 10);
  });

  it("takes the geometric mean of unequal axes", () => {
    expect(averageScale([4, 0, 0, 1, 0, 0])).toBeCloseTo(2, 10);
  });
});

describe("parseViewBox", () => {
  it("reads four numbers", () => {
    expect(parseViewBox("0 0 100 50")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it("rejects a degenerate or malformed box", () => {
    expect(parseViewBox("0 0 0 50")).toBeUndefined();
    expect(parseViewBox("0 0 -1 50")).toBeUndefined();
    expect(parseViewBox("0 0 100")).toBeUndefined();
  });
});

describe("viewBoxTransform", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };

  it("scales the view box onto the element", () => {
    const matrix = viewBoxTransform(box, 200, 200);
    expect(apply(matrix, 100, 100)).toEqual({ x: 200, y: 200 });
  });

  it("keeps the aspect ratio and centres the slack", () => {
    // A square view box in a wide box: scale to fit the height, centre it.
    const matrix = viewBoxTransform(box, 200, 100);
    const point = apply(matrix, 0, 0);

    expect(point.y).toBeCloseTo(0, 6);
    expect(point.x).toBeCloseTo(50, 6);
  });

  it("aligns to the start when told to", () => {
    const matrix = viewBoxTransform(box, 200, 100, "xMinYMin meet");
    expect(apply(matrix, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("stretches when preserveAspectRatio is none", () => {
    const matrix = viewBoxTransform(box, 200, 50, "none");
    expect(apply(matrix, 100, 100)).toEqual({ x: 200, y: 50 });
  });

  it("fills the box when told to slice", () => {
    // slice scales up to cover, so the view box overflows rather than fits.
    const matrix = viewBoxTransform(box, 200, 100, "xMidYMid slice");
    expect(apply(matrix, 100, 100).x).toBeCloseTo(200, 6);
  });

  it("offsets a view box that does not start at the origin", () => {
    const matrix = viewBoxTransform({ x: 10, y: 20, width: 100, height: 100 }, 100, 100);
    expect(apply(matrix, 10, 20)).toEqual({ x: 0, y: 0 });
  });
});
