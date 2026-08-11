/**
 * A minimal PNG encoder, so image fixtures are generated rather than committed.
 *
 * Committed binaries are opaque: nobody can tell from the repository what is in
 * one, and "the image looks wrong" then has two possible causes instead of one.
 * These are a few lines of arithmetic each, so what the renderer is being asked
 * to draw is legible in the source.
 *
 * Deterministic by construction — same bytes every run, which the corpus
 * determinism invariant depends on.
 */

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xff_ff_ff_ff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])), 0);

  return Buffer.concat([head, Buffer.from(body), crc]);
}

/** Colour of one pixel, as RGBA in 0–255. */
export type Shader = (x: number, y: number) => readonly [number, number, number, number];

/** Encode an RGBA image of the given size, one pixel at a time. */
export function encodePng(width: number, height: number, shade: Shader): Buffer {
  // Each scanline is prefixed with its filter type. Zero — no filtering — keeps
  // the encoder honest: the bytes in the file are the pixels asked for.
  const raw = Buffer.alloc(height * (1 + width * 4));

  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    raw[cursor] = 0;
    cursor += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = shade(x, y);
      raw[cursor] = r;
      raw[cursor + 1] = g;
      raw[cursor + 2] = b;
      raw[cursor + 3] = a;
      cursor += 4;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Compression, filter and interlace methods: the only values PNG defines.
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

export function pngDataUrl(width: number, height: number, shade: Shader): string {
  return `data:image/png;base64,${encodePng(width, height, shade).toString("base64")}`;
}

/**
 * A checkerboard in two colours.
 *
 * Sharp edges on a regular grid: any resampling shows up immediately as a soft
 * or uneven boundary, which a photograph would hide.
 */
export function checkerboard(
  square: number,
  light: readonly [number, number, number],
  dark: readonly [number, number, number],
): Shader {
  return (x, y) => {
    const on = (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0;
    const [r, g, b] = on ? light : dark;
    return [r, g, b, 255];
  };
}

/**
 * A disc that fades to fully transparent at its edge.
 *
 * Both ends of the alpha range in one image: the centre is opaque, the corners
 * are invisible, and the ring between them is where a mishandled soft mask
 * shows as a halo.
 */
export function fadingDisc(
  size: number,
  colour: readonly [number, number, number],
): Shader {
  const centre = size / 2;
  return (x, y) => {
    const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
    const edge = Math.max(0, Math.min(1, 1 - distance / centre));
    const [r, g, b] = colour;
    return [r, g, b, Math.round(edge * 255)];
  };
}
