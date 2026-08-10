import { describe, expect, it } from "vitest";

import { formatNumber } from "../src/pdf/bytes.js";
import {
  dateString,
  dict,
  name,
  PdfDict,
  PdfHexString,
  PdfLiteralString,
  PdfName,
  PdfRef,
  PdfStream,
  ref,
  textString,
} from "../src/pdf/objects.js";
import { encodeName, encodeStream, serializeToBytes } from "../src/pdf/serialize.js";

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");
const write = (value: Parameters<typeof serializeToBytes>[0]): string =>
  text(serializeToBytes(value));

describe("formatNumber", () => {
  it("writes integers without a decimal point", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(612)).toBe("612");
    expect(formatNumber(-42)).toBe("-42");
  });

  it("never emits exponent notation, which PDF has no syntax for", () => {
    expect(formatNumber(1e-7)).toBe("0");
    expect(formatNumber(0.000_012_5)).toBe("0");
    expect(formatNumber(123_456_789_012)).toBe("123456789012");
  });

  it("throws rather than emit a magnitude PDF cannot express", () => {
    // JS switches to exponent notation past this point; a value this large is
    // a bug upstream, not something to paper over.
    expect(() => formatNumber(1e21)).toThrow(RangeError);
    expect(() => formatNumber(-1e16)).toThrow(RangeError);
  });

  it("trims trailing zeros and normalises negative zero", () => {
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(1.500_01)).toBe("1.5");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.000_01)).toBe("0");
  });

  it("rejects non-finite values rather than writing garbage", () => {
    expect(() => formatNumber(Number.NaN)).toThrow(RangeError);
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("names", () => {
  it("escapes delimiters, whitespace and the escape character itself", () => {
    expect(encodeName("Type")).toBe("/Type");
    expect(encodeName("A B")).toBe("/A#20B");
    expect(encodeName("a#b")).toBe("/a#23b");
    expect(encodeName("paren)")).toBe("/paren#29");
    expect(encodeName("sl/ash")).toBe("/sl#2Fash");
  });

  it("interns repeated names", () => {
    expect(name("Type")).toBe(name("Type"));
  });

  it("rejects empty names and characters outside the byte range", () => {
    expect(() => new PdfName("")).toThrow(RangeError);
    expect(() => encodeName("é\u{1F600}")).toThrow(RangeError);
  });
});

describe("strings", () => {
  it("escapes parentheses and backslashes in literal strings", () => {
    expect(write(new PdfLiteralString(Buffer.from("a(b)c\\d", "latin1")))).toBe(
      "(a\\(b\\)c\\\\d)",
    );
  });

  it("octal-escapes bytes outside printable ASCII", () => {
    expect(write(new PdfLiteralString(new Uint8Array([0x00, 0x1f, 0x80])))).toBe(
      "(\\000\\037\\200)",
    );
  });

  it("uses named escapes for the common control characters", () => {
    expect(write(new PdfLiteralString(new Uint8Array([0x0a, 0x0d, 0x09])))).toBe("(\\n\\r\\t)");
  });

  it("writes hex strings in uppercase", () => {
    expect(write(new PdfHexString(new Uint8Array([0xde, 0xad, 0x0f])))).toBe("<DEAD0F>");
  });

  it("keeps ASCII text as a readable literal", () => {
    const value = textString("Hello");
    expect(value).toBeInstanceOf(PdfLiteralString);
    expect(write(value)).toBe("(Hello)");
  });

  it("encodes non-ASCII text as UTF-16BE with a byte order mark", () => {
    const value = textString("Ünïcödé");
    expect(value).toBeInstanceOf(PdfHexString);
    // U+00DC n U+00EF c U+00F6 d U+00E9
    expect(write(value)).toBe("<FEFF00DC006E00EF006300F6006400E9>");
  });

  it("preserves surrogate pairs", () => {
    // U+1F600 is D83D DE00 in UTF-16.
    expect(write(textString("\u{1F600}"))).toBe("<FEFFD83DDE00>");
  });
});

describe("dates", () => {
  it("writes PDF date syntax in UTC", () => {
    expect(write(dateString(new Date("2024-03-07T09:05:01Z")))).toBe("(D:20240307090501+00'00')");
  });

  it("pads every field", () => {
    expect(write(dateString(new Date("0999-01-02T03:04:05Z")))).toBe("(D:09990102030405+00'00')");
  });

  it("rejects an invalid date", () => {
    expect(() => dateString(new Date("nonsense"))).toThrow(RangeError);
  });
});

describe("containers", () => {
  it("serialises arrays and nested values", () => {
    expect(write([1, 2.5, name("A"), ref(3), null, true])).toBe("[1 2.5 /A 3 0 R null true]");
  });

  it("serialises dictionaries in insertion order", () => {
    const value = dict({ Type: name("Page"), MediaBox: [0, 0, 612, 792] });
    expect(write(value)).toBe("<</Type /Page /MediaBox [0 0 612 792]>>");
  });

  it("treats undefined as absent so optional entries read naturally", () => {
    expect(write(dict({ A: 1, B: undefined }))).toBe("<</A 1>>");
    expect(write(new PdfDict().set("A", 1).set("A", undefined))).toBe("<<>>");
  });

  it("rejects invalid references", () => {
    expect(() => new PdfRef(0)).toThrow(RangeError);
    expect(() => new PdfRef(1, -1)).toThrow(RangeError);
    expect(new PdfRef(4, 2).key).toBe("4 2");
  });
});

describe("streams", () => {
  it("compresses and records the filter", () => {
    const payload = new Uint8Array(4096).fill(0x41);
    const { dict: encoded, data } = encodeStream(new PdfStream(new PdfDict(), payload));

    expect(data.length).toBeLessThan(payload.length);
    expect(encoded.get("Filter")).toBe(name("FlateDecode"));
    expect(encoded.get("Length")).toBe(data.length);
  });

  it("skips compression when it would make the payload bigger", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const { dict: encoded, data } = encodeStream(new PdfStream(new PdfDict(), payload));

    expect(data).toEqual(payload);
    expect(encoded.has("Filter")).toBe(false);
    expect(encoded.get("Length")).toBe(3);
  });

  it("honours compress: false", () => {
    const payload = new Uint8Array(4096).fill(0x41);
    const { dict: encoded, data } = encodeStream(
      new PdfStream(new PdfDict(), payload, { compress: false }),
    );

    expect(data.length).toBe(payload.length);
    expect(encoded.has("Filter")).toBe(false);
  });

  it("stacks Flate ahead of a filter the payload already carries", () => {
    const payload = new Uint8Array(4096).fill(0x41);
    const { dict: encoded } = encodeStream(
      new PdfStream(new PdfDict(), payload, { filters: [name("DCTDecode")] }),
    );

    // Decode order: undo Flate first, then the payload's own encoding.
    expect(encoded.get("Filter")).toEqual([name("FlateDecode"), name("DCTDecode")]);
  });

  it("emits stream syntax around the payload", () => {
    const output = write(new PdfStream(new PdfDict(), new Uint8Array([0x41]), { compress: false }));
    expect(output).toBe("<</Length 1>>\nstream\nA\nendstream");
  });

  it("is deterministic for identical payloads", () => {
    const payload = new Uint8Array(2048).fill(0x42);
    const first = encodeStream(new PdfStream(new PdfDict(), payload)).data;
    const second = encodeStream(new PdfStream(new PdfDict(), payload)).data;
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
