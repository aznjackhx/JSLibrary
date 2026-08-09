/**
 * Stream filters.
 *
 * Flate is the only filter we produce; images arrive pre-encoded and are passed
 * through with their own filter recorded on the stream.
 */

import { deflate } from "pako";

/**
 * Compression level.
 *
 * Fixed rather than tuned: pako is deterministic for a given input and level,
 * and byte-identical output is a hard requirement.
 */
const DEFLATE_LEVEL = 9;

export function flate(data: Uint8Array): Uint8Array {
  return deflate(data, { level: DEFLATE_LEVEL });
}
