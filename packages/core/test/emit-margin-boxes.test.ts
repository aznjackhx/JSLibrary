import { describe, expect, it } from "vitest";

import { marginBoxRects, marginBoxStyle } from "../src/emit/margin-boxes.js";
import { MARGIN_BOX_NAMES } from "../src/page/atrules.js";
import type { PageContext } from "../src/page/context.js";

const page: PageContext = {
  size: { width: 612, height: 792 },
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  content: { x: 72, y: 72, width: 468, height: 648 },
  marginBoxes: new Map(),
};

describe("marginBoxRects", () => {
  const rects = marginBoxRects(page);

  it("provides all sixteen boxes", () => {
    expect(rects.size).toBe(16);
    for (const name of MARGIN_BOX_NAMES) expect(rects.has(name), name).toBe(true);
  });

  it("puts the corners in the margins they belong to", () => {
    expect(rects.get("top-left-corner")).toEqual({ x: 0, y: 720, width: 72, height: 72 });
    expect(rects.get("bottom-right-corner")).toEqual({ x: 540, y: 0, width: 72, height: 72 });
  });

  it("divides the top edge into equal thirds", () => {
    const left = rects.get("top-left");
    const centre = rects.get("top-center");
    const right = rects.get("top-right");

    expect(left?.width).toBe(156);
    expect(centre?.x).toBe(72 + 156);
    expect(right?.x).toBe(72 + 312);
    expect((right?.x as number) + (right?.width as number)).toBe(540);
  });

  it("keeps every box outside the content area", () => {
    for (const [name, rect] of rects) {
      const horizontallyClear =
        rect.x + rect.width <= page.content.x + 0.001 ||
        rect.x >= page.content.x + page.content.width - 0.001;
      const verticallyClear =
        rect.y + rect.height <= page.content.y + 0.001 ||
        rect.y >= page.content.y + page.content.height - 0.001;

      expect(horizontallyClear || verticallyClear, `${name} overlaps the content box`).toBe(true);
    }
  });

  it("does not overlap boxes on the same edge", () => {
    const edge = ["top-left", "top-center", "top-right"] as const;
    for (let i = 1; i < edge.length; i += 1) {
      const previous = rects.get(edge[i - 1] as (typeof edge)[number]);
      const current = rects.get(edge[i] as (typeof edge)[number]);
      expect(current?.x).toBeGreaterThanOrEqual(
        (previous?.x as number) + (previous?.width as number) - 0.001,
      );
    }
  });

  it("stacks the side boxes from the top down", () => {
    const top = rects.get("left-top");
    const middle = rects.get("left-middle");
    const bottom = rects.get("left-bottom");

    expect(top?.y).toBeGreaterThan(middle?.y as number);
    expect(middle?.y).toBeGreaterThan(bottom?.y as number);
  });
});

describe("marginBoxStyle", () => {
  it("takes its alignment from the box's position by default", () => {
    expect(marginBoxStyle("top-left", new Map()).align).toBe("left");
    expect(marginBoxStyle("top-center", new Map()).align).toBe("center");
    expect(marginBoxStyle("bottom-right", new Map()).align).toBe("right");
  });

  it("lets text-align override the default", () => {
    expect(marginBoxStyle("top-left", new Map([["text-align", "right"]])).align).toBe("right");
  });

  it("reads the font size in any CSS unit", () => {
    expect(marginBoxStyle("top-center", new Map([["font-size", "12pt"]])).fontSize).toBe(12);
    expect(marginBoxStyle("top-center", new Map([["font-size", "16px"]])).fontSize).toBe(12);
  });

  it("parses colour keywords and hex, which are not computed values here", () => {
    expect(marginBoxStyle("top-center", new Map([["color", "red"]])).color).toEqual({
      r: 255, g: 0, b: 0, a: 1,
    });
    expect(marginBoxStyle("top-center", new Map([["color", "#336699"]])).color).toEqual({
      r: 51, g: 102, b: 153, a: 1,
    });
    expect(marginBoxStyle("top-center", new Map([["color", "#f00"]])).color).toEqual({
      r: 255, g: 0, b: 0, a: 1,
    });
  });

  it("defaults to black at a readable size", () => {
    const style = marginBoxStyle("top-center", new Map());
    expect(style.color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(style.fontSize).toBeGreaterThan(0);
  });

  it("reads font-weight in either form", () => {
    expect(marginBoxStyle("top-center", new Map([["font-weight", "bold"]])).fontWeight).toBe(700);
    expect(marginBoxStyle("top-center", new Map([["font-weight", "600"]])).fontWeight).toBe(600);
  });
});
