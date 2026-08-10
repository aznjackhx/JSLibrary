import { describe, expect, it } from "vitest";

import { PageTransform } from "../src/emit/transform.js";
import { pageGeometry } from "../src/page/geometry.js";

const letter = pageGeometry("Letter", "portrait", "0.5in");

describe("PageTransform", () => {
  const transform = new PageTransform({ content: letter.content });

  it("converts x by unit only, offset by the left margin", () => {
    // 0.5in margin = 36pt; 96 CSS px = 72pt.
    expect(transform.x(0)).toBe(36);
    expect(transform.x(96)).toBe(108);
  });

  it("flips y: the top of the content is the highest point on the page", () => {
    const { content } = letter;
    expect(transform.y(0)).toBe(content.y + content.height);
    expect(transform.y(96)).toBe(content.y + content.height - 72);
  });

  it("leaves lengths unflipped", () => {
    expect(transform.length(96)).toBe(72);
    expect(transform.length(0)).toBe(0);
  });

  it("anchors rects at their lower-left corner", () => {
    const rect = transform.rect({ x: 0, y: 0, width: 96, height: 96 });

    expect(rect.x).toBe(36);
    expect(rect.width).toBe(72);
    expect(rect.height).toBe(72);
    // A box at the very top of the content ends 72pt below the content's top.
    expect(rect.y).toBe(letter.content.y + letter.content.height - 72);
  });

  it("keeps a box inside the content area", () => {
    const rect = transform.rect({ x: 0, y: 0, width: 720, height: 960 });

    expect(rect.x).toBeCloseTo(letter.content.x, 3);
    expect(rect.y).toBeCloseTo(letter.content.y, 3);
    expect(rect.width).toBeCloseTo(letter.content.width, 3);
    expect(rect.height).toBeCloseTo(letter.content.height, 3);
  });

  it("offsets by scrollY, which is how a later page starts partway down", () => {
    const second = new PageTransform({ content: letter.content, scrollY: 96 });

    // Content at y=96 sits at the top of the second page.
    expect(second.y(96)).toBe(letter.content.y + letter.content.height);
  });

  it("reports which content falls on a page", () => {
    const second = new PageTransform({ content: letter.content, scrollY: 100 });

    expect(second.intersects({ x: 0, y: 150, width: 10, height: 10 }, 200)).toBe(true);
    // Entirely above this page.
    expect(second.intersects({ x: 0, y: 0, width: 10, height: 10 }, 200)).toBe(false);
    // Entirely below.
    expect(second.intersects({ x: 0, y: 400, width: 10, height: 10 }, 200)).toBe(false);
    // Straddling the top edge still counts.
    expect(second.intersects({ x: 0, y: 95, width: 10, height: 20 }, 200)).toBe(true);
  });
});
