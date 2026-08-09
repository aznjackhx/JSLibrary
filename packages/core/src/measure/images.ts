/**
 * Capturing image pixels during measurement.
 *
 * Emission runs against plain data with no live DOM, so image content has to be
 * taken while the elements still exist. Pixels come from a canvas the browser
 * has already decoded into — no network request is made, which is the point:
 * the image was fetched by the page, not by us.
 *
 * JPEG data URLs are passed through in their original encoding instead. A photo
 * re-encoded as raw pixels is an order of magnitude larger even after Flate, and
 * that difference is the whole file-size budget for a report.
 */

/** Pixels ready to embed, in whichever form keeps the file smallest. */
export type CapturedImage =
  | {
      readonly kind: "rgba";
      readonly width: number;
      readonly height: number;
      /** Row-major RGBA, 8 bits per component. */
      readonly data: Uint8Array;
    }
  | {
      readonly kind: "jpeg";
      readonly width: number;
      readonly height: number;
      /** The original JPEG bytes, embedded without re-encoding. */
      readonly data: Uint8Array;
    };

/** Decode the payload of a `data:` URL. */
export function decodeDataUrl(url: string): { mediaType: string; bytes: Uint8Array } | undefined {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!match) return undefined;

  const mediaType = match[1] ?? "";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";

  try {
    if (!isBase64) {
      const decoded = decodeURIComponent(payload);
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i) & 0xff;
      return { mediaType, bytes };
    }

    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mediaType, bytes };
  } catch {
    return undefined;
  }
}

/**
 * Number of colour components a JPEG uses, read from its frame header.
 *
 * Only three-component (YCbCr) JPEGs are passed through: a greyscale or CMYK
 * file needs a different `/ColorSpace`, and guessing wrong renders the image in
 * false colour rather than failing visibly.
 */
export function jpegComponentCount(bytes: Uint8Array): number | undefined {
  // Walk the marker segments looking for a start-of-frame.
  let offset = 2; // skip SOI

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1] as number;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined; // EOI or scan data

    const length = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);

    // SOF0–SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      // precision(1) height(2) width(2) components(1)
      return bytes[offset + 9];
    }

    offset += 2 + length;
  }

  return undefined;
}

/**
 * Capture an image element's pixels.
 *
 * Returns undefined when there is nothing to capture — an image that failed to
 * load, or one from another origin without CORS, which taints the canvas and
 * makes its pixels unreadable. Neither is fatal: the image is skipped and the
 * rest of the document still renders.
 */
export function captureImage(image: HTMLImageElement): CapturedImage | undefined {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return undefined;

  const source = image.currentSrc || image.src;

  if (source.startsWith("data:")) {
    const decoded = decodeDataUrl(source);
    if (
      decoded &&
      (decoded.mediaType === "image/jpeg" || decoded.mediaType === "image/jpg") &&
      jpegComponentCount(decoded.bytes) === 3
    ) {
      return { kind: "jpeg", width, height, data: decoded.bytes };
    }
  }

  const canvas = image.ownerDocument.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;

  context.drawImage(image, 0, 0, width, height);

  try {
    const pixels = context.getImageData(0, 0, width, height);
    return { kind: "rgba", width, height, data: new Uint8Array(pixels.data.buffer.slice(0)) };
  } catch {
    // Tainted canvas: the image came from another origin without CORS.
    return undefined;
  }
}
