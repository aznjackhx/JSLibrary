import { describe, expect, it } from "vitest";

import type { BreakAtom } from "../src/fragment/atoms.js";
import {
  applyStranding,
  strandingPositions,
  type LineBlock,
} from "../src/fragment/stranding.js";

const block = (lineCount: number, orphans: number, widows: number, from = 0): LineBlock => ({
  orphans,
  widows,
  lines: Array.from({ length: lineCount }, (_, index) => ({
    kind: "line" as const,
    top: from + index * 20,
    bottom: from + index * 20 + 20,
  })),
});

describe("strandingPositions", () => {
  it("forbids nothing when every split satisfies both minimums", () => {
    // Six lines, 2 and 2: splits after lines 2,3,4 are all fine.
    expect(strandingPositions(block(6, 2, 2))).toEqual([20, 100]);
  });

  it("forbids leaving fewer than `orphans` lines behind", () => {
    // Splitting after line 1 leaves one orphan.
    expect(strandingPositions(block(6, 3, 1))).toContain(20);
    expect(strandingPositions(block(6, 3, 1))).toContain(40);
  });

  it("forbids carrying fewer than `widows` lines over", () => {
    const positions = strandingPositions(block(6, 1, 3));
    // Splitting before the last line carries one widow.
    expect(positions).toContain(100);
    expect(positions).toContain(80);
  });

  it("forbids every split in a block too short to divide acceptably", () => {
    // Three lines needing 2 and 2 can never be split.
    expect(strandingPositions(block(3, 2, 2))).toEqual([20, 40]);
  });

  it("has nothing to forbid in a single-line block", () => {
    expect(strandingPositions(block(1, 2, 2))).toEqual([]);
  });

  it("treats a minimum of 1 as no constraint", () => {
    expect(strandingPositions(block(6, 1, 1))).toEqual([]);
  });
});

describe("applyStranding", () => {
  const lines = (count: number, from = 0): BreakAtom[] =>
    Array.from({ length: count }, (_, index) => ({
      kind: "line" as const,
      top: from + index * 20,
      bottom: from + index * 20 + 20,
    }));

  it("leaves atoms untouched when nothing is forbidden", () => {
    const atoms = lines(4);
    expect(applyStranding(atoms, [block(4, 1, 1)])).toEqual(atoms);
  });

  it("joins the lines either side of a forbidden position", () => {
    // A three-line block needing 2 and 2 cannot be split at all, so its lines
    // become one span.
    const merged = applyStranding(lines(3), [block(3, 2, 2)]);
    expect(merged).toEqual([{ kind: "line", top: 0, bottom: 60 }]);
  });

  it("keeps blocks separate from one another", () => {
    // Two three-line blocks, each unbreakable, but a break between them is
    // still legal.
    const atoms = [...lines(3), ...lines(3, 100)];
    const merged = applyStranding(atoms, [block(3, 2, 2), block(3, 2, 2, 100)]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ kind: "line", top: 0, bottom: 60 });
    expect(merged[1]).toEqual({ kind: "line", top: 100, bottom: 160 });
  });

  it("merges only the forbidden joins, leaving legal ones open", () => {
    // Six lines, orphans 3, widows 1: splits after lines 1 and 2 are illegal,
    // so lines 1-3 join, and the rest stay separate.
    const merged = applyStranding(lines(6), [block(6, 3, 1)]);

    expect(merged[0]).toEqual({ kind: "line", top: 0, bottom: 60 });
    expect(merged.length).toBeGreaterThan(1);
  });

  it("never loses vertical coverage", () => {
    const atoms = lines(6);
    const merged = applyStranding(atoms, [block(6, 3, 2)]);

    expect(merged[0]?.top).toBe(atoms[0]?.top);
    expect(merged[merged.length - 1]?.bottom).toBe(atoms[atoms.length - 1]?.bottom);
  });
});
