import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { splitRgba } from "../src/emit/images.js";
import { boxPath, hasRadius, paintBackground, paintBorders } from "../src/emit/paint.js";
import { buildPreciseRun } from "../src/emit/text.js";
import { PageTransform } from "../src/emit/transform.js";
import { Font } from "../src/fonts/font.js";
import { ContentStream } from "../src/pdf/content.js";
import { pageGeometry } from "../src/page/geometry.js";
import type { CapturedStyle, MeasuredLine } from "../src/measure/types.js";

const FONT_PATH = fileURLToPath(
  new URL("../../../tests/fixtures/fonts/DejaVuSansMono.ttf", import.meta.url),
);

const letter = pageGeometry("Letter", "portrait", "0.5in");
const transform = new PageTransform({ content: letter.content });

const opaque = { r: 10, g: 20, b: 30, a: 1 };
const clear = { r: 0, g: 0, b: 0, a: 0 };

function styleWith(overrides: Partial<CapturedStyle>): CapturedStyle {
  return {
    backgroundColor: clear,
    borderRadius: [0, 0, 0, 0],
    borderTop: { width: 0, style: "none", color: clear },
    borderRight: { width: 0, style: "none", color: clear },
    borderBottom: { width: 0, style: "none", color: clear },
    borderLeft: { width: 0, style: "none", color: clear },
    ...overrides,
  } as CapturedStyle;
}

const render = (build: (stream: ContentStream) => void): string => {
  const stream = new ContentStream();
  build(stream);
  return Buffer.from(stream.toBytes()).toString("latin1");
};

describe("backgrounds", () => {
  const rect = { x: 10, y: 10, width: 100, height: 50 };

  it("fills with the background colour", () => {
    const output = render((stream) =>
      paintBackground(stream, rect, styleWith({ backgroundColor: opaque }), transform),
    );

    expect(output).toContain("re");
    expect(output).toContain("f");
    // Components are written as 0–1 fractions.
    expect(output).toContain(`${(10 / 255).toFixed(4)}`.replace(/0+$/, ""));
  });

  it("paints nothing when the background is transparent", () => {
    expect(render((stream) => paintBackground(stream, rect, styleWith({}), transform))).toBe("");
  });

  it("paints nothing for a degenerate box", () => {
    const output = render((stream) =>
      paintBackground(
        stream,
        { x: 0, y: 0, width: 0, height: 10 },
        styleWith({ backgroundColor: opaque }),
        transform,
      ),
    );
    expect(output).toBe("");
  });

  it("uses curves when a radius is set", () => {
    const output = render((stream) =>
      paintBackground(
        stream,
        rect,
        styleWith({ backgroundColor: opaque, borderRadius: [8, 8, 8, 8] }),
        transform,
      ),
    );

    expect(output).toContain("c\n");
    expect(output).not.toContain("re\n");
  });
});

describe("rounded rectangles", () => {
  it("closes the path", () => {
    const output = render((stream) =>
      boxPath(stream, { x: 0, y: 0, width: 100, height: 60 }, [10, 10, 10, 10]),
    );
    expect(output.trimEnd().endsWith("h")).toBe(true);
  });

  it("scales overlapping radii down together, as CSS does", () => {
    // Radii of 80 on a 100-wide box would cross; both shrink to fit.
    const output = render((stream) =>
      boxPath(stream, { x: 0, y: 0, width: 100, height: 100 }, [80, 80, 80, 80]),
    );

    // No coordinate may fall outside the box.
    for (const value of output.match(/-?\d+\.?\d*/g) ?? []) {
      const number = Number(value);
      expect(number).toBeGreaterThanOrEqual(-0.01);
      expect(number).toBeLessThanOrEqual(100.01);
    }
  });

  it("detects whether any corner is rounded", () => {
    expect(hasRadius([0, 0, 0, 0])).toBe(false);
    expect(hasRadius([0, 0, 1, 0])).toBe(true);
  });
});

