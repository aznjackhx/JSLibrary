/**
 * SVG path data, reduced to what PDF can draw.
 *
 * PDF understands three path operators: move, line and cubic Bézier. SVG has
 * ten commands, in absolute and relative forms, with implicit repetition and
 * smooth variants that infer a control point from the previous segment. All of
 * it reduces to the three, so everything downstream deals with a much smaller
 * language than the one authors write.
 *
 * Quadratics become cubics exactly. Arcs do not — no Bézier is an ellipse — so
 * they are split into segments of at most 90° and approximated, which is the
 * standard construction and is accurate to well under a printer dot.
 */

/** A path segment, in absolute user-space coordinates. */
export type PathSegment =
  | { readonly kind: "move"; readonly x: number; readonly y: number }
  | { readonly kind: "line"; readonly x: number; readonly y: number }
  | {
      readonly kind: "cubic";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: "close" };

/** Split path data into command letters and their numeric arguments. */
function* tokenize(data: string): Generator<{ command: string; numbers: number[] }> {
  // Numbers in path data may omit separators entirely: "1-2.5.3" is 1, -2.5, 0.3.
  const numberPattern = /-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
  const commandPattern = /[MmLlHhVvCcSsQqTtAaZz]/g;

  let match = commandPattern.exec(data);
  while (match) {
    const command = match[0];
    const next = commandPattern.exec(data);
    const body = data.slice(match.index + 1, next ? next.index : data.length);

    numberPattern.lastIndex = 0;
    const numbers: number[] = [];
    let number = numberPattern.exec(body);
    while (number) {
      numbers.push(Number.parseFloat(number[0]));
      number = numberPattern.exec(body);
    }

    yield { command, numbers };
    match = next;
  }
}

/** How many arguments each command consumes per repetition. */
const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/**
 * Approximate an elliptical arc with cubic Béziers.
 *
 * The endpoint parameterisation SVG uses has to be converted to a centre and
 * sweep first; the out-of-range corrections are the ones the specification
 * mandates rather than choices made here.
 */
function arcToCubics(
  x0: number,
  y0: number,
  rxInput: number,
  ryInput: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number,
): PathSegment[] {
  // A zero radius means a straight line, per the specification.
  if (rxInput === 0 || ryInput === 0) return [{ kind: "line", x, y }];
  if (x0 === x && y0 === y) return [];

  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;

  // Radii too small to span the endpoints are scaled up until they just fit.
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(numerator / denominator, 0));

  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;

  const cx = cosPhi * cx1 - sinPhi * cy1 + (x0 + x) / 2;
  const cy = sinPhi * cx1 + cosPhi * cy1 + (y0 + y) / 2;

  const angleOf = (ux: number, uy: number): number => Math.atan2(uy, ux);
  const start = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry);
  const end = angleOf((-x1 - cx1) / rx, (-y1 - cy1) / ry);

  let sweepAngle = end - start;
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  else if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  // A cubic approximates an arc well up to about a quarter turn.
  const count = Math.max(Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)), 1);
  const step = sweepAngle / count;
  const alpha = (4 / 3) * Math.tan(step / 4);

  const segments: PathSegment[] = [];
  let theta = start;

  const pointAt = (angle: number): { x: number; y: number } => ({
    x: cx + rx * Math.cos(angle) * cosPhi - ry * Math.sin(angle) * sinPhi,
    y: cy + rx * Math.cos(angle) * sinPhi + ry * Math.sin(angle) * cosPhi,
  });
  const derivativeAt = (angle: number): { x: number; y: number } => ({
    x: -rx * Math.sin(angle) * cosPhi - ry * Math.cos(angle) * sinPhi,
    y: -rx * Math.sin(angle) * sinPhi + ry * Math.cos(angle) * cosPhi,
  });

  for (let index = 0; index < count; index += 1) {
    const next = theta + step;
    const from = pointAt(theta);
    const to = pointAt(next);
    const fromPrime = derivativeAt(theta);
    const toPrime = derivativeAt(next);

    segments.push({
      kind: "cubic",
      x1: from.x + alpha * fromPrime.x,
      y1: from.y + alpha * fromPrime.y,
      x2: to.x - alpha * toPrime.x,
      y2: to.y - alpha * toPrime.y,
      x: to.x,
      y: to.y,
    });

    theta = next;
  }

  return segments;
}

/**
 * Parse SVG path data into absolute move, line and cubic segments.
 *
 * Malformed data is truncated at the point it stops making sense rather than
 * throwing: a browser draws what it can, and so should this.
 */
