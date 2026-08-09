/**
 * Object model to bytes.
 */

import { ByteWriter, formatNumber } from "./bytes.js";
import { flate } from "./filters.js";
import {
  name,
  PdfDict,
  PdfHexString,
  PdfLiteralString,
  PdfName,
  PdfRef,
  PdfStream,
  type PdfValue,
} from "./objects.js";

const HEX_DIGITS = "0123456789ABCDEF";

/**
 * Characters that may appear unescaped in a name.
 *
 * Everything else — delimiters, whitespace, `#` itself, and anything outside
 * printable ASCII — is written as `#XX`.
 */
function isRegularNameChar(code: number): boolean {
  if (code < 0x21 || code > 0x7e) return false;
  switch (code) {
    case 0x23: // #
    case 0x25: // %
    case 0x28: // (
    case 0x29: // )
    case 0x2f: // /
    case 0x3c: // <
    case 0x3e: // >
    case 0x5b: // [
    case 0x5d: // ]
    case 0x7b: // {
    case 0x7d: // }
      return false;
    default:
      return true;
  }
}

export function encodeName(value: string): string {
  let out = "/";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (isRegularNameChar(code)) {
      out += value[i];
    } else if (code <= 0xff) {
      out += `#${HEX_DIGITS[(code >> 4) & 0xf]}${HEX_DIGITS[code & 0xf]}`;
    } else {
      throw new RangeError(
        `Name ${JSON.stringify(value)} contains a character outside the byte range`,
      );
    }
  }
  return out;
}

function writeLiteralString(bytes: Uint8Array, writer: ByteWriter): void {
  writer.writeByte(0x28); // (
  for (const byte of bytes) {
    switch (byte) {
      case 0x28: // (
      case 0x29: // )
      case 0x5c: // backslash
        writer.writeByte(0x5c);
        writer.writeByte(byte);
        break;
      case 0x0a:
        writer.writeAscii("\\n");
        break;
      case 0x0d:
        writer.writeAscii("\\r");
        break;
      case 0x09:
        writer.writeAscii("\\t");
        break;
      case 0x08:
        writer.writeAscii("\\b");
        break;
      case 0x0c:
        writer.writeAscii("\\f");
        break;
      default:
        if (byte < 0x20 || byte > 0x7e) {
          // Octal escape keeps the output 7-bit clean and unambiguous.
          writer.writeAscii(`\\${byte.toString(8).padStart(3, "0")}`);
        } else {
          writer.writeByte(byte);
        }
    }
  }
  writer.writeByte(0x29); // )
}

function writeHexString(bytes: Uint8Array, writer: ByteWriter): void {
  writer.writeByte(0x3c); // <
  for (const byte of bytes) {
    writer.writeAscii(HEX_DIGITS[(byte >> 4) & 0xf] as string);
    writer.writeAscii(HEX_DIGITS[byte & 0xf] as string);
  }
  writer.writeByte(0x3e); // >
}

/**
 * Apply filters to a stream payload and return the dictionary that describes
 * the result.
 *
 * Compression is skipped when it does not shrink the payload — deflate adds a
 * header, so tiny streams would otherwise grow.
 */
export function encodeStream(stream: PdfStream): { dict: PdfDict; data: Uint8Array } {
  let data = stream.data;
  let filters = [...stream.filters];

  if (stream.compress) {
    const compressed = flate(data);
    if (compressed.length < data.length) {
      data = compressed;
      // Decode order: Flate first, then whatever the payload already carried.
      filters = [name("FlateDecode"), ...filters];
    }
  }

  const dict = new PdfDict(stream.dict.entries);
  if (filters.length === 1) {
    dict.set("Filter", filters[0] as PdfName);
  } else if (filters.length > 1) {
    dict.set("Filter", filters);
  }
  dict.set("Length", data.length);

  return { dict, data };
}

export function serialize(value: PdfValue, writer: ByteWriter): void {
  if (value === null) {
    writer.writeAscii("null");
    return;
  }

  if (typeof value === "boolean") {
    writer.writeAscii(value ? "true" : "false");
    return;
  }

  if (typeof value === "number") {
    writer.writeAscii(formatNumber(value));
    return;
  }

  if (value instanceof PdfName) {
    writer.writeAscii(encodeName(value.value));
    return;
  }

  if (value instanceof PdfRef) {
    writer.writeAscii(`${value.num} ${value.gen} R`);
    return;
  }

  if (value instanceof PdfLiteralString) {
    writeLiteralString(value.bytes, writer);
    return;
  }

  if (value instanceof PdfHexString) {
    writeHexString(value.bytes, writer);
    return;
  }

  if (Array.isArray(value)) {
    writer.writeByte(0x5b); // [
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) writer.writeByte(0x20);
      serialize(value[i] as PdfValue, writer);
    }
    writer.writeByte(0x5d); // ]
    return;
  }

  if (value instanceof PdfStream) {
    const { dict, data } = encodeStream(value);
    serialize(dict, writer);
    writer.writeAscii("\nstream\n");
    writer.writeBytes(data);
    writer.writeAscii("\nendstream");
    return;
  }

  if (value instanceof PdfDict) {
    writer.writeAscii("<<");
    let first = true;
    for (const [key, entry] of value.entries) {
      if (!first) writer.writeByte(0x20);
      first = false;
      writer.writeAscii(encodeName(key));
      writer.writeByte(0x20);
      serialize(entry, writer);
    }
    writer.writeAscii(">>");
    return;
  }

  throw new TypeError(`Cannot serialise value of unknown type: ${String(value)}`);
}

/** Serialise a single value to bytes. Convenience for tests and object streams. */
export function serializeToBytes(value: PdfValue): Uint8Array {
  const writer = new ByteWriter();
  serialize(value, writer);
  return writer.toUint8Array();
}