describe("borders", () => {
  const rect = { x: 0, y: 0, width: 100, height: 60 };

  it("paints nothing when every side is zero width", () => {
    expect(render((stream) => paintBorders(stream, rect, styleWith({}), transform))).toBe("");
  });

  it("paints nothing when the border colour is transparent", () => {
    const style = styleWith({ borderTop: { width: 4, style: "solid", color: clear } });
    expect(render((stream) => paintBorders(stream, rect, style, transform))).toBe("");
  });

  it("fills each side as its own quad so corners mitre", () => {
    const style = styleWith({
      borderTop: { width: 4, style: "solid", color: opaque },
      borderBottom: { width: 2, style: "solid", color: opaque },
      borderLeft: { width: 1, style: "solid", color: opaque },
      borderRight: { width: 3, style: "solid", color: opaque },
    });

    const output = render((stream) => paintBorders(stream, rect, style, transform));
    // Four filled quads, each closed.
    expect(output.match(/h\nf/g)).toHaveLength(4);
  });

  it("strokes a uniform rounded border rather than mitring it by hand", () => {
    const side = { width: 4, style: "solid", color: opaque };
    const style = styleWith({
      borderTop: side,
      borderRight: side,
      borderBottom: side,
      borderLeft: side,
      borderRadius: [8, 8, 8, 8],
    });

    const output = render((stream) => paintBorders(stream, rect, style, transform));
    expect(output).toContain("S\n");
    expect(output).toContain("w\n");
  });
});

describe("precise text runs", () => {
  let font: Font;

  beforeAll(() => {
    font = Font.parse(new Uint8Array(readFileSync(FONT_PATH)));
  });

  function lineOf(text: string, advance: number): MeasuredLine {
    return {
      text,
      rect: { x: 0, y: 0, width: advance * text.length, height: 16 },
      baseline: 12,
      clusters: [...text].map((character, index) => ({
        text: character,
        x: index * advance,
        width: advance,
      })),
    };
  }

  const options = (subset: ReturnType<Font["createSubset"]>) => ({
    subset,
    resourceName: "F1",
    fontSize: 12,
    color: opaque,
    transform,
    precise: true,
  });

  it("emits no adjustments when the font's own advances already match", () => {
    const subset = font.createSubset();
    // DejaVu Sans Mono advances 1233/2048 em; at 12pt that is this many points,
    // which is what the browser would have measured for a monospaced run.
    const advancePt = (1233 / 2048) * 12;
    const advancePx = advancePt / 0.75;

    const items = buildPreciseRun(lineOf("abc", advancePx), options(subset));

    // One string, no numeric corrections.
    expect(items.filter((item) => typeof item === "number")).toHaveLength(0);
    expect(items).toHaveLength(1);
  });

  it("inserts a correction when the browser placed a glyph elsewhere", () => {
    const subset = font.createSubset();
    // Deliberately wider than the font's own advance: letter-spacing would do
    // this, and the font has no idea about it.
    const items = buildPreciseRun(lineOf("abc", 20), options(subset));

    const adjustments = items.filter((item): item is number => typeof item === "number");
    expect(adjustments.length).toBeGreaterThan(0);
    // Moving the pen right means a negative TJ number.
    expect(adjustments.every((value) => value < 0)).toBe(true);
  });

  it("returns nothing for a line with no clusters", () => {
    const subset = font.createSubset();
    const line: MeasuredLine = {
      text: "",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      baseline: 0,
      clusters: [],
    };
    expect(buildPreciseRun(line, options(subset))).toEqual([]);
  });
});

describe("image channels", () => {
  it("splits RGBA into colour and alpha", () => {
    const rgba = new Uint8Array([1, 2, 3, 128, 4, 5, 6, 255]);
    const { rgb, alpha } = splitRgba(rgba, 2);

    expect([...rgb]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...(alpha as Uint8Array)]).toEqual([128, 255]);
  });

  it("omits the mask when every pixel is opaque", () => {
    const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    const { rgb, alpha } = splitRgba(rgba, 2);

    expect([...rgb]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(alpha).toBeUndefined();
  });
});
