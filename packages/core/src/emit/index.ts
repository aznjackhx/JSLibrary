/**
 * Emission — internal.
 *
 * Step 4 of the pipeline: measured geometry to PDF content-stream operators.
 */

export { EmissionContext, ownsLine, paintNode, paintPage } from "./emit.js";
export type { EmitOptions, PageBand, PaintOptions } from "./emit.js";
export { paginate, paintPagedDocument } from "./pages.js";
export type { PageSlice } from "./pages.js";
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
