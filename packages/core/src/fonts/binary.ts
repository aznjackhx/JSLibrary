/**
 * Big-endian binary reading and writing.
 *
 * Every value in an SFNT font is big-endian, so these wrap a DataView with the
 * endianness baked in rather than repeating `false` at every call site.
 */

export class BinaryReader {
  readonly #view: DataView;
  #offset: number;

  constructor(
    readonly bytes: Uint8Array,
    offset = 0,
  ) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#offset = offset;
  }

  get offset(): number {
    return this.#offset;
  }

  set offset(value: number) {
    if (value < 0 || value > this.bytes.length) {
      throw new RangeError(`Offset ${value} is outside the buffer (${this.bytes.length} bytes)`);
    }
    this.#offset = value;
  }

  get remaining(): number {
    return this.bytes.length - this.#offset;
  }

  #require(count: number): number {
    if (this.#offset + count > this.bytes.length) {
      throw new RangeError(
        `Truncated font data: needed ${count} bytes at ${this.#offset}, ` +
          `only ${this.remaining} remain`,
      );
    }
    const at = this.#offset;
    this.#offset += count;
    return at;
  }

  uint8(): number {
    return this.#view.getUint8(this.#require(1));
  }

  int8(): number {
    return this.#view.getInt8(this.#require(1));
  }

  uint16(): number {
    return this.#view.getUint16(this.#require(2), false);
  }

  int16(): number {
    return this.#view.getInt16(this.#require(2), false);
  }

  uint32(): number {
    return this.#view.getUint32(this.#require(4), false);
  }

  int32(): number {
    return this.#view.getInt32(this.#require(4), false);
  }

  /** 16.16 fixed point. */
  fixed(): number {
    return this.int32() / 65536;
  }

  /** F2Dot14 — 2.14 fixed point, used for component scales. */
  f2dot14(): number {
    return this.int16() / 16384;
  }

  /** Four-character table tag, e.g. `glyf`. */
  tag(): string {
    const at = this.#require(4);
    return String.fromCharCode(
      this.#view.getUint8(at),
      this.#view.getUint8(at + 1),
      this.#view.getUint8(at + 2),
      this.#view.getUint8(at + 3),
    );
  }

  // --- Random access -------------------------------------------------------
  //
  // Font tables are graphs of offsets, not streams: a lookup names a subtable
  // which names a coverage table somewhere else entirely. Reading those
  // sequentially means saving and restoring the cursor around every hop,
  // which is noise at best and a misplaced cursor at worst.

  /** Read a big-endian unsigned 16-bit value at an absolute offset. */
  uint16At(at: number): number {
    this.offset = at;
    return this.uint16();
  }

  /** Read a big-endian signed 16-bit value at an absolute offset. */
  int16At(at: number): number {
    this.offset = at;
    return this.int16();
  }

  /** Read a big-endian unsigned 32-bit value at an absolute offset. */
  uint32At(at: number): number {
    this.offset = at;
    return this.uint32();
  }

  /** Read a four-character tag at an absolute offset. */
  tagAt(at: number): string {
    this.offset = at;
    return this.tag();
  }

  bytesOf(length: number): Uint8Array {
    const at = this.#require(length);
    return this.bytes.subarray(at, at + length);
  }

  skip(count: number): void {
    this.#require(count);
  }
}

export class BinaryWriter {
  #buffer: Uint8Array;
  #view: DataView;
  #length = 0;

  constructor(capacity = 1024) {
    this.#buffer = new Uint8Array(capacity);
    this.#view = new DataView(this.#buffer.buffer);
  }

  get length(): number {
    return this.#length;
  }

  #ensure(extra: number): number {
    const required = this.#length + extra;
    if (required > this.#buffer.length) {
      let capacity = this.#buffer.length * 2;
      while (capacity < required) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.#buffer.subarray(0, this.#length));
      this.#buffer = grown;
      this.#view = new DataView(grown.buffer);
    }
    const at = this.#length;
    this.#length += extra;
    return at;
  }

  uint8(value: number): void {
    this.#view.setUint8(this.#ensure(1), value);
  }

  uint16(value: number): void {
    this.#view.setUint16(this.#ensure(2), value, false);
  }

  int16(value: number): void {
    this.#view.setInt16(this.#ensure(2), value, false);
  }

  uint32(value: number): void {
    this.#view.setUint32(this.#ensure(4), value >>> 0, false);
  }

  tag(value: string): void {
    if (value.length !== 4) throw new RangeError(`Tag must be 4 characters: ${value}`);
    for (let i = 0; i < 4; i += 1) this.uint8(value.charCodeAt(i));
  }

  raw(bytes: Uint8Array): void {
    const at = this.#ensure(bytes.length);
    this.#buffer.set(bytes, at);
  }

  /** Pad with zeros until the length is a multiple of `alignment`. */
  align(alignment = 4): void {
    while (this.#length % alignment !== 0) this.uint8(0);
  }

  toUint8Array(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }
}

/**
 * SFNT table checksum: the sum of the table's contents as big-endian uint32s,
 * with the tail zero-padded to a four-byte boundary.
 */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const fullWords = Math.floor(data.length / 4) * 4;

  for (let i = 0; i < fullWords; i += 4) {
    const word =
      ((data[i] as number) << 24) |
      ((data[i + 1] as number) << 16) |
      ((data[i + 2] as number) << 8) |
      (data[i + 3] as number);
    sum = (sum + word) >>> 0;
  }

  if (fullWords < data.length) {
    let word = 0;
    for (let i = 0; i < 4; i += 1) {
      word = ((word << 8) | (data[fullWords + i] ?? 0)) >>> 0;
    }
    sum = (sum + word) >>> 0;
  }

  return sum >>> 0;
}
