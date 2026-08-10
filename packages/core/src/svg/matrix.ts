/**
 * Affine transforms, in the six-number form both SVG and PDF use.
 *
 * `[a b c d e f]` means the matrix
 *
 *     | a  b  0 |
 *     | c  d  0 |
 *     | e  f  1 |
 *
 * which is exactly what PDF's `cm` operator takes, so a transform accumulated
 * here can be written out without conversion.
 */

export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Apply `first`, then `second`. */
export function multiply(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;

  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function scaling(x: number, y: number): Matrix {
  return [x, 0, 0, y, 0, 0];
}

export function rotation(degrees: number): Matrix {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

/** Map a point through a matrix. */
export function apply(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/**
 * The scale a matrix applies, as one number.
 *
 * Stroke width is a single value but a transform may scale the axes
 * differently; the geometric mean is what a renderer uses, and it is exact
 * whenever the scale is uniform — which it almost always is.
 */
export function averageScale(matrix: Matrix): number {
  const [a, b, c, d] = matrix;
  return Math.sqrt(Math.abs(a * d - b * c)) || 1;
}

/**
 * Parse an SVG `transform` attribute.
 *
 * Unknown functions are skipped rather than treated as an error: the rest of
 * the transform list is still meaningful, and dropping the whole element would
 * lose more than it saves.
 */
export function parseTransform(value: string): Matrix {
  let matrix: Matrix = IDENTITY;

  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match = pattern.exec(value);

  while (match) {
    const fn = (match[1] as string).toLowerCase();
    const args = (match[2] as string)
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part));

    const step = matrixFor(fn, args);
    if (step) matrix = multiply(step, matrix);

    match = pattern.exec(value);
  }

  return matrix;
}

function matrixFor(fn: string, args: number[]): Matrix | undefined {
  switch (fn) {
    case "matrix":
      if (args.length < 6) return undefined;
      return [
        args[0] as number,
        args[1] as number,
        args[2] as number,
        args[3] as number,
        args[4] as number,
        args[5] as number,
      ];
    case "translate":
      if (args.length < 1) return undefined;
      return translation(args[0] as number, args[1] ?? 0);
    case "scale":
      if (args.length < 1) return undefined;
      // One argument scales both axes equally.
      return scaling(args[0] as number, args[1] ?? (args[0] as number));
    case "rotate": {
      if (args.length < 1) return undefined;
      const angle = args[0] as number;
      if (args.length < 3) return rotation(angle);
      // Rotation about a point: move it to the origin, rotate, move it back.
      const cx = args[1] as number;
      const cy = args[2] as number;
      return multiply(
        multiply(translation(-cx, -cy), rotation(angle)),
        translation(cx, cy),
      );
    }
    case "skewx":
      if (args.length < 1) return undefined;
      return [1, 0, Math.tan(((args[0] as number) * Math.PI) / 180), 1, 0, 0];
    case "skewy":
      if (args.length < 1) return undefined;
      return [1, Math.tan(((args[0] as number) * Math.PI) / 180), 0, 1, 0, 0];
    default:
      return undefined;
  }
}

export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Parse a `viewBox` attribute, rejecting the degenerate forms. */
export function parseViewBox(value: string): ViewBox | undefined {
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));

  if (numbers.length !== 4 || numbers.some((number) => !Number.isFinite(number))) return undefined;

  const [x, y, width, height] = numbers as [number, number, number, number];
  // A zero or negative extent disables rendering entirely, per the spec.
  if (!(width > 0) || !(height > 0)) return undefined;

  return { x, y, width, height };
}

/**
 * The transform a `viewBox` implies, honouring `preserveAspectRatio`.
 *
 * The default is `xMidYMid meet`: scale uniformly so the whole view box fits,
 * and centre what is left over. Getting this wrong stretches every icon in the
 * document, so the alignment keywords are implemented rather than assumed.
 */
export function viewBoxTransform(
  viewBox: ViewBox,
  width: number,
  height: number,
  preserveAspectRatio = "xMidYMid meet",
): Matrix {
  const tokens = preserveAspectRatio.trim().split(/\s+/);
  const align = (tokens[0] === "defer" ? tokens[1] : tokens[0]) ?? "xMidYMid";
  const meetOrSlice = (tokens[tokens.length - 1] === "slice" ? "slice" : "meet") as
    | "meet"
    | "slice";

  let scaleX = width / viewBox.width;
  let scaleY = height / viewBox.height;

  if (align !== "none") {
    const uniform =
      meetOrSlice === "slice" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    scaleX = uniform;
    scaleY = uniform;
  }

  let translateX = -viewBox.x * scaleX;
  let translateY = -viewBox.y * scaleY;

  const spareX = width - viewBox.width * scaleX;
  const spareY = height - viewBox.height * scaleY;

  if (align.includes("xMid")) translateX += spareX / 2;
  else if (align.includes("xMax")) translateX += spareX;

  if (align.includes("YMid")) translateY += spareY / 2;
  else if (align.includes("YMax")) translateY += spareY;

  return multiply(scaling(scaleX, scaleY), translation(translateX, translateY));
}
