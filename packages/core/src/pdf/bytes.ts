/**
 * Byte-level output primitives.
 *
 * A PDF is a byte stream, not a string: stream payloads are binary and the
 * cross-reference table indexes byte offsets, so everything is assembled as
 * bytes and offsets are read straight off the writer.
 */

const INITIAL_CAPACITY = 1024;

export class ByteWriter {
  #buffer: Uint8Array;
  #length = 0;

  constructor(capacity = INITIAL_CAPACITY) {
    this.#buffer = new Uint8Array(capacity);
  }

  /** Bytes written so far — also the byte offset of the next write. */
  get length(): number {
    return this.#length;
  }

  #ensure(extra: number): void {
    const required = this.#length + extra;
    if (required <= this.#buffer.length) return;

    let capacity = this.#buffer.length * 2;
    while (capacity < required) capacity *= 2;

    const grown = new Uint8Array(capacity);
    grown.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = grown;
  }

  writeByte(byte: number): void {
    this.#ensure(1);
    this.#buffer[this.#length] = byte;
    this.#length += 1;
  }

  writeBytes(bytes: Uint8Array): void {
    this.#ensure(bytes.length);
    this.#buffer.set(bytes, this.#length);
    this.#length += bytes.length;
  }

  /**
   * Write a string as Latin-1 bytes.
   *
   * PDF syntax outside stream payloads is 8-bit; anything beyond U+00FF has
   * already been encoded (as a hex string, or UTF-16BE) before reaching here.
   */
  writeAscii(text: string): void {
    this.#ensure(text.length);
    for (let i = 0; i < text.length; i += 1) {
      this.#buffer[this.#length + i] = text.charCodeAt(i) & 0xff;
    }
    this.#length += text.length;
  }

  /** A copy of everything written. */
  toUint8Array(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }
}

/** Latin-1 encode a string to bytes. */
export function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Largest magnitude that survives round-tripping through PDF number syntax.
 * Well above any page geometry, well below where JS reaches for exponents.
 */
const MAX_MAGNITUDE = 1e15;

/**
 * Format a number for PDF syntax.
 *
 * Two things matter here. PDF has no exponent notation, so `1e-7` must never
 * reach the output. And identical input must produce byte-identical output, so
 * the precision is fixed rather than left to the shortest round-trip
 * representation.
 */
export function formatNumber(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot serialise non-finite number ${value}`);
  }

  // Beyond this, both String() and toFixed() switch to exponent notation, which
  // PDF cannot parse. Nothing in a real document comes close — a value this
  // large is a bug upstream, and silently writing invalid syntax would hide it.
  if (Math.abs(value) >= MAX_MAGNITUDE) {
    throw new RangeError(`Number ${value} is too large to serialise as PDF syntax`);
  }

  if (Number.isInteger(value)) {
    // Object.is guards against -0, which would otherwise serialise as "-0".
    return Object.is(value, -0) ? "0" : String(value);
  }

  let text = value.toFixed(decimals);

  // Trim trailing zeros, then a bare trailing point.
  text = text.replace(/0+$/, "").replace(/\.$/, "");

  // toFixed can round to zero with a sign: "-0.0000" -> "-0".
  if (text === "-0" || text === "") return "0";

  // PDF accepts a leading point but some parsers are happier with the zero.
  return text;
}
