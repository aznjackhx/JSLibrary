/**
 * Break atoms: the things a page break must not cut through.
 *
 * Fragmentation reduces to one question asked repeatedly — may the page end
 * here? Rather than answer it by walking the tree at every candidate position,
 * the tree is walked once and flattened into a list of vertical spans that must
 * stay whole. A break is legal wherever it does not fall strictly inside one.
 *
 * A line of text is the archetypal atom. Later kinds — replaced content, blocks
 * marked `break-inside: avoid`, table rows — differ only in how their span is
 * derived, which is why they all land in the same list.
 */

import type { MeasuredElement, MeasuredNode } from "../measure/types.js";
import { applyStranding, collectLineBlocks, type StrandingDefaults } from "./stranding.js";

export type AtomKind = "line" | "replaced" | "avoid" | "out-of-flow";

/** A vertical span of measured content that a break must not divide. */
export interface BreakAtom {
  readonly kind: AtomKind;
  /** Top edge, in measured CSS pixels. */
  readonly top: number;
  /** Bottom edge, in measured CSS pixels. */
  readonly bottom: number;
}

/** A break the document demands, rather than merely permits. */
export interface ForcedBreak {
  /** Content at or below this y starts a new page. */
  readonly y: number;
}

export interface FragmentModel {
  readonly atoms: readonly BreakAtom[];
  readonly forced: readonly ForcedBreak[];
}

/** Values of `break-before` / `break-after` that force a new page. */
const FORCING = new Set(["page", "always", "left", "right", "recto", "verso"]);

/**
 * Elements whose box must not be divided.
 *
 * An image sliced across two pages is the most obviously wrong thing
 * fragmentation can do, and unlike text there is no natural seam.
 */
const REPLACED_TAGS = new Set(["img", "canvas", "svg", "video", "iframe", "object", "embed"]);

/** `float` values that take an element out of the normal flow. */
const FLOATED = new Set(["left", "right", "inline-start", "inline-end"]);

function isReplaced(node: MeasuredElement): boolean {
  return REPLACED_TAGS.has(node.tag) || node.imageRef !== undefined;
}

/**
 * Flatten a measured tree into atoms and forced breaks.
 *
 * Nesting is deliberately not preserved: an atom inside an atom adds nothing,
 * since the outer span already forbids every break the inner one would.
 */
export function buildFragmentModel(
  root: MeasuredElement,
  defaults: StrandingDefaults = {},
): FragmentModel {
  const atoms: BreakAtom[] = [];
  const forced: ForcedBreak[] = [];

  const visit = (node: MeasuredNode, insideAtom: boolean): void => {
    if (node.kind === "text") {
      if (insideAtom) return;
      for (const line of node.lines) {
        atoms.push({
          kind: "line",
          top: line.rect.y,
          bottom: line.rect.y + line.rect.height,
        });
      }
      return;
    }

    const style = node.style;

    // Out-of-flow content does not participate in the normal flow, so a break
    // chosen from the flow around it says nothing about where it may be cut.
    // Absolutely positioned and floated boxes are therefore kept whole where
    // they can be, and `sticky` is treated as the static box it degrades to
    // once there is no scrolling viewport to stick to.
    // Tested against the values that actually take an element out of flow,
    // rather than against "not none": a missing or unexpected value must not
    // silently reclassify every element in the document.
    const floated = FLOATED.has(style.float);
    const positioned = style.position === "absolute" || style.position === "fixed";
    const outOfFlow = floated || positioned;

    if (outOfFlow && node.rect.height > 0 && !insideAtom) {
      atoms.push({
        kind: "out-of-flow",
        top: node.rect.y,
        bottom: node.rect.y + node.rect.height,
      });
      for (const child of node.children) visit(child, true);
      return;
    }

    // A forced break before this element means the element starts a page.
    if (FORCING.has(style.breakBefore)) forced.push({ y: node.rect.y });
    if (FORCING.has(style.breakAfter)) forced.push({ y: node.rect.y + node.rect.height });

    // Zero-height elements cannot be split and contribute no atom of their own.
    const hasBox = node.rect.height > 0;

    // Inside an existing atom, a nested one adds nothing: every break it would
    // forbid is already forbidden by the span enclosing it.
    const replaced = hasBox && !insideAtom && isReplaced(node);
    const avoid = hasBox && !insideAtom && style.breakInside === "avoid";

    if (replaced || avoid) {
      atoms.push({
        kind: replaced ? "replaced" : "avoid",
        top: node.rect.y,
        bottom: node.rect.y + node.rect.height,
      });
      // Descendants are inside a span that already forbids breaking, so their
      // own atoms would be redundant. Forced breaks inside are still collected:
      // a page break demanded inside an unbreakable box is a contradiction the
      // caller should see resolved in favour of the demand.
      for (const child of node.children) visit(child, true);
      return;
    }

    for (const child of node.children) visit(child, insideAtom);
  };

  visit(root, false);

  atoms.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  forced.sort((a, b) => a.y - b.y);

  // Orphan and widow minimums remove break positions inside paragraphs, which
  // is expressed by joining the lines either side of a forbidden position into
  // one span.
  const blocks = collectLineBlocks(root, defaults);

  return { atoms: applyStranding(atoms, blocks), forced };
}
