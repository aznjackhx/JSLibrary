/**
 * The PDF object model.
 *
 * PDF has eight basic object types: null, boolean, number, string, name,
 * array, dictionary and stream, plus indirect references to them. This module
 * models them; `serialize.ts` turns them into bytes.
 *
 * Dictionaries preserve insertion order. That is not required by the format,
 * but byte-identical output for identical input is, and iteration order is the
 * cheapest way to guarantee it.
 */

/** A PDF name object, e.g. `/Type`. Stored without the leading slash. */
export class PdfName {
  readonly #brand = "PdfName" as const;

  constructor(readonly value: string) {
    if (value.length === 0) {
      throw new RangeError("A PDF name must not be empty");
    }
  }

  toString(): string {
    void this.#brand;
    return `/${this.value}`;
  }
}

/** A literal string, `(like this)`. Holds bytes, not characters. */
export class PdfLiteralString {
  constructor(readonly bytes: Uint8Array) {}
}

/** A hexadecimal string, `<4C696B65>`. Holds bytes, not characters. */
export class PdfHexString {
  constructor(readonly bytes: Uint8Array) {}
}

/** An indirect reference, e.g. `12 0 R`. */
export class PdfRef {
  constructor(
    readonly num: number,
    readonly gen = 0,
  ) {
    if (!Number.isInteger(num) || num <= 0) {
      throw new RangeError(`Object number must be a positive integer, received ${num}`);
    }
    if (!Number.isInteger(gen) || gen < 0) {
      throw new RangeError(`Generation must be a non-negative integer, received ${gen}`);
    }
  }

  /** Stable key for deduplication maps. */
  get key(): string {
    return `${this.num} ${this.gen}`;
  }

  toString(): string {
    return `${this.num} ${this.gen} R`;
  }
}

/** A dictionary. Keys are name strings without the leading slash. */
export class PdfDict {
  readonly entries: Map<string, PdfValue>;

  constructor(entries: Iterable<readonly [string, PdfValue]> = []) {
    this.entries = new Map(entries);
  }

  get(key: string): PdfValue | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Set a key. `undefined` removes it, so optional fields read naturally. */
  set(key: string, value: PdfValue | undefined): this {
    if (value === undefined) this.entries.delete(key);
    else this.entries.set(key, value);
    return this;
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface PdfStreamOptions {
  /**
   * Apply Flate compression when writing. Default true.
   *
   * Compression is skipped automatically when it would not shrink the payload,
   * so tiny streams do not grow.
   */
  readonly compress?: boolean;
  /**
   * Filters already applied to `data` by the caller, in decode order — for
   * payloads that arrive pre-encoded, such as JPEG image data (`DCTDecode`).
   */
  readonly filters?: readonly PdfName[];
}

/** A stream: a dictionary plus a payload. */
export class PdfStream {
  readonly dict: PdfDict;
  readonly data: Uint8Array;
  readonly compress: boolean;
  readonly filters: readonly PdfName[];

  constructor(dict: PdfDict, data: Uint8Array, options: PdfStreamOptions = {}) {
    this.dict = dict;
    this.data = data;
    this.compress = options.compress ?? true;
    this.filters = options.filters ?? [];
  }
}

export type PdfValue =
  | null
  | boolean
  | number
  | PdfName
  | PdfLiteralString
  | PdfHexString
  | PdfRef
  | PdfDict
  | PdfStream
  | readonly PdfValue[];

// --- Constructors -----------------------------------------------------------

const NAME_CACHE = new Map<string, PdfName>();

/** Interned name constructor — `/Type` appears in every object graph. */
export function name(value: string): PdfName {
  let cached = NAME_CACHE.get(value);
  if (!cached) {
    cached = new PdfName(value);
    NAME_CACHE.set(value, cached);
  }
  return cached;
}

export function dict(entries: Record<string, PdfValue | undefined> = {}): PdfDict {
  const result = new PdfDict();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) result.set(key, value);
  }
  return result;
}

export function ref(num: number, gen = 0): PdfRef {
  return new PdfRef(num, gen);
}

/**
 * A text string, encoded per PDF's text string rules.
 *
 * ASCII-only content stays a readable literal string; anything else becomes
 * UTF-16BE with a byte order mark, which is what viewers expect for titles,
 * bookmark labels and the like.
 */
export function textString(value: string): PdfLiteralString | PdfHexString {
  let ascii = true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      ascii = false;
      break;
    }
  }

  if (ascii) {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i);
    return new PdfLiteralString(bytes);
  }

  // UTF-16BE with BOM. Iterating by code unit keeps surrogate pairs intact.
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    bytes[2 + i * 2] = (code >> 8) & 0xff;
    bytes[3 + i * 2] = code & 0xff;
  }
  return new PdfHexString(bytes);
}

/** A PDF date string, `D:YYYYMMDDHHmmSS+00'00'`, always in UTC. */
export function dateString(date: Date): PdfLiteralString {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Cannot serialise an invalid Date");
  }

  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  const text =
    `D:${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+00'00'`;

  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return new PdfLiteralString(bytes);
}
