import { describe, expect, it, vi } from "vitest";

import { pdf } from "@pkg/core";

import { buildSrgbIccProfile } from "../src/pdfa/icc.js";
import { pdfA2bExtension } from "../src/pdfa/index.js";
import { buildXmp, escapeXml, xmpDate } from "../src/pdfa/xmp.js";
import { pro } from "../src/index.js";

const { PdfDocument } = pdf;
type PdfDocument = InstanceType<typeof PdfDocument>;

const CREATED = new Date("2024-01-01T12:34:56.789Z");

function documentWithPages(count = 2): PdfDocument {
  const pdf = new PdfDocument({ xref: "table" });
  for (let index = 0; index < count; index += 1) {
    pdf.addPage({ width: 200, height: 200 });
  }
  return pdf;
}

function contextFor(pdf: PdfDocument, metadata: Record<string, unknown> = {}): never {
  return {
    document: pdf,
    fonts: [],
    metadata: { keywords: [], creationDate: CREATED, ...metadata },
  } as never;
}

/** Render a document through the extension and read the bytes back as text. */
function applied(metadata: Record<string, unknown> = {}): string {
  const pdf = documentWithPages(2);
  pdfA2bExtension().finish?.(contextFor(pdf, metadata));
  return Buffer.from(pdf.toBytes()).toString("latin1");
}

describe("buildSrgbIccProfile", () => {
  const profile = buildSrgbIccProfile();
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);

  it("declares its own length", () => {
    // A profile whose header length disagrees with its bytes is rejected
    // outright by anything that reads it.
    expect(view.getUint32(0, false)).toBe(profile.length);
  });

  it("carries the ICC signature at the fixed offset", () => {
    expect(String.fromCharCode(...profile.slice(36, 40))).toBe("acsp");
  });

  it("is an RGB display profile connecting through XYZ", () => {
    expect(String.fromCharCode(...profile.slice(12, 16))).toBe("mntr");
    expect(String.fromCharCode(...profile.slice(16, 20))).toBe("RGB ");
    expect(String.fromCharCode(...profile.slice(20, 24))).toBe("XYZ ");
  });

  it("includes every tag a matrix/TRC profile requires", () => {
    const count = view.getUint32(128, false);
    const signatures: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 132 + index * 12;
      signatures.push(String.fromCharCode(...profile.slice(entry, entry + 4)));
    }

    for (const required of [
      "desc",
      "wtpt",
      "rXYZ",
      "gXYZ",
      "bXYZ",
      "rTRC",
      "gTRC",
      "bTRC",
      "cprt",
    ]) {
      expect(signatures, required).toContain(required);
    }
  });

  it("places every tag inside the profile, on a four-byte boundary", () => {
    const count = view.getUint32(128, false);
    for (let index = 0; index < count; index += 1) {
      const entry = 132 + index * 12;
      const offset = view.getUint32(entry + 4, false);
      const size = view.getUint32(entry + 8, false);

      expect(offset % 4).toBe(0);
      expect(offset + size).toBeLessThanOrEqual(profile.length);
    }
  });

  it("carries no timestamp, so output stays byte-identical", () => {
    // The creation-date field at offset 24 is left zeroed on purpose: a clock
    // reading here would make every render differ from the last.
    expect([...profile.slice(24, 36)].every((byte) => byte === 0)).toBe(true);
    expect(buildSrgbIccProfile()).toEqual(buildSrgbIccProfile());
  });
});

