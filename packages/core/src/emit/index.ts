/**
 * Emission — internal.
 *
 * Step 4 of the pipeline: measured geometry to PDF content-stream operators.
 */

export { EmissionContext, paintDocument, paintNode } from "./emit.js";
export type { EmitOptions, PaintOptions } from "./emit.js";
export { drawImage, embedImage, splitRgba } from "./images.js";
export type { EmbeddedImage } from "./images.js";
export {
  boxPath,
  hasRadius,
  isVisible,
  paintBackground,
  paintBorders,
  roundedRectPath,
  setFill,
} from "./paint.js";
export { buildPreciseRun, emitLine, emitTextDecoration } from "./text.js";
export type { TextEmissionOptions } from "./text.js";
export { PageTransform } from "./transform.js";
export type { PageTransformOptions } from "./transform.js";