export function parsePathData(data: string): PathSegment[] {
  const segments: PathSegment[] = [];

  let currentX = 0;
  let currentY = 0;
  // Where the current subpath began, which is where `Z` returns to.
  let startX = 0;
  let startY = 0;
  // Reflected control points for the smooth variants.
  let lastCubicControl: { x: number; y: number } | undefined;
  let lastQuadraticControl: { x: number; y: number } | undefined;

  const quadraticToCubic = (
    qx: number,
    qy: number,
    x: number,
    y: number,
  ): PathSegment => ({
    kind: "cubic",
    x1: currentX + (2 / 3) * (qx - currentX),
    y1: currentY + (2 / 3) * (qy - currentY),
    x2: x + (2 / 3) * (qx - x),
    y2: y + (2 / 3) * (qy - y),
    x,
    y,
  });

  for (const { command, numbers } of tokenize(data)) {
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const arity = ARITY[upper];
    if (arity === undefined) continue;

    if (upper === "Z") {
      segments.push({ kind: "close" });
      currentX = startX;
      currentY = startY;
      lastCubicControl = undefined;
      lastQuadraticControl = undefined;
      continue;
    }

    // A command with more arguments than its arity repeats; extra M arguments
    // are line segments, which is the one irregular case.
    let index = 0;
    let first = true;

    while (index + arity <= numbers.length) {
      const args = numbers.slice(index, index + arity) as number[];
      index += arity;

      const dx = relative ? currentX : 0;
      const dy = relative ? currentY : 0;

      switch (upper) {
        case "M": {
          const x = (args[0] as number) + dx;
          const y = (args[1] as number) + dy;
          if (first) {
            segments.push({ kind: "move", x, y });
            startX = x;
            startY = y;
          } else {
            segments.push({ kind: "line", x, y });
          }
          currentX = x;
          currentY = y;
          lastCubicControl = undefined;
          lastQuadraticControl = undefined;
          break;
        }
        case "L": {
          const x = (args[0] as number) + dx;
          const y = (args[1] as number) + dy;
          segments.push({ kind: "line", x, y });
          currentX = x;
          currentY = y;
          lastCubicControl = undefined;
          lastQuadraticControl = undefined;
          break;
        }
        case "H": {
          const x = (args[0] as number) + dx;
          segments.push({ kind: "line", x, y: currentY });
          currentX = x;
          lastCubicControl = undefined;
          lastQuadraticControl = undefined;
          break;
        }
        case "V": {
          const y = (args[0] as number) + dy;
          segments.push({ kind: "line", x: currentX, y });
          currentY = y;
          lastCubicControl = undefined;
          lastQuadraticControl = undefined;
          break;
        }
        case "C": {
          const x1 = (args[0] as number) + dx;
          const y1 = (args[1] as number) + dy;
          const x2 = (args[2] as number) + dx;
          const y2 = (args[3] as number) + dy;
          const x = (args[4] as number) + dx;
          const y = (args[5] as number) + dy;
          segments.push({ kind: "cubic", x1, y1, x2, y2, x, y });
          currentX = x;
          currentY = y;
          lastCubicControl = { x: x2, y: y2 };
          lastQuadraticControl = undefined;
          break;
        }
        case "S": {
          const x2 = (args[0] as number) + dx;
          const y2 = (args[1] as number) + dy;
          const x = (args[2] as number) + dx;
          const y = (args[3] as number) + dy;
          // The first control point mirrors the previous one; with no previous
          // curve it coincides with the current point.
          const x1 = lastCubicControl ? 2 * currentX - lastCubicControl.x : currentX;
          const y1 = lastCubicControl ? 2 * currentY - lastCubicControl.y : currentY;
          segments.push({ kind: "cubic", x1, y1, x2, y2, x, y });
          currentX = x;
          currentY = y;
          lastCubicControl = { x: x2, y: y2 };
          lastQuadraticControl = undefined;
          break;
        }
        case "Q": {
          const qx = (args[0] as number) + dx;
          const qy = (args[1] as number) + dy;
          const x = (args[2] as number) + dx;
          const y = (args[3] as number) + dy;
          segments.push(quadraticToCubic(qx, qy, x, y));
          currentX = x;
          currentY = y;
          lastQuadraticControl = { x: qx, y: qy };
          lastCubicControl = undefined;
          break;
        }
        case "T": {
          const x = (args[0] as number) + dx;
          const y = (args[1] as number) + dy;
          const qx = lastQuadraticControl ? 2 * currentX - lastQuadraticControl.x : currentX;
          const qy = lastQuadraticControl ? 2 * currentY - lastQuadraticControl.y : currentY;
          segments.push(quadraticToCubic(qx, qy, x, y));
          currentX = x;
          currentY = y;
          lastQuadraticControl = { x: qx, y: qy };
          lastCubicControl = undefined;
          break;
        }
        case "A": {
          const x = (args[5] as number) + dx;
          const y = (args[6] as number) + dy;
          segments.push(
            ...arcToCubics(
              currentX,
              currentY,
              args[0] as number,
              args[1] as number,
              args[2] as number,
              (args[3] as number) !== 0,
              (args[4] as number) !== 0,
              x,
              y,
            ),
          );
          currentX = x;
          currentY = y;
          lastCubicControl = undefined;
          lastQuadraticControl = undefined;
          break;
        }
      }

      first = false;
    }
  }

  return segments;
}
