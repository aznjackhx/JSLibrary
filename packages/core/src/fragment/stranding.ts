/**
 * Orphans and widows.
 *
 * A break inside a paragraph is legal but not always acceptable. Leaving one
 * line behind at the foot of a page (an orphan) or carrying one line over to
 * the next (a widow) is the classic typesetting fault, and CSS lets an author
 * set the minimum for each.
 *
 * The rule is expressed by removing break positions rather than by adding a
 * special case to pagination: a break between two lines of the same paragraph
 * is simply not offered unless enough lines fall on both sides. Pagination then
 * does what it always does, and the paragraph moves whole because no legal
 * break remains inside it.
 *
 * Firefox implements neither property, so `getComputedStyle` reports nothing
 * and capture falls back to the CSS default of 2. Where an author needs
 * different values on that engine, they are supplied through render options —
 * see `StrandingDefaults`.
 */

import type { MeasuredElement, MeasuredNode } from "../measure/types.js";
import type { BreakAtom } from "./atoms.js";

/** Values used where the engine does not expose the CSS properties. */
export interface StrandingDefaults {
  /** Minimum lines left at the foot of a page. CSS default is 2. */
  readonly orphans?: number;
  /** Minimum lines carried to the next page. CSS default is 2. */
  readonly widows?: number;
}

/** A run of lines belonging to one block, in document order. */
export interface LineBlock {
  readonly orphans: number;
  readonly widows: number;
  readonly lines: readonly BreakAtom[];
}

/**
 * Group a measured tree's lines by the block that contains them.
 *
 * Only the nearest block-level ancestor matters: orphans and widows are
 * properties of the paragraph a line sits in, not of the section around it.
 */
export function collectLineBlocks(
  root: MeasuredElement,
  defaults: StrandingDefaults = {},
): LineBlock[] {
  const blocks: LineBlock[] = [];

  const visit = (node: MeasuredNode, owner: MeasuredElement): void => {
    if (node.kind === "text") return;
    for (const child of node.children) {
      if (child.kind === "text") continue;
      visit(child, child);
    }

    const lines: BreakAtom[] = [];
    for (const child of node.children) {
      if (child.kind !== "text") continue;
      for (const line of child.lines) {
        lines.push({ kind: "line", top: line.rect.y, bottom: line.rect.y + line.rect.height });
      }
    }

    if (lines.length > 0) {
      lines.sort((a, b) => a.top - b.top);
      blocks.push({
        orphans: Math.max(1, defaults.orphans ?? owner.style.orphans),
        widows: Math.max(1, defaults.widows ?? owner.style.widows),
        lines,
      });
    }
  };

  visit(root, root);
  blocks.sort((a, b) => (a.lines[0]?.top ?? 0) - (b.lines[0]?.top ?? 0));
  return blocks;
}

/**
 * Positions inside a block where a break would strand lines.
 *
 * A break at the top of line *n* leaves *n* lines above and the rest below, so
 * it is forbidden when either side falls short of its minimum. A block with
 * fewer lines than `orphans + widows` can never be divided acceptably, so every
 * internal position is forbidden and the block moves whole.
 */
export function strandingPositions(block: LineBlock): number[] {
  const { lines, orphans, widows } = block;
  const forbidden: number[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const above = index;
    const below = lines.length - index;
    if (above < orphans || below < widows) {
      forbidden.push((lines[index] as BreakAtom).top);
    }
  }

  return forbidden;
}

/**
 * Merge each block's unbreakable runs into the atom list.
 *
 * Rather than mark individual positions illegal, the lines on either side of a
 * forbidden position are joined into a single span — which is exactly what an
 * atom already means, so pagination needs no new concept.
 */
export function applyStranding(atoms: readonly BreakAtom[], blocks: readonly LineBlock[]): BreakAtom[] {
  const forbidden = new Set<number>();
  for (const block of blocks) {
    for (const position of strandingPositions(block)) forbidden.add(position);
  }

  if (forbidden.size === 0) return [...atoms];

  const sorted = [...atoms].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const merged: BreakAtom[] = [];

  for (const atom of sorted) {
    const previous = merged[merged.length - 1];

    // A forbidden position at this atom's top means it cannot be separated
    // from what precedes it.
    if (previous && forbidden.has(atom.top) && atom.top >= previous.bottom - 0.5) {
      merged[merged.length - 1] = {
        kind: previous.kind,
        top: previous.top,
        bottom: Math.max(previous.bottom, atom.bottom),
      };
      continue;
    }

    merged.push(atom);
  }

  return merged;
}
