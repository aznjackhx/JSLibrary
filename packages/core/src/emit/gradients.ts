/**
 * SVG gradients as PDF shadings.
 *
 * A gradient is the one paint SVG has that PDF cannot express as a colour: it
 * needs a shading object and a function describing the ramp. Both are built
 * here, and the caller clips to the shape and floods it with `sh`.
 *
 * Stop opacity is not honoured. Doing so needs a soft-mask group whose
 * luminosity is the alpha ramp, which is a larger piece of work; a translucent
 * stop currently paints at full strength. That is visibly wrong rather than
 * silently wrong, and both beat the previous behaviour of painting nothing.
 */

import type { CapturedGradient, CapturedStop } from "../measure/svg.js";
import type { PdfDocument } from "../pdf/document.js";
import { dict, name, type PdfRef, type PdfValue } from "../pdf/objects.js";
import type { PathSegment } from "../svg/path.js";
import { IDENTITY, multiply, scaling, translation, type Matrix } from "../svg/matrix.js";

/** Colour components as PDF expects them: three numbers in 0–1. */
function components(stop: CapturedStop): number[] {
  return [stop.color.r / 255, stop.color.g / 255, stop.color.b / 255];
}

/**
 * The ramp between the stops, as a PDF function.
 *
 * One exponential segment per pair of adjacent stops, stitched together at
 * their offsets. `N 1` makes each segment a straight interpolation, which is
 * what SVG specifies.
 */
function rampFunction(document_: PdfDocument, stops: readonly CapturedStop[]): PdfRef {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);

  const segments: PdfValue[] = [];
  const bounds: number[] = [];
  const encode: number[] = [];

  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const from = sorted[index] as CapturedStop;
    const to = sorted[index + 1] as CapturedStop;

    segments.push(
      document_.add(
        dict({
          FunctionType: 2,
          Domain: [0, 1],
          C0: components(from),
          C1: components(to),
          N: 1,
        }),
      ),
    );
    encode.push(0, 1);
    if (index > 0) bounds.push(from.offset);
  }

  if (segments.length === 1) return segments[0] as PdfRef;

  // Bounds must strictly increase, and two stops at the same offset — a hard
  // colour change, which is a legitimate thing to author — would otherwise
  // produce a function a viewer rejects.
  //
  // The nudge has to be large enough to survive serialisation: numbers are
  // written to four decimals, so anything smaller rounds back to the value it
  // was separated from and the function is invalid again. A thousandth of the
  // ramp is far below anything visible.
  let previous = 0;
  const strict = bounds.map((bound) => {
    const value = Math.max(bound, previous + 0.001);
    previous = value;
    return Math.min(value, 1);
  });

  return document_.add(
    dict({
      FunctionType: 3,
      Domain: [0, 1],
      Functions: segments,
      Bounds: strict,
      Encode: encode,
    }),
  );
}

/** The shading object for a gradient. */
export function embedGradient(document_: PdfDocument, gradient: CapturedGradient): PdfRef {
  const shared = {
    ColorSpace: name("DeviceRGB"),
    Function: rampFunction(document_, gradient.stops),
    // Beyond the ends the terminal colours continue, which is SVG's `pad` and
    // its default. `reflect` and `repeat` are not expressible this way and
    // degrade to pad.
    Extend: [true, true],
  };

  if (gradient.kind === "radial") {
    return document_.add(
      dict({
        ShadingType: 3,
        ...shared,
        // A radial shading interpolates between two circles: PDF's start
        // circle is the focus at zero radius, which is exactly SVG's `fx`/`fy`.
        Coords: [gradient.fx, gradient.fy, 0, gradient.cx, gradient.cy, gradient.r],
      }),
    );
  }

  return document_.add(
    dict({
      ShadingType: 2,
      ...shared,
      Coords: [gradient.x1, gradient.y1, gradient.x2, gradient.y2],
    }),
  );
}

/** Axis-aligned bounds of a path, in its own coordinates. */
export function segmentBounds(
  segments: readonly PathSegment[],
): { x: number; y: number; width: number; height: number } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const segment of segments) {
    switch (segment.kind) {
      case "move":
      case "line":
        include(segment.x, segment.y);
        break;
      case "cubic":
        // Control points bound the curve. The true extent can be smaller, so
        // a curved shape's gradient is stretched very slightly compared with
        // the browser's — invisible for the shallow curves shapes are built
        // from, and far cheaper than solving each segment's extrema.
        include(segment.x1, segment.y1);
        include(segment.x2, segment.y2);
        include(segment.x, segment.y);
        break;
      case "close":
        break;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Map the gradient's own coordinates onto the shape being filled.
 *
 * With `objectBoundingBox` units — SVG's default — the coordinates are
 * fractions of the shape's bounds, which are only known once there is a shape,
 * which is why this is resolved at paint time rather than at capture.
 */
export function gradientMatrix(
  gradient: CapturedGradient,
  segments: readonly PathSegment[],
): Matrix | undefined {
  if (!gradient.onBoundingBox) return gradient.transform;

  const bounds = segmentBounds(segments);
  // A shape with no area has no bounding box to be a fraction of, and mapping
  // onto it would collapse the gradient to a point.
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return undefined;

  const toBox = multiply(
    scaling(bounds.width, bounds.height),
    translation(bounds.x, bounds.y),
  );

  return multiply(gradient.transform === IDENTITY ? IDENTITY : gradient.transform, toBox);
}
