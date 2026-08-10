import { describe, expect, it } from "vitest";

import { PdfDocument } from "../src/pdf/document.js";
import { dict, name, ref } from "../src/pdf/objects.js";
import { ResourceRegistry } from "../src/pdf/resources.js";

const FIXED_DATE = new Date("2024-01-01T00:00:00Z");

function buildDocument(
  options: ConstructorParameters<typeof PdfDocument>[0] = {},
): PdfDocument {
  const document = new PdfDocument({ info: { creationDate: FIXED_DATE }, ...options });
  const page = document.addPage({ width: 612, height: 792 });
  page.content.scoped((s) => s.setFillRgb(0, 0, 1).rect(100, 500, 400, 200).fill());
  return document;
}

const asLatin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

describe("document structure", () => {
  it("writes a header, a body and a terminated trailer", () => {
    const output = asLatin1(buildDocument().toBytes());
    expect(output.startsWith("%PDF-1.7\n")).toBe(true);
    expect(output).toContain("startxref\n");
    expect(output.endsWith("%%EOF\n")).toBe(true);
    // The catalog is inside an object stream by default, so it is not visible
    // in the raw bytes; the uncompressed variant is asserted below.
    expect(asLatin1(buildDocument({ xref: "table" }).toBytes())).toContain("/Type /Catalog");
  });

  it("marks the file binary so tools do not treat it as text", () => {
    const bytes = buildDocument().toBytes();
    // Second line is a comment containing bytes above 127.
    expect([...bytes.subarray(9, 15)]).toEqual([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  });

  it("points startxref at the cross-reference and %%EOF closes the file", () => {
    const output = asLatin1(buildDocument({ xref: "table" }).toBytes());
    const match = /startxref\n(\d+)\n%%EOF\n$/.exec(output);
    expect(match).not.toBeNull();

    const offset = Number((match as RegExpExecArray)[1]);
    expect(output.slice(offset, offset + 4)).toBe("xref");
  });

  it("requires at least one page", () => {
    const empty = new PdfDocument();
    expect(() => empty.toBytes()).toThrow(/at least one page/);
  });

  it("rejects a non-positive page size", () => {
    const document = new PdfDocument();
    expect(() => document.addPage({ width: 0, height: 100 })).toThrow(RangeError);
  });

  it("caches output so a second call cannot renumber objects", () => {
    const document = buildDocument();
    const first = document.toBytes();
    const second = document.toBytes();
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});

describe("cross-reference styles", () => {
  it("writes a classic table with 20-byte entries", () => {
    const output = asLatin1(buildDocument({ xref: "table" }).toBytes());
    const start = output.indexOf("xref\n");
    const body = output.slice(start);

    expect(body).toMatch(/^xref\n0 \d+\n0000000000 65535 f \n/);

    const entries = body.split("\n").slice(2);
    for (const entry of entries) {
      if (!/^\d{10} \d{5} [nf] $/.test(entry)) break;
      // 18 characters plus the newline the split consumed, plus the trailing
      // space, is the 20 bytes the format requires.
      expect(entry.length + 1).toBe(20);
    }
  });

  it("declares PDF 1.4 for a classic table and 1.7 for a stream", () => {
    expect(asLatin1(buildDocument({ xref: "table" }).toBytes())).toMatch(/^%PDF-1\.4\n/);
    expect(asLatin1(buildDocument({ xref: "stream" }).toBytes())).toMatch(/^%PDF-1\.7\n/);
  });

  it("writes a cross-reference stream with the expected field widths", () => {
    const output = asLatin1(buildDocument({ xref: "stream" }).toBytes());
    expect(output).toContain("/Type /XRef");
    expect(output).toContain("/W [1 4 2]");
    expect(output).not.toContain("\ntrailer\n");
  });

  it("refuses a cross-reference stream on a version that predates it", () => {
    expect(() => new PdfDocument({ xref: "stream", version: "1.4" })).toThrow(RangeError);
  });

  it("packs objects into an object stream, and leaves stream objects direct", () => {
    const output = asLatin1(buildDocument({ xref: "stream", objectStreams: true }).toBytes());
    expect(output).toContain("/Type /ObjStm");
    // The catalog moved inside the object stream, so it is no longer visible
    // in the uncompressed byte stream.
    expect(output).not.toContain("/Type /Catalog");
  });

  it("keeps objects direct when object streams are off", () => {
    const output = asLatin1(buildDocument({ xref: "stream", objectStreams: false }).toBytes());
    expect(output).not.toContain("/Type /ObjStm");
    expect(output).toContain("/Type /Catalog");
  });

  it("disables object streams automatically for a classic table", () => {
    // A classic table has no way to reference an object inside a stream.
    const output = asLatin1(
      buildDocument({ xref: "table", objectStreams: true }).toBytes(),
    );
    expect(output).not.toContain("/Type /ObjStm");
  });
});

describe("determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const first = buildDocument().toBytes();
    const second = buildDocument().toBytes();
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("produces byte-identical output in both cross-reference styles", () => {
    for (const xref of ["table", "stream"] as const) {
      const first = buildDocument({ xref }).toBytes();
      const second = buildDocument({ xref }).toBytes();
      expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    }
  });

  it("derives the file identifier from content, not from a clock", () => {
    const output = asLatin1(buildDocument({ xref: "table" }).toBytes());
    const id = /\/ID \[<([0-9A-F]{32})> <([0-9A-F]{32})>\]/.exec(output);
    expect(id).not.toBeNull();
    expect((id as RegExpExecArray)[1]).toBe((id as RegExpExecArray)[2]);
  });

  it("changes the identifier when the content changes", () => {
    const a = asLatin1(buildDocument({ xref: "table" }).toBytes());

    const other = new PdfDocument({ xref: "table", info: { creationDate: FIXED_DATE } });
    const page = other.addPage({ width: 612, height: 792 });
    page.content.scoped((s) => s.setFillRgb(1, 0, 0).rect(0, 0, 10, 10).fill());
    const b = asLatin1(other.toBytes());

    const idOf = (output: string): string =>
      (/\/ID \[<([0-9A-F]{32})>/.exec(output) as RegExpExecArray)[1] as string;
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it("differs only in the date when the creation date changes", () => {
    const other = buildDocument({ info: { creationDate: new Date("2025-06-01T12:00:00Z") } });
    expect(Buffer.from(buildDocument().toBytes()).equals(Buffer.from(other.toBytes()))).toBe(
      false,
    );
  });
});

describe("document info", () => {
  it("writes metadata and defaults the producer", () => {
    const document = new PdfDocument({
      xref: "table",
      info: {
        title: "Quarterly report",
        author: "Finance",
        keywords: ["q3", "revenue"],
        creationDate: FIXED_DATE,
      },
    });
    document.addPage({ width: 100, height: 100 });

    const output = asLatin1(document.toBytes());
    expect(output).toContain("/Title (Quarterly report)");
    expect(output).toContain("/Author (Finance)");
    expect(output).toContain("/Keywords (q3, revenue)");
    expect(output).toContain("/Producer (@pkg/core)");
    expect(output).toContain("/CreationDate (D:20240101000000+00'00')");
  });
});

describe("object numbering", () => {
  it("rejects assigning to an object that was never reserved", () => {
    const document = new PdfDocument();
    expect(() => document.assign(ref(99), null)).toThrow(/never reserved/);
  });

  it("hands out numbers in creation order", () => {
    const document = new PdfDocument();
    expect(document.add(dict({ A: 1 })).num).toBe(1);
    expect(document.reserve().num).toBe(2);
    expect(document.add(dict({ B: 2 })).num).toBe(3);
  });
});

describe("resource deduplication", () => {
  it("returns one name per object however often it is registered", () => {
    const registry = new ResourceRegistry();
    const font = ref(7);

    const names = Array.from({ length: 200 }, () => registry.register("Font", font));
    expect(new Set(names).size).toBe(1);
    expect(registry.count("Font")).toBe(1);
  });

  it("numbers distinct objects in first-use order", () => {
    const registry = new ResourceRegistry();
    expect(registry.register("Font", ref(1))).toBe("F1");
    expect(registry.register("XObject", ref(2))).toBe("X1");
    expect(registry.register("Font", ref(3))).toBe("F2");
    expect(registry.register("ExtGState", ref(4))).toBe("GS1");
    expect(registry.nameFor("Font", ref(3))).toBe("F2");
  });

  it("builds a resources dictionary in a fixed category order", () => {
    const registry = new ResourceRegistry();
    registry.register("Font", ref(1));
    registry.register("ExtGState", ref(2));

    const resources = registry.toDict();
    expect([...resources.entries.keys()]).toEqual(["ExtGState", "Font"]);
  });

  it("is empty until something is registered", () => {
    const registry = new ResourceRegistry();
    expect(registry.isEmpty()).toBe(true);
    registry.register("Font", ref(1));
    expect(registry.isEmpty()).toBe(false);
  });

  it("shares one font object across every page that uses it", () => {
    const document = new PdfDocument({ xref: "table", info: { creationDate: FIXED_DATE } });
    const font = document.add(dict({ Type: name("Font"), BaseFont: name("Helvetica") }));

    for (let i = 0; i < 5; i += 1) {
      const page = document.addPage({ width: 100, height: 100 });
      const resourceName = page.resources.register("Font", font);
      expect(resourceName).toBe("F1");
    }

    const output = asLatin1(document.toBytes());
    expect(output.match(/\/BaseFont \/Helvetica/g)).toHaveLength(1);
    expect(output.match(/\/Font <<\/F1 \d+ 0 R>>/g)).toHaveLength(5);
  });
});
