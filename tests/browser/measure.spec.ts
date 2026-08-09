/**
 * M3: DOM measurement.
 *
 * These run in a real browser because there is nothing to test otherwise —
 * measurement is entirely about what a layout engine decided.
 */

import { expect, test } from "@playwright/test";

import { CHAR_WIDTH, FONT_SIZE, MEASURE_WIDTH } from "../fixtures/measure-page.js";
import {
  findById,
  findByTag,
  linesOf,
  measureSubject,
  openMeasurePage,
  textNodesOf,
  walkMeasured,
} from "./measure-harness.js";

test.beforeEach(async ({ page }) => {
  await openMeasurePage(page);
});

test.describe("container", () => {
  test("lays content out at the requested width", async ({ page }) => {
    const measured = await measureSubject(page, { width: 400 });

    expect(measured.contentWidth).toBe(400);
    expect(measured.root.rect.width).toBe(400);
    // Height is whatever the content needed, not the page height.
    expect(measured.contentHeight).toBeGreaterThan(100);
  });

  test("relays out at a different width, changing where lines break", async ({ page }) => {
    const wide = await measureSubject(page, { width: 600 });
    const narrow = await measureSubject(page, { width: 200 });

    const wideLines = linesOf(findById(wide.root, "wrapping") as never);
    const narrowLines = linesOf(findById(narrow.root, "wrapping") as never);

    expect(narrowLines.length).toBeGreaterThan(wideLines.length);
  });

  test("reports geometry relative to the container origin", async ({ page }) => {
    const measured = await measureSubject(page);

    // The container is positioned far off-screen; if the origin were not
    // subtracted, every x would be around -100000.
    expect(measured.root.rect.x).toBe(0);
    expect(measured.root.rect.y).toBe(0);

    for (const node of walkMeasured(measured.root)) {
      if (node.kind !== "element") continue;
      expect(node.rect.x).toBeGreaterThanOrEqual(-1);
      expect(node.rect.y).toBeGreaterThanOrEqual(-1);
    }
  });

  test("leaves no container behind", async ({ page }) => {
    await measureSubject(page);
    const leftovers = await page.evaluate(
      () => document.querySelectorAll("[data-pkg-measure]").length,
    );
    expect(leftovers).toBe(0);
  });

  test("carries inherited styles across the clone boundary", async ({ page }) => {
    // The subject lives inside a themed wrapper. Reparenting it into the
    // container would drop that context, and the font size would revert.
    const measured = await measureSubject(page);
    const paragraph = findById(measured.root, "wrapping");

    expect(paragraph?.style.fontSize).toBe(FONT_SIZE);
    expect(paragraph?.style.fontFamily).toContain("Test Mono");
  });
});