describe("buildXmp", () => {
  const base = {
    createdAt: CREATED,
    part: 2,
    conformance: "B",
  };

  it("states the conformance claim a validator reads", () => {
    const xmp = buildXmp(base);
    expect(xmp).toContain("<pdfaid:part>2</pdfaid:part>");
    expect(xmp).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
  });

  it("wraps the packet in the xpacket instructions", () => {
    const xmp = buildXmp(base);
    expect(xmp.startsWith("<?xpacket begin=")).toBe(true);
    expect(xmp.trimEnd().endsWith('<?xpacket end="w"?>')).toBe(true);
  });

  it("writes dc:creator as a sequence, not an alternative", () => {
    // A common way to fail validation: dc:creator is an ordered list of
    // authors even when there is exactly one.
    const xmp = buildXmp({ ...base, author: "Ada Lovelace" });
    expect(xmp).toContain("<dc:creator>");
    expect(xmp).toMatch(/<dc:creator>\s*<rdf:Seq>/);
  });

  it("writes dc:title as a language alternative", () => {
    const xmp = buildXmp({ ...base, title: "Report" });
    expect(xmp).toMatch(/<dc:title>\s*<rdf:Alt>/);
    expect(xmp).toContain('xml:lang="x-default"');
  });

  it("omits properties that were never supplied", () => {
    const xmp = buildXmp(base);
    expect(xmp).not.toContain("dc:title");
    expect(xmp).not.toContain("dc:creator");
  });

  it("escapes text that would otherwise break the XML", () => {
    const xmp = buildXmp({ ...base, title: 'Q1 <Results> & "Notes"' });
    expect(xmp).toContain("Q1 &lt;Results&gt; &amp; &quot;Notes&quot;");
    expect(xmp).not.toContain("<Results>");
  });

  it("drops milliseconds, which the PDF date string cannot carry", () => {
    // XMP and Info must describe the same instant; a PDF date has no room for
    // milliseconds, so keeping them here would make the two disagree.
    expect(xmpDate(CREATED)).toBe("2024-01-01T12:34:56Z");
  });
});

describe("escapeXml", () => {
  it("escapes all five predefined entities", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("escapes ampersands before the entities it introduces", () => {
    // Escaping in the wrong order yields &amp;lt; for a literal <.
    expect(escapeXml("<")).toBe("&lt;");
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("pdfA2bExtension", () => {
  it("attaches the metadata stream to the catalog", () => {
    const raw = applied();
    expect(raw).toContain("/Metadata");
    expect(raw).toContain("<pdfaid:part>2</pdfaid:part>");
  });

  it("leaves the metadata stream uncompressed and findable", () => {
    // PDF/A requires the packet be readable without parsing the file, so it
    // must not be filtered.
    const raw = applied();
    const start = raw.indexOf("/Type /Metadata");
    const segment = raw.slice(start, start + 200);

    expect(segment).not.toContain("/Filter");
    expect(segment).toContain("/Subtype /XML");
  });

  it("attaches an output intent with an embedded profile", () => {
    const raw = applied();
    expect(raw).toContain("/OutputIntents");
    expect(raw).toContain("/GTS_PDFA1");
    expect(raw).toContain("/DestOutputProfile");
    expect(raw).toContain("sRGB IEC61966-2.1");
  });

  it("marks the document as untagged rather than omitting MarkInfo", () => {
    expect(applied()).toContain("/MarkInfo");
  });

  it("carries the caller's metadata into the packet", () => {
    const raw = applied({ title: "Annual Report", author: "Acme" });
    expect(raw).toContain("Annual Report");
    expect(raw).toContain("Acme");
  });

  it("accepts a caller-supplied ICC profile", () => {
    const pdf = documentWithPages(1);
    const custom = new Uint8Array(256).fill(7);

    pdfA2bExtension({ iccProfile: custom, outputCondition: "CustomCondition" }).finish?.(
      contextFor(pdf),
    );

    expect(Buffer.from(pdf.toBytes()).toString("latin1")).toContain("CustomCondition");
  });

  it("produces byte-identical output for the same input", () => {
    expect(applied({ title: "Same" })).toBe(applied({ title: "Same" }));
  });
});

describe("pro() with the PDF/A profile", () => {
  it("claims conformance when licensed is not the case, and says so", async () => {
    // Unlicensed output carries the watermark and does *not* claim PDF/A: the
    // mark uses a non-embedded font, which PDF/A forbids. Claiming it anyway
    // would fail at an archive ingest, long after anyone could act on it.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const extension = await pro({ profile: "pdfa-2b" });
    const pdf = documentWithPages(1);
    extension.finish?.(contextFor(pdf));

    const raw = Buffer.from(pdf.toBytes()).toString("latin1");
    expect(raw).toContain("Unlicensed");
    expect(raw).not.toContain("pdfaid:part");
  });

  it("applies nothing but the licence check when the profile is none", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const extension = await pro({ profile: "none" });
    const pdf = documentWithPages(1);
    extension.finish?.(contextFor(pdf));

    const raw = Buffer.from(pdf.toBytes()).toString("latin1");
    expect(raw).not.toContain("/OutputIntents");
  });
});
