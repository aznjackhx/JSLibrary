/**
 * DOM measurement — internal.
 *
 * Step 1 of the pipeline. Clone the target into a hidden container sized to the
 * page content box, let the browser lay it out, and read the result back.
 */

import { BaselineProbe } from "./baseline.js";
import { MeasurementContainer } from "./container.js";
import { round } from "./styles.js";
import type { CapturedImage } from "./images.js";
import type { MeasureResult } from "./types.js";
import { walkElement } from "./walk.js";

export { BaselineProbe } from "./baseline.js";
export type { BaselineMetrics } from "./baseline.js";
export {
  copyInheritedStyles,
  MeasurementContainer,
  withMeasurementContainer,
} from "./container.js";
export type { MeasurementContainerOptions } from "./container.js";
export {
  captureImage,
  decodeDataUrl,
  jpegComponentCount,
} from "./images.js";
export type { CapturedImage } from "./images.js";
export { clusterSpans, measureTextNode } from "./lines.js";
export type { LineMeasurementOptions } from "./lines.js";
export { captureStyle, isVisuallyEmpty, parseColor, parsePx, round } from "./styles.js";
export type * from "./types.js";
export { walkElement } from "./walk.js";
export type { WalkOptions } from "./walk.js";

export interface MeasureOptions {
  /** Width of the page content box, in CSS pixels. */
  readonly width: number;
  /**
   * Record per-cluster x positions, so emission can pin every glyph to where
   * the browser put it. Default true, matching the precise text path.
   */
  readonly precise?: boolean;
}

/**
 * Measure an element's content laid out at a given width.
 *
 * The container is torn down before returning, so the result is a plain data
 * structure with no live DOM references — nothing downstream can accidentally
 * depend on the document still being in the state it was measured in.
 */
export function measure(element: Element, options: MeasureOptions): MeasureResult {
  const container = MeasurementContainer.create(element, { width: options.width });

  try {
    const origin = container.origin;
    const probe = new BaselineProbe(container.element);
    const images = new Map<string, CapturedImage>();

    const root = walkElement(container.content, {
      origin,
      probe,
      precise: options.precise ?? true,
      images,
      sourceImages: container.sourceImages,
    });

    if (!root) {
      throw new Error("The element being measured is not displayed and produced no geometry");
    }

    return {
      document: {
        contentWidth: round(options.width),
        contentHeight: round(container.contentHeight),
        root,
      },
      images,
    };
  } finally {
    container.destroy();
  }
}