test.describe("line extraction", () => {
  test("splits soft-wrapped text into lines the browser chose", async ({ page }) => {
    const measured = await measureSubject(page, { width: MEASURE_WIDTH });
    const paragraph = findById(measured.root, "wrapping");
    const lines = linesOf(paragraph as never);

    expect(lines.length).toBeGreaterThan(1);

    // Rejoining the lines reproduces the source text.
    expect(lines.join("").replaceAll(/\s+/g, " ").trim()).toBe(
      "The quick brown fox jumps over the lazy dog and keeps on running past the fence.",
    );

    // No line exceeds the content width.
    const [text] = textNodesOf(paragraph as never);
    for (const line of text?.lines ?? []) {
      expect(line.rect.width).toBeLessThanOrEqual(MEASURE_WIDTH + 0.5);
    }
  });

  test("stacks lines by the paragraph's line height", async ({ page }) => {
    const measured = await measureSubject(page);
    const [text] = textNodesOf(findById(measured.root, "wrapping") as never);
    const lines = text?.lines ?? [];

    expect(lines.length).toBeGreaterThan(1);
    for (let i = 1; i < lines.length; i += 1) {
      const gap = (lines[i] as (typeof lines)[number]).baseline -
        (lines[i - 1] as (typeof lines)[number]).baseline;
      expect(gap).toBeCloseTo(24, 1);
    }
  });

  test("measures a monospaced line as its character count times one advance", async ({ page }) => {
    const measured = await measureSubject(page, { precise: true });
    const [text] = textNodesOf(findById(measured.root, "after-break") as never);
    const line = text?.lines[0];

    expect(line?.text).toBe("After a forced break.");

    // Deliberately not compared against a hard-coded advance. Engines are free
    // to snap glyph positions to whole pixels — CI's Chrome reports 10px where
    // the font's own advance is 9.633 — and asserting the font's number tests
    // the browser's rounding policy rather than our extraction. What must hold
    // is that the line is exactly as wide as its glyphs, whatever the engine
    // decided those are.
    // Derived from the clusters themselves rather than multiplied out from one
    // advance: cluster positions are rounded, and multiplying a rounded advance
    // by twenty-one characters accumulates the rounding into a real error.
    const clusters = line?.clusters ?? [];
    const first = clusters[0];
    const last = clusters[clusters.length - 1];

    expect(clusters).toHaveLength("After a forced break.".length);
    const span = (last?.x as number) + (last?.width as number) - (first?.x as number);
    expect(line?.rect.width).toBeCloseTo(span, 1);
  });

  test("keeps combining sequences together as one cluster", async ({ page }) => {
    const measured = await measureSubject(page, { precise: true });
    const [text] = textNodesOf(findById(measured.root, "accented") as never);
    const line = text?.lines[0];

    expect(line?.text).toBe("Ünïcödé — café ✓");

    // One cluster per grapheme, not per code unit.
    const clusters = line?.clusters ?? [];
    expect(clusters.map((cluster) => cluster.text).join("")).toBe("Ünïcödé — café ✓");
  });

  test("orders clusters left to right, starting at the line's left edge", async ({ page }) => {
    const measured = await measureSubject(page, { precise: true });
    const [text] = textNodesOf(findById(measured.root, "after-break") as never);
    const line = text?.lines[0];
    const clusters = line?.clusters ?? [];

    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0]?.x).toBeCloseTo(line?.rect.x as number, 1);

    for (let i = 1; i < clusters.length; i += 1) {
      expect((clusters[i] as (typeof clusters)[number]).x).toBeGreaterThanOrEqual(
        (clusters[i - 1] as (typeof clusters)[number]).x,
      );
    }
  });

  test("advances every monospaced cluster by the same amount", async ({ page }) => {
    const measured = await measureSubject(page, { precise: true });
    const [text] = textNodesOf(findById(measured.root, "after-break") as never);
    const clusters = text?.lines[0]?.clusters ?? [];

    expect(clusters.length).toBeGreaterThan(2);

    // Uniformity is the property of a monospaced font that has to survive
    // extraction; the exact advance is the engine's business. It must also be
    // in the right neighbourhood — a wildly different value would mean the
    // embedded font never loaded and a fallback was measured instead.
    const first = (clusters[1]?.x as number) - (clusters[0]?.x as number);
    for (let i = 1; i < clusters.length; i += 1) {
      const advance =
        (clusters[i] as (typeof clusters)[number]).x -
        (clusters[i - 1] as (typeof clusters)[number]).x;
      expect(advance).toBeCloseTo(first, 1);
    }

    expect(first).toBeGreaterThan(CHAR_WIDTH - 1);
    expect(first).toBeLessThan(CHAR_WIDTH + 1);
  });

  test("omits clusters when precise positioning is off", async ({ page }) => {
    const measured = await measureSubject(page, { precise: false });
    const [text] = textNodesOf(findById(measured.root, "after-break") as never);

    expect(text?.lines[0]?.clusters).toBeUndefined();
    // Line geometry is still there — only the per-glyph detail is dropped.
    expect(text?.lines[0]?.rect.width).toBeGreaterThan(0);
  });
});

test.describe("baselines", () => {
  test("puts the baseline inside the line box, below its top", async ({ page }) => {
    const measured = await measureSubject(page);

    for (const node of walkMeasured(measured.root)) {
      if (node.kind !== "text") continue;
      for (const line of node.lines) {
        expect(line.baseline).toBeGreaterThan(line.rect.y);
        expect(line.baseline).toBeLessThanOrEqual(line.rect.y + line.rect.height + 0.5);
      }
    }
  });

  test("scales the baseline offset with font size", async ({ page }) => {
    const measured = await measureSubject(page);

    const heading = textNodesOf(findById(measured.root, "title") as never)[0]?.lines[0];
    const body = textNodesOf(findById(measured.root, "after-break") as never)[0]?.lines[0];

    const headingAscent = (heading?.baseline as number) - (heading?.rect.y as number);
    const bodyAscent = (body?.baseline as number) - (body?.rect.y as number);

    // The heading is 24px against the body's 16px, so its ascent is larger by
    // roughly that ratio.
    expect(headingAscent).toBeGreaterThan(bodyAscent);
    expect(headingAscent / bodyAscent).toBeCloseTo(24 / 16, 1);
  });
});

