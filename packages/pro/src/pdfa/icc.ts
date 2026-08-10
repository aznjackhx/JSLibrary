/**
 * A minimal sRGB ICC profile, built rather than shipped.
 *
 * PDF/A requires an OutputIntent naming a real ICC profile, and the profile has
 * to be embedded — there is no fetching one at runtime, which the no-network
 * rule forbids anyway. Shipping a stock sRGB profile as a base64 blob would add
 * roughly 3 KB of opaque bytes to the bundle and to every review of it.
 *
 * So it is constructed. A v2 display profile with the tags the specification
 * requires for an RGB matrix/TRC profile: `desc`, `wtpt`, the three colourant
 * XYZ tags, the three tone curves, and `cprt`. The primaries and white point
 * are the sRGB values from IEC 61966-2-1; the tone curve is a gamma of 2.2,
 * which is the standard simple approximation of the sRGB transfer function and
 * is what most minimal sRGB profiles carry.
 *
 * A caller with a specific profile — a press's CMYK profile, an sRGB variant
 * their ingest pipeline mandates — supplies it instead.
 */

/** ICC s15Fixed16Number: a signed 16.16 fixed-point value. */
function s15Fixed16(value: number): number {
  return Math.round(value * 65536);
}

function writeUint32(target: DataView, offset: number, value: number): void {
  target.setUint32(offset, value >>> 0, false);
}

function writeInt32(target: DataView, offset: number, value: number): void {
  target.setInt32(offset, value | 0, false);
}

/** Four-character ICC signature as a big-endian uint32. */
function signature(text: string): number {
  return (
    ((text.charCodeAt(0) << 24) |
      (text.charCodeAt(1) << 16) |
      (text.charCodeAt(2) << 8) |
      text.charCodeAt(3)) >>>
    0
  );
}

interface Tag {
  readonly signature: string;
  readonly data: Uint8Array;
}

/** An `XYZType` tag: one CIE XYZ triple. */
function xyzTag(x: number, y: number, z: number): Uint8Array {
  const data = new Uint8Array(20);
  const view = new DataView(data.buffer);

  writeUint32(view, 0, signature("XYZ "));
  writeUint32(view, 4, 0);
  writeInt32(view, 8, s15Fixed16(x));
  writeInt32(view, 12, s15Fixed16(y));
  writeInt32(view, 16, s15Fixed16(z));

  return data;
}

/**
 * A `curveType` tag holding a single gamma value.
 *
 * A count of one means the single u8Fixed8 that follows is a gamma exponent,
 * rather than a sampled curve.
 */
function gammaTag(gamma: number): Uint8Array {
  const data = new Uint8Array(14);
  const view = new DataView(data.buffer);

  writeUint32(view, 0, signature("curv"));
  writeUint32(view, 4, 0);
  writeUint32(view, 8, 1);
  view.setUint16(12, Math.round(gamma * 256), false);

  return data;
}

/** A `textDescriptionType` tag — the v2 form, which requires all three parts. */
function descriptionTag(text: string): Uint8Array {
  const ascii = `${text}\0`;
  // 12 header + 4 length + ascii + 8 unicode header + 2*0 + 67 script code.
  const data = new Uint8Array(12 + 4 + ascii.length + 8 + 67);
  const view = new DataView(data.buffer);

  writeUint32(view, 0, signature("desc"));
  writeUint32(view, 4, 0);
  writeUint32(view, 8, ascii.length);

  for (let index = 0; index < ascii.length; index += 1) {
    data[12 + index] = ascii.charCodeAt(index);
  }

  // Unicode language code and count, then the Macintosh script code block —
  // both empty, both mandatory in a v2 description.
  return data;
}

/** A `textType` tag, used for the copyright. */
function textTag(text: string): Uint8Array {
  const ascii = `${text}\0`;
  const data = new Uint8Array(8 + ascii.length);
  const view = new DataView(data.buffer);

  writeUint32(view, 0, signature("text"));
  writeUint32(view, 4, 0);
  for (let index = 0; index < ascii.length; index += 1) {
    data[8 + index] = ascii.charCodeAt(index);
  }

  return data;
}

/** Round a length up to the four-byte boundary ICC tables require. */
function padded(length: number): number {
  return length + ((4 - (length % 4)) % 4);
}

export interface IccOptions {
  /** Profile description, which readers show as its name. */
  readonly description?: string;
  readonly copyright?: string;
}

/**
 * Build an sRGB v2 ICC profile.
 *
 * Deterministic: the same options always produce the same bytes, since the
 * profile carries no creation timestamp and no identifier derived from one.
 * Output that varies run to run would break the byte-identical guarantee the
 * rest of this library maintains.
 */
export function buildSrgbIccProfile(options: IccOptions = {}): Uint8Array {
  const description = options.description ?? "sRGB IEC61966-2.1";
  const copyright = options.copyright ?? "Public Domain";

  // sRGB primaries and D50 white point, chromatically adapted — the values a
  // v2 matrix/TRC profile carries, since ICC profile connection space is D50.
  const tags: Tag[] = [
    { signature: "desc", data: descriptionTag(description) },
    { signature: "wtpt", data: xyzTag(0.9642, 1.0, 0.8249) },
    { signature: "rXYZ", data: xyzTag(0.4360, 0.2225, 0.0139) },
    { signature: "gXYZ", data: xyzTag(0.3851, 0.7169, 0.0971) },
    { signature: "bXYZ", data: xyzTag(0.1431, 0.0606, 0.7141) },
    { signature: "rTRC", data: gammaTag(2.2) },
    { signature: "gTRC", data: gammaTag(2.2) },
    { signature: "bTRC", data: gammaTag(2.2) },
    { signature: "cprt", data: textTag(copyright) },
  ];

  const headerSize = 128;
  const tableSize = 4 + tags.length * 12;

  let offset = headerSize + tableSize;
  const placements = tags.map((tag) => {
    const placement = { tag, offset, size: tag.data.length };
    offset += padded(tag.data.length);
    return placement;
  });

  const total = offset;
  const profile = new Uint8Array(total);
  const view = new DataView(profile.buffer);

  // --- Header ---
  writeUint32(view, 0, total);
  writeUint32(view, 4, 0); // No preferred CMM.
  writeUint32(view, 8, 0x02_10_00_00); // Version 2.1.0.
  writeUint32(view, 12, signature("mntr"));
  writeUint32(view, 16, signature("RGB "));
  writeUint32(view, 20, signature("XYZ "));
  // Creation date left as zeros: a timestamp would make output non-reproducible.
  writeUint32(view, 36, signature("acsp"));
  writeUint32(view, 40, 0); // Platform: none in particular.
  writeUint32(view, 44, 0); // Flags: not embedded-dependent.
  // Rendering intent 0 (perceptual), and the D50 illuminant the header must
  // carry regardless of the white point tag.
  writeInt32(view, 68, s15Fixed16(0.9642));
  writeInt32(view, 72, s15Fixed16(1.0));
  writeInt32(view, 76, s15Fixed16(0.8249));

  // --- Tag table ---
  writeUint32(view, headerSize, tags.length);
  placements.forEach((placement, index) => {
    const entry = headerSize + 4 + index * 12;
    writeUint32(view, entry, signature(placement.tag.signature));
    writeUint32(view, entry + 4, placement.offset);
    writeUint32(view, entry + 8, placement.size);
  });

  // --- Tag data ---
  for (const placement of placements) {
    profile.set(placement.tag.data, placement.offset);
  }

  return profile;
}
