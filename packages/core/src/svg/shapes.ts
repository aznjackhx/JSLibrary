/**
 * The basic shapes, expressed as path segments.
 *
 * SVG's `rect`, `circle`, `ellipse`, `line`, `polyline` and `polygon` are all
 * shorthand for paths. Converting them here means the emitter has one thing to
 * draw rather than seven, and the rounding rules — a `rect` whose corner radii
 * exceed half its size, an `ellipse` with a negative radius — are applied once.
 */

import type { PathSegment } from "./path.js";

/** Cubic control-point offset that approximates a quarter ellipse. */
const KAPPA = 0.5522847498307936;

export interface RectGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx?: number;
  readonly ry?: number;
}

/** A rectangle, with optional rounded corners. */
export function rectSegments(rect: RectGeometry): PathSegment[] {
  const { x, y, width, height } = rect;
  // A rectangle with no area draws nothing at all, per the specification.
  if (!(width > 0) || !(height > 0)) return [];

  // Either radius alone implies the other; both are capped at half the side.
  const rxRaw = rect.rx ?? rect.ry ?? 0;
  const ryRaw = rect.ry ?? rect.rx ?? 0;
  const rx = Math.min(Math.max(rxRaw, 0), width / 2);
  const ry = Math.min(Math.max(ryRaw, 0), height / 2);

  if (rx === 0 || ry === 0) {
    return [
      { kind: "move", x, y },
      { kind: "line", x: x + width, y },
      { kind: "line", x: x + width, y: y + height },
      { kind: "line", x, y: y + height },
      { kind: "close" },
    ];
  }

  const cx = rx * KAPPA;
  const cy = ry * KAPPA;
  const right = x + width;
  const bottom = y + height;

  return [
    { kind: "move", x: x + rx, y },
    { kind: "line", x: right - rx, y },
    { kind: "cubic", x1: right - rx + cx, y1: y, x2: right, y2: y + ry - cy, x: right, y: y + ry },
    { kind: "line", x: right, y: bottom - ry },
    {
      kind: "cubic",
      x1: right,
      y1: bottom - ry + cy,
      x2: right - rx + cx,
      y2: bottom,
      x: right - rx,
      y: bottom,
    },
    { kind: "line", x: x + rx, y: bottom },
    {
      kind: "cubic",
      x1: x + rx - cx,
      y1: bottom,
      x2: x,
      y2: bottom - ry + cy,
      x,
      y: bottom - ry,
    },
    { kind: "line", x, y: y + ry },
    { kind: "cubic", x1: x, y1: y + ry - cy, x2: x + rx - cx, y2: y, x: x + rx, y },
    { kind: "close" },
  ];
}

/** An ellipse, which covers `circle` too. */
export function ellipseSegments(cx: number, cy: number, rx: number, ry: number): PathSegment[] {
  if (!(rx > 0) || !(ry > 0)) return [];

  const ox = rx * KAPPA;
  const oy = ry * KAPPA;

  return [
    { kind: "move", x: cx + rx, y: cy },
    { kind: "cubic", x1: cx + rx, y1: cy + oy, x2: cx + ox, y2: cy + ry, x: cx, y: cy + ry },
    { kind: "cubic", x1: cx - ox, y1: cy + ry, x2: cx - rx, y2: cy + oy, x: cx - rx, y: cy },
    { kind: "cubic", x1: cx - rx, y1: cy - oy, x2: cx - ox, y2: cy - ry, x: cx, y: cy - ry },
    { kind: "cubic", x1: cx + ox, y1: cy - ry, x2: cx + rx, y2: cy - oy, x: cx + rx, y: cy },
    { kind: "close" },
  ];
}

/** A straight line between two points. */
export function lineSegments(x1: number, y1: number, x2: number, y2: number): PathSegment[] {
  return [
    { kind: "move", x: x1, y: y1 },
    { kind: "line", x: x2, y: y2 },
  ];
}

/** Parse a `points` list, which allows commas or whitespace in any mix. */
export function parsePoints(value: string): Array<[number, number]> {
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));

  const points: Array<[number, number]> = [];
  // An odd trailing coordinate is dropped: half a point is not a point.
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push([numbers[index] as number, numbers[index + 1] as number]);
  }
  return points;
}

/** A polyline or, when closed, a polygon. */
export function polySegments(
  points: ReadonlyArray<readonly [number, number]>,
  close: boolean,
): PathSegment[] {
  if (points.length === 0) return [];

  const [first, ...rest] = points as Array<readonly [number, number]>;
  const segments: PathSegment[] = [
    { kind: "move", x: (first as readonly [number, number])[0], y: (first as readonly [number, number])[1] },
  ];

  for (const [x, y] of rest) segments.push({ kind: "line", x, y });
  if (close) segments.push({ kind: "close" });

  return segments;
}