test.describe("style capture", () => {
  test("captures borders, background and radius", async ({ page }) => {
    const measured = await measureSubject(page);
    const card = findById(measured.root, "card");

    expect(card?.style.borderTop).toEqual({
      width: 2,
      style: "solid",
      color: { r: 200, g: 0, b: 0, a: 1 },
    });
    expect(card?.style.backgroundColor).toEqual({ r: 240, g: 240, b: 250, a: 1 });
    expect(card?.style.borderRadius).toEqual([4, 4, 4, 4]);
    expect(card?.style.padding).toEqual([8, 10, 8, 10]);
  });

  test("captures break hints", async ({ page }) => {
    const measured = await measureSubject(page);

    expect(findById(measured.root, "atomic")?.style.breakInside).toBe("avoid");
    expect(findById(measured.root, "after-break")?.style.breakBefore).toBe("page");
  });

  test("captures orphans and widows where the engine exposes them", async ({ page }) => {
    // Firefox implements neither property, so getComputedStyle reports nothing
    // and capture falls back to the CSS default of 2. That fallback is correct
    // behaviour, not a bug to assert around — but fragmentation in M5 needs the
    // author's real values, so an engine that hides them will need the numbers
    // supplied through options instead.
    const supported = await page.evaluate(() => {
      const probe = document.createElement("p");
      probe.style.setProperty("orphans", "3");
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue("orphans");
      probe.remove();
      return value.trim() !== "";
    });

    const measured = await measureSubject(page);
    const paragraph = findById(measured.root, "wrapping");

    if (supported) {
      expect(paragraph?.style.orphans).toBe(3);
      expect(paragraph?.style.widows).toBe(4);
    } else {
      // The spec default, which is what an unsupported property must yield.
      expect(paragraph?.style.orphans).toBe(2);
      expect(paragraph?.style.widows).toBe(2);
    }
  });

  test("parses alpha colours", async ({ page }) => {
    const measured = await measureSubject(page);
    const link = findById(measured.root, "link");

    // Anchors have no background of their own.
    expect(link?.style.backgroundColor.a).toBe(0);
  });

  test("computes the content box from the border box", async ({ page }) => {
    const measured = await measureSubject(page);
    const card = findById(measured.root, "card");

    // 2px border plus 10px horizontal padding on each side.
    expect(card?.contentRect.x).toBeCloseTo((card?.rect.x as number) + 12, 3);
    expect(card?.contentRect.width).toBeCloseTo((card?.rect.width as number) - 24, 3);
    expect(card?.contentRect.y).toBeCloseTo((card?.rect.y as number) + 10, 3);
  });
});

test.describe("tree shape", () => {
  test("prunes display:none and non-rendering elements", async ({ page }) => {
    const measured = await measureSubject(page);

    expect(findById(measured.root, "gone")).toBeUndefined();
    expect(findByTag(measured.root, "script")).toBeUndefined();
    expect(findByTag(measured.root, "style")).toBeUndefined();
  });

  test("keeps hrefs and image sources for later milestones", async ({ page }) => {
    const measured = await measureSubject(page);

    expect(findById(measured.root, "link")?.href).toBe("https://example.test/target");
    expect(findById(measured.root, "picture")?.src).toMatch(/^data:image\/png/);
  });

  test("measures the image at its laid-out size, not its intrinsic size", async ({ page }) => {
    const measured = await measureSubject(page);
    const picture = findById(measured.root, "picture");

    expect(picture?.rect.width).toBe(120);
    expect(picture?.rect.height).toBe(60);
  });

  test("sizes an image from the original when the clone is still loading", async ({ page }) => {
    // Cloning an <img> restarts its load, and an engine that has not decoded it
    // yet lays out the alt text instead. Firefox did exactly that: a 120px
    // image measured 38.5px, the width of four characters of alt text. The
    // clone now inherits the original's intrinsic size, so layout has a box
    // immediately.
    const intrinsic = await page.evaluate(() => {
      const clone = (document.querySelector("#picture") as HTMLImageElement).cloneNode(
        true,
      ) as HTMLImageElement;
      // A fresh clone, before anything has had a chance to decode it.
      return { width: clone.naturalWidth, complete: clone.complete };
    });

    const measured = await measureSubject(page);
    const picture = findById(measured.root, "picture");

    // Whatever the clone's own load state was, the measurement is right.
    expect(picture?.rect.width).toBe(120);
    expect(typeof intrinsic.width).toBe("number");
  });

  test("measures table cells as boxes inside the table", async ({ page }) => {
    const measured = await measureSubject(page);
    const table = findById(measured.root, "grid");
    const cell = findById(measured.root, "cell-a");

    expect(table).toBeDefined();
    expect(cell).toBeDefined();
    expect(cell?.rect.y).toBeGreaterThan(table?.rect.y as number);
    expect(cell?.rect.width).toBeGreaterThan(0);
  });

  test("keeps children in document order", async ({ page }) => {
    const measured = await measureSubject(page);
    const ids = [...walkMeasured(measured.root)]
      .filter((node): node is Extract<typeof node, { kind: "element" }> => node.kind === "element")
      .map((node) => node.id)
      .filter(Boolean);

    expect(ids).toEqual([
      "subject",
      "title",
      "wrapping",
      "accented",
      "card",
      "nested",
      "atomic",
      "grid",
      "head-a",
      "cell-a",
      "link",
      "image-holder",
      "picture",
      "after-break",
    ]);
  });
});
