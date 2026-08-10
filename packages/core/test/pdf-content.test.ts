import { describe, expect, it } from "vitest";

import { ContentStream } from "../src/pdf/content.js";
import { PdfHexString, PdfLiteralString } from "../src/pdf/objects.js";

const render = (build: (stream: ContentStream) => void): string => {
  const stream = new ContentStream();
  build(stream);
  return Buffer.from(stream.toBytes()).toString("latin1");
};

describe("graphics operators", () => {
  it("emits a filled rectangle", () => {
    expect(
      render((s) => {
        s.setFillRgb(1, 0, 0).rect(10, 20, 30, 40).fill();
      }),
    ).toBe("1 0 0 rg\n10 20 30 40 re\nf\n");
  });

  it("balances q/Q via scoped", () => {
    expect(
      render((s) => {
        s.scoped((inner) => inner.translate(5, 5));
      }),
    ).toBe("q\n1 0 0 1 5 5 cm\nQ\n");
  });

  it("restores the state even when the body throws", () => {
    const stream = new ContentStream();
    expect(() =>
      stream.scoped(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(stream.depth).toBe(0);
  });

  it("emits W n together, since W only affects the next painting operator", () => {
    expect(render((s) => s.clipRect(0, 0, 10, 10))).toBe("0 0 10 10 re\nW\nn\n");
    expect(render((s) => s.clipRect(0, 0, 10, 10, "evenodd"))).toBe("0 0 10 10 re\nW*\nn\n");
  });

  it("clamps colour components into 0–1", () => {
    expect(render((s) => s.setFillRgb(-1, 2, 0.5))).toBe("0 1 0.5 rg\n");
  });

  it("rejects non-finite colour components", () => {
    expect(() => render((s) => s.setFillRgb(Number.NaN, 0, 0))).toThrow(RangeError);
  });

  it("emits gs and Do with escaped resource names", () => {
    expect(render((s) => s.setExtGState("GS1").drawXObject("X1"))).toBe("/GS1 gs\n/X1 Do\n");
  });

  it("refuses to close with unbalanced q", () => {
    expect(() =>
      render((s) => {
        s.save();
      }),
    ).toThrow(/unbalanced q/);
  });

  it("refuses Q without a matching q", () => {
    expect(() => render((s) => s.restore())).toThrow(/Unbalanced Q/);
  });
});

describe("text operators", () => {
  it("emits a positioned text run", () => {
    expect(
      render((s) => {
        s.text((t) => {
          t.setFont("F1", 12).moveText(72, 720).showText(new PdfLiteralString(Buffer.from("Hi")));
        });
      }),
    ).toBe("BT\n/F1 12 Tf\n72 720 Td\n(Hi) Tj\n" + "ET\n");
  });

  it("emits a TJ array with kerning adjustments", () => {
    expect(
      render((s) => {
        s.text((t) => {
          t.setFont("F1", 12).showTextArray([
            new PdfLiteralString(Buffer.from("A")),
            -120,
            new PdfHexString(new Uint8Array([0x00, 0x2b])),
          ]);
        });
      }),
    ).toBe("BT\n/F1 12 Tf\n[(A)-120<002B>] TJ\nET\n");
  });

  it("rejects text operators outside BT/ET", () => {
    expect(() => render((s) => s.setFont("F1", 12))).toThrow(/inside a BT\/ET/);
    expect(() => render((s) => s.moveText(0, 0))).toThrow(/inside a BT\/ET/);
  });

  it("rejects a nested BT", () => {
    expect(() =>
      render((s) => {
        s.beginText();
        s.beginText();
      }),
    ).toThrow(/inside an open text object/);
  });

  it("refuses to close inside a text object", () => {
    expect(() =>
      render((s) => {
        s.beginText();
      }),
    ).toThrow(/missing ET/);
  });
});

describe("determinism", () => {
  it("produces identical bytes for identical operations", () => {
    const build = (s: ContentStream): void => {
      s.scoped((inner) => {
        inner.setFillRgb(0.1, 0.35, 0.85).rect(1 / 3, 2 / 3, 100.123_456, 50).fill();
      });
    };
    expect(render(build)).toBe(render(build));
  });

  it("quantises coordinates rather than inheriting float noise", () => {
    expect(render((s) => s.rect(1 / 3, 0.1 + 0.2, 1, 1))).toBe("0.3333 0.3 1 1 re\n");
  });
});
