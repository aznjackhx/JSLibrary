import { afterEach, describe, expect, it, vi } from "vitest";

import { PdfDocument } from "@pkg/core/pdf";

import { pro, resetWarnings, WATERMARK_TEXT } from "../src/index.js";
import { stampWatermark } from "../src/watermark.js";

/** A document with a couple of pages, standing in for a render. */
function documentWithPages(count = 2): PdfDocument {
  const pdf = new PdfDocument({ xref: "table" });
  for (let index = 0; index < count; index += 1) {
    pdf.addPage({ width: 200, height: 200 });
  }
  return pdf;
}

function contextFor(pdf: PdfDocument): Parameters<
  NonNullable<Awaited<ReturnType<typeof pro>>["finish"]>
>[0] {
  return {
    document: pdf,
    fonts: [],
    metadata: { keywords: [], creationDate: new Date("2024-01-01T00:00:00Z") },
  } as never;
}

afterEach(() => {
  resetWarnings();
  vi.restoreAllMocks();
});

describe("stampWatermark", () => {
  it("marks every page", () => {
    const pdf = documentWithPages(3);
    expect(stampWatermark(pdf)).toBe(3);

    const raw = Buffer.from(pdf.toBytes()).toString("latin1");
    // Three pages, three marks.
    expect(raw.split(WATERMARK_TEXT).length - 1).toBe(3);
  });

  it("uses a standard font rather than embedding one", () => {
    // A watermark that dragged a font subset into the file would change the
    // output it is supposed to be marking.
    const pdf = documentWithPages(1);
    stampWatermark(pdf);

    const raw = Buffer.from(pdf.toBytes()).toString("latin1");
    expect(raw).toContain("/Helvetica");
    expect(raw).not.toContain("/FontFile");
  });

  it("leaves a readable document behind", () => {
    const pdf = documentWithPages(1);
    stampWatermark(pdf);

    const raw = Buffer.from(pdf.toBytes()).toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});

describe("pro()", () => {
  it("watermarks output when no licence is supplied", async () => {
    const extension = await pro();
    const pdf = documentWithPages(2);

    extension.finish?.(contextFor(pdf));

    expect(Buffer.from(pdf.toBytes()).toString("latin1")).toContain(WATERMARK_TEXT);
  });

  it("warns once rather than on every document", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await pro();
    await pro();
    await pro();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("unlicensed");
  });

  it("names the reason in the warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await pro({ license: "obviously-not-a-token" });

    expect(warn.mock.calls[0]?.[0]).toContain("could not be read");
  });

  it("never throws for a bad licence", async () => {
    // The rule from the brief: warn and watermark, never throw, never corrupt.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const bad of ["", "nonsense", "a.b", "x".repeat(5000)]) {
      const extension = await pro({ license: bad });
      const pdf = documentWithPages(1);
      expect(() => extension.finish?.(contextFor(pdf)), bad).not.toThrow();
      expect(pdf.toBytes().length, bad).toBeGreaterThan(0);
    }
  });

  it("produces a valid document even unlicensed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const extension = await pro();
    const pdf = documentWithPages(2);
    extension.finish?.(contextFor(pdf));

    const raw = Buffer.from(pdf.toBytes()).toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toContain("/Type /Catalog");
  });

  it("makes no network request", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error("network access attempted");
    }) as typeof fetch;

    vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const extension = await pro({ license: "anything" });
      extension.finish?.(contextFor(documentWithPages(1)));
    } finally {
      globalThis.fetch = original;
    }

    expect(called).toBe(false);
  });
});
