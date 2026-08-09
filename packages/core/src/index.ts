/**
 * Public API.
 *
 * The surface stays deliberately small: `render` plus the option types. Every
 * other module in this package is internal and may change without notice.
 */

import { NotImplementedError } from "./errors.js";
import { resolveOptions, type RenderOptions } from "./options.js";

export { RenderError, NotImplementedError } from "./errors.js";
export { resolveOptions } from "./options.js";
export type {
  DocumentMetadata,
  RenderOptions,
  ResolvedOptions,
  TextMode,
} from "./options.js";
export type {
  Margins,
  MarginsInput,
  NamedPageSize,
  Orientation,
  PageGeometry,
  PageSize,
  PageSizeInput,
  Rect,
} from "./page/geometry.js";
export { pageGeometry } from "./page/geometry.js";
export type { Length, Pt } from "./units.js";
export { ptToPx, pxToPt, toPt } from "./units.js";

/**
 * Render a live DOM element to a PDF byte stream.
 *
 * Pipeline: measure into a hidden container sized to the page content box,
 * fragment into page containers and let the browser reflow each, extract final
 * geometry, emit PDF operators.
 */
export async function render(
  element: Element,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new NotImplementedError(
      "Rendering outside a browser (this library uses the browser as its layout engine)",
    );
  }

  // Validates and normalises now so option errors surface before any DOM work.
  resolveOptions(options);
  void element;

  // Landing across M1 (writer) through M4 (emission).
  throw new NotImplementedError("render");
}
