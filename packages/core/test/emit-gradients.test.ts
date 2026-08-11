import { describe, expect, it } from "vitest";

import { embedGradient, gradientMatrix, segmentBounds } from "../src/emit/gradients.js";
import type { CapturedGradient } from "../src/measure/svg.js";
import { PdfDocument } from "../src/pdf/document.js";
import type { PathSegment } from "../src/svg/path.js";

const black = { r: 0, g: 0, b: 0, a: 1 };
const white = { r: 255, g: 255, b: 255, a: 1 };

function linear(overrides: Partial<CapturedGradient> = {}): CapturedGradient {
  return {
    kind: "linear",
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 0,
    cx: 0.5,
    cy: 0.5,
    r: 0.5,
    fx: 0.5,
    fy: 0.5,
    stops: [
      { offset: 0, color: black },
      { offset: 1, color: white },
    ],
    onBoundingBox: true,
    transform: [1, 0, 0, 1, 0, 0],
    ...overrides,
  };
}

const square: PathSegment[] = [
  { kind: "move", x: 10, y: 20 },
  { kind: "line", x: 50, y: 20 },
  { kind: "line", x: 50, y: 60 },
  { kind: "close" },
];

describe("gradient shadings", () => {
  it("writes an axial shading for a linear gradient", () => {
    const document_ = new PdfDocument();
    const ref = embedGradient(document_, linear());
    expect(ref).toBeDefined();
  });

  it("stitches a ramp that a viewer will accept", () => {
    // Bounds in a stitching function must strictly increase. Two stops at the
    // same offset is a legitimate way to author a hard colour change, and
    // emitting equal bounds produces a function readers reject outright.
    // Object streams off and no compression, so the function dictionary is
    // readable in the output bytes.
    const document_ = new PdfDocument({ objectStreams: false, xref: "table" });
    document_.addPage({ width: 10, height: 10 });
    const ref = embedGradient(
      document_,
      linear({
        stops: [
          { offset: 0, color: black },
          { offset: 0.5, color: white },
          { offset: 0.5, color: black },
          { offset: 1, color: white },
        ],
      }),
    );

    const bytes = Buffer.from(document_.toBytes()).toString("latin1");
    const bounds = /\/Bounds \[([^\]]*)\]/.exec(bytes)?.[1] ?? "";
    const values = bounds.trim().split(/\s+/).map(Number);

    expect(values).toHaveLength(2);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index] as number).toBeGreaterThan(values[index - 1] as number);
    }
    expect(ref).toBeDefined();
  });

  describe("bounding-box units", () => {
    it("maps the gradient onto the shape's own bounds", () => {
      // The default units are fractions of the filled shape, so the same
      // gradient stretches to each shape it fills.
      expect(gradientMatrix(linear(), square)).toEqual([40, 0, 0, 40, 10, 20]);
    });

    it("declines a shape with no area", () => {
      // Mapping onto a zero-width box would collapse the ramp to a point and
      // emit a shading a viewer cannot evaluate.
      const flat: PathSegment[] = [
        { kind: "move", x: 10, y: 20 },
        { kind: "line", x: 10, y: 60 },
      ];
      expect(gradientMatrix(linear(), flat)).toBeUndefined();
    });

    it("leaves a user-space gradient where it was authored", () => {
      const transform: [number, number, number, number, number, number] = [2, 0, 0, 2, 5, 5];
      expect(gradientMatrix(linear({ onBoundingBox: false, transform }), square)).toEqual(
        transform,
      );
    });
  });

  it("bounds a curve by its control points", () => {
    const curved: PathSegment[] = [
      { kind: "move", x: 0, y: 0 },
      { kind: "cubic", x1: 10, y1: -5, x2: 20, y2: 15, x: 30, y: 0 },
    ];
    expect(segmentBounds(curved)).toEqual({ x: 0, y: -5, width: 30, height: 20 });
  });
});

describe("shading reuse", () => {
  it("embeds one shading for a gradient used by many shapes", async () => {
    // Capture produces a fresh descriptor per filled shape, so identity is not
    // enough: a chart whose forty bars share one gradient would embed forty
    // shadings, each with its own ramp function.
    const { EmissionContext } = await import("../src/emit/emit.js");
    const { FontRegistry } = await import("../src/fonts/resolve.js");

    const document_ = new PdfDocument();
    const context = new EmissionContext({
      document: document_,
      registry: new FontRegistry(),
      images: new Map(),
      precise: true,
    });

    const first = context.shadingFor(linear());
    const second = context.shadingFor(linear());
    const different = context.shadingFor(linear({ kind: "radial" }));

    expect(second).toBe(first);
    expect(different).not.toBe(first);
  });
});
