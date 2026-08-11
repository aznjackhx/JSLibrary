/**
 * Content stream construction.
 *
 * A thin, checked wrapper over PDF's operator syntax. It does not decide what
 * to draw — that is emission's job — but it does refuse to build syntactically
 * impossible streams (text operators outside `BT`/`ET`, unbalanced `q`/`Q`),
 * because a malformed content stream fails at the viewer with no useful
 * diagnostic.
 *
 * Coordinates are PDF user space: origin bottom-left, y upward, units of 1/72".
 */

import { ByteWriter, formatNumber } from "./bytes.js";
import type { PdfHexString, PdfLiteralString } from "./objects.js";
import { encodeName, serializeToBytes } from "./serialize.js";

/** Winding rule for fills and clips. */
export type FillRule = "nonzero" | "evenodd";

/** A component of a `TJ` array: a string to show, or a position adjustment. */
export type TextItem = PdfLiteralString | PdfHexString | number;

export class ContentStream {
  #writer = new ByteWriter();
  #depth = 0;
  #inText = false;

  /** Nesting depth of unclosed `q` operators. */
  get depth(): number {
    return this.#depth;
  }

  #op(operator: string, ...operands: number[]): void {
    for (const operand of operands) {
      this.#writer.writeAscii(formatNumber(operand));
      this.#writer.writeByte(0x20);
    }
    this.#writer.writeAscii(operator);
    this.#writer.writeByte(0x0a);
  }

  #assertInText(operator: string): void {
    if (!this.#inText) {
      throw new Error(`${operator} is only valid inside a BT/ET text object`);
    }
  }

  // --- Graphics state -------------------------------------------------------

  /** `q` — push the graphics state. */
  save(): this {
    this.#op("q");
    this.#depth += 1;
    return this;
  }

  /** `Q` — pop the graphics state. */
  restore(): this {
    if (this.#depth === 0) {
      throw new Error("Unbalanced Q: no matching q");
    }
    this.#op("Q");
    this.#depth -= 1;
    return this;
  }

  /** Run `body` between `q` and `Q`, restoring even if it throws. */
  scoped(body: (stream: this) => void): this {
    this.save();
    try {
      body(this);
    } finally {
      this.restore();
    }
    return this;
  }

  /** `cm` — concatenate a matrix onto the current transform. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.#op("cm", a, b, c, d, e, f);
    return this;
  }

  translate(tx: number, ty: number): this {
    return this.transform(1, 0, 0, 1, tx, ty);
  }

  scale(sx: number, sy: number): this {
    return this.transform(sx, 0, 0, sy, 0, 0);
  }

  /** `w` — stroke width. */
  setLineWidth(width: number): this {
    this.#op("w", width);
    return this;
  }

  /** `J` — line cap: 0 butt, 1 round, 2 projecting square. */
  setLineCap(cap: 0 | 1 | 2): this {
    this.#op("J", cap);
    return this;
  }

  /** `j` — line join: 0 miter, 1 round, 2 bevel. */
  setLineJoin(join: 0 | 1 | 2): this {
    this.#op("j", join);
    return this;
  }

  /**
   * `d` — dash pattern.
   *
   * An empty array is a solid line. A pattern of all zeros is rejected by
   * viewers, so it is normalised to solid here rather than written out.
   */
  setDash(pattern: readonly number[], phase = 0): this {
    const usable = pattern.filter((entry) => Number.isFinite(entry) && entry >= 0);
    const dashes = usable.some((entry) => entry > 0) ? usable : [];

    this.#writer.writeAscii(
      `[${dashes.map((entry) => formatNumber(entry)).join(" ")}] ${formatNumber(dashes.length === 0 ? 0 : phase)} d\n`,
    );
    return this;
  }

  /** `gs` — apply a named ExtGState (opacity, blend mode). */
  setExtGState(resourceName: string): this {
    this.#writer.writeAscii(`${encodeName(resourceName)} gs\n`);
    return this;
  }

  /**
   * `sh` — paint a shading over the current clip.
   *
   * Unlike a pattern fill this has no path of its own: it floods everything
   * the clip allows, so callers clip to the shape first.
   */
  shading(resourceName: string): this {
    this.#writer.writeAscii(`${encodeName(resourceName)} sh\n`);
    return this;
  }

  // --- Colour ---------------------------------------------------------------

  /** `rg` — non-stroking colour, components in 0–1. */
  setFillRgb(r: number, g: number, b: number): this {
    this.#op("rg", clampUnit(r), clampUnit(g), clampUnit(b));
    return this;
  }

  /** `RG` — stroking colour, components in 0–1. */
  setStrokeRgb(r: number, g: number, b: number): this {
    this.#op("RG", clampUnit(r), clampUnit(g), clampUnit(b));
    return this;
  }

  /** `g` — non-stroking grey. */
  setFillGray(level: number): this {
    this.#op("g", clampUnit(level));
    return this;
  }

  // --- Paths ----------------------------------------------------------------

  /** `re` — append a rectangle as a complete subpath. */
  rect(x: number, y: number, width: number, height: number): this {
    this.#op("re", x, y, width, height);
    return this;
  }

  /** `m` */
  moveTo(x: number, y: number): this {
    this.#op("m", x, y);
    return this;
  }

  /** `l` */
  lineTo(x: number, y: number): this {
    this.#op("l", x, y);
    return this;
  }

  /** `c` — cubic Bézier. */
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    this.#op("c", x1, y1, x2, y2, x3, y3);
    return this;
  }

  /** `h` — close the current subpath. */
  closePath(): this {
    this.#op("h");
    return this;
  }

  /** `f` / `f*` — fill. */
  fill(rule: FillRule = "nonzero"): this {
    this.#op(rule === "evenodd" ? "f*" : "f");
    return this;
  }

  /** `S` — stroke. */
  stroke(): this {
    this.#op("S");
    return this;
  }

  /** `B` / `B*` — fill and stroke. */
  fillAndStroke(rule: FillRule = "nonzero"): this {
    this.#op(rule === "evenodd" ? "B*" : "B");
    return this;
  }

  /** `n` — end the path without painting. */
  endPath(): this {
    this.#op("n");
    return this;
  }

  /**
   * `W n` — clip to the current path.
   *
   * `W` only sets the clip for the *next* path-painting operator, so the `n` is
   * emitted here rather than left to the caller to remember.
   */
  clip(rule: FillRule = "nonzero"): this {
    this.#op(rule === "evenodd" ? "W*" : "W");
    this.#op("n");
    return this;
  }

  /** Clip to a rectangle. */
  clipRect(x: number, y: number, width: number, height: number, rule?: FillRule): this {
    this.rect(x, y, width, height);
    return this.clip(rule);
  }

  // --- Text -----------------------------------------------------------------

  /** `BT` */
  beginText(): this {
    if (this.#inText) throw new Error("BT inside an open text object");
    this.#op("BT");
    this.#inText = true;
    return this;
  }

  /** `ET` */
  endText(): this {
    this.#assertInText("ET");
    this.#op("ET");
    this.#inText = false;
    return this;
  }

  /** Run `body` between `BT` and `ET`. */
  text(body: (stream: this) => void): this {
    this.beginText();
    try {
      body(this);
    } finally {
      this.endText();
    }
    return this;
  }

  /** `Tf` — select a font from the page resources. */
  setFont(resourceName: string, size: number): this {
    this.#assertInText("Tf");
    this.#writer.writeAscii(`${encodeName(resourceName)} ${formatNumber(size)} Tf\n`);
    return this;
  }

  /** `TL` — leading, used by `T*`. */
  setLeading(leading: number): this {
    this.#assertInText("TL");
    this.#op("TL", leading);
    return this;
  }

  /** `Td` — move to the start of the next line, offset from the current one. */
  moveText(tx: number, ty: number): this {
    this.#assertInText("Td");
    this.#op("Td", tx, ty);
    return this;
  }

  /** `Tm` — set the text matrix outright. */
  setTextMatrix(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.#assertInText("Tm");
    this.#op("Tm", a, b, c, d, e, f);
    return this;
  }

  /** `T*` — next line, using the current leading. */
  nextLine(): this {
    this.#assertInText("T*");
    this.#op("T*");
    return this;
  }

  /** `Tj` — show a string. */
  showText(value: PdfLiteralString | PdfHexString): this {
    this.#assertInText("Tj");
    this.#writeString(value);
    this.#writer.writeAscii(" Tj\n");
    return this;
  }

  /**
   * `TJ` — show strings with position adjustments between them.
   *
   * Numbers are thousandths of an em, subtracted from the advance; this is how
   * the precise text path pins each glyph cluster to the x-position the browser
   * measured.
   */
  showTextArray(items: readonly TextItem[]): this {
    this.#assertInText("TJ");
    this.#writer.writeByte(0x5b); // [
    for (const item of items) {
      if (typeof item === "number") {
        this.#writer.writeAscii(formatNumber(item));
      } else {
        this.#writeString(item);
      }
    }
    this.#writer.writeAscii("] TJ\n");
    return this;
  }

  #writeString(value: PdfLiteralString | PdfHexString): void {
    // Strings inside content streams follow the same syntax as elsewhere, so
    // escaping goes through the one implementation in serialize.ts.
    this.#writer.writeBytes(serializeToBytes(value));
  }

  // --- XObjects -------------------------------------------------------------

  /** `Do` — paint a named XObject (image or form). */
  drawXObject(resourceName: string): this {
    this.#writer.writeAscii(`${encodeName(resourceName)} Do\n`);
    return this;
  }

  /** Raw operator escape hatch, for operators not yet wrapped. */
  raw(text: string): this {
    this.#writer.writeAscii(text.endsWith("\n") ? text : `${text}\n`);
    return this;
  }

  // --- Output ---------------------------------------------------------------

  /**
   * Finished stream bytes.
   *
   * Throws on an unbalanced state rather than emitting a stream a viewer will
   * reject: the bug is here, not in the viewer.
   */
  toBytes(): Uint8Array {
    if (this.#inText) throw new Error("Content stream ends inside a text object (missing ET)");
    if (this.#depth !== 0) {
      throw new Error(`Content stream ends with ${this.#depth} unbalanced q operator(s)`);
    }
    return this.#writer.toUint8Array();
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Colour component must be finite, received ${value}`);
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
