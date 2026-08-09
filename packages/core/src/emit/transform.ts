/**
 * The one place that knows about the coordinate flip.
 *
 * Measurement reports CSS pixels with y growing downward from the top-left of
 * the content it laid out. PDF user space is points with y growing upward from
 * the bottom-left of the page. Every conversion between the two goes through
 * here, so no other module has to remember which way is up.
 */

import type { Rect as PageRect } from "../page/geometry.js";
import type { MeasuredRect } from "../measure/types.js";
import { pxToPt, round, type Pt } from "../units.js";

export interface PageTransformOptions {
  /** Content box of the page, in PDF user space. */
  readonly content: PageRect;
  /**
   * Offset into the measured content, in CSS pixels.
   *
   * Page N of a fragmented document starts partway down the measured column;
   * this is how much of it has already been consumed. Zero for a single page.
   */
  readonly scrollY?: number;
}

/** Maps measured CSS pixels onto a page's content box in PDF user space. */
export class PageTransform {
  readonly content: PageRect;
  readonly scrollY: number;

  constructor(options: PageTransformOptions) {
    this.content = options.content;
    this.scrollY = options.scrollY ?? 0;
  }

  /** Horizontal position: same direction, different unit. */
  x(cssX: number): Pt {
    return round(this.content.x + pxToPt(cssX));
  }

  /**
   * Vertical position: flipped.
   *
   * A y of 0 is the top of the content box, which in PDF user space is the
   * *highest* point on the page.
   */
  y(cssY: number): Pt {
    return round(this.content.y + this.content.height - pxToPt(cssY - this.scrollY));
  }

  /** A length, which the flip does not affect. */
  length(cssLength: number): Pt {
    return round(pxToPt(cssLength));
  }

  /**
   * A rectangle.
   *
   * PDF rectangles are anchored at their lower-left corner, so the y that comes
   * back corresponds to the measured rect's *bottom* edge.
   */
  rect(rect: MeasuredRect): PageRect {
    return {
      x: this.x(rect.x),
      y: this.y(rect.y + rect.height),
      width: this.length(rect.width),
      height: this.length(rect.height),
    };
  }

  /** True when any part of a measured rect falls on this page. */
  intersects(rect: MeasuredRect, pageHeightPx: number): boolean {
    const top = rect.y - this.scrollY;
    const bottom = top + rect.height;
    return bottom > 0 && top < pageHeightPx;
  }
}
