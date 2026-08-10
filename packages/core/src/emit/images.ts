/**
 * Embedding images as PDF XObjects.
 *
 * An image XObject is drawn into the unit square, so placing one is a matter of
 * scaling that square to the box the browser laid out.
 */

import type { CapturedImage } from "../measure/images.js";
import type { ContentStream } from "../pdf/content.js";
import type { PdfDocument } from "../pdf/document.js";
import { dict, name, PdfStream, type PdfRef } from "../pdf/objects.js";
import type { Rect as PageRect } from "../page/geometry.js";

export interface EmbeddedImage {
  readonly ref: PdfRef;
  readonly width: number;
  readonly height: number;
}

/**
 * Split interleaved RGBA into a colour stream and, when any pixel is not fully
 * opaque, a soft mask.
 *
 * PDF keeps transparency in a separate greyscale image rather than interleaved,
 * so the two have to be de-interleaved here.
 */
export function splitRgba(data: Uint8Array, pixelCount: number): {
  rgb: Uint8Array;
  alpha: Uint8Array | undefined;
} {
  const rgb = new Uint8Array(pixelCount * 3);
  const alpha = new Uint8Array(pixelCount);
  let transparent = false;

  for (let i = 0; i < pixelCount; i += 1) {
    const source = i * 4;
    rgb[i * 3] = data[source] as number;
    rgb[i * 3 + 1] = data[source + 1] as number;
    rgb[i * 3 + 2] = data[source + 2] as number;

    const a = data[source + 3] as number;
    alpha[i] = a;
    if (a !== 255) transparent = true;
  }

  return { rgb, alpha: transparent ? alpha : undefined };
}

/** Write an image into the document and return the XObject to reference. */
export function embedImage(document: PdfDocument, image: CapturedImage): EmbeddedImage {
  if (image.kind === "jpeg") {
    // Passed through untouched: the payload is already compressed, and Flate on
    // top of DCT would only add bytes.
    const ref = document.add(
      new PdfStream(
        dict({
          Type: name("XObject"),
          Subtype: name("Image"),
          Width: image.width,
          Height: image.height,
          ColorSpace: name("DeviceRGB"),
          BitsPerComponent: 8,
        }),
        image.data,
        { compress: false, filters: [name("DCTDecode")] },
      ),
    );
    return { ref, width: image.width, height: image.height };
  }

  const { rgb, alpha } = splitRgba(image.data, image.width * image.height);

  let smaskRef: PdfRef | undefined;
  if (alpha) {
    smaskRef = document.add(
      new PdfStream(
        dict({
          Type: name("XObject"),
          Subtype: name("Image"),
          Width: image.width,
          Height: image.height,
          ColorSpace: name("DeviceGray"),
          BitsPerComponent: 8,
        }),
        alpha,
      ),
    );
  }

  const ref = document.add(
    new PdfStream(
      dict({
        Type: name("XObject"),
        Subtype: name("Image"),
        Width: image.width,
        Height: image.height,
        ColorSpace: name("DeviceRGB"),
        BitsPerComponent: 8,
        SMask: smaskRef,
      }),
      rgb,
    ),
  );

  return { ref, width: image.width, height: image.height };
}

/**
 * Draw an embedded image into a rectangle.
 *
 * The unit square maps to the whole box, and the y flip is already accounted
 * for by the rect: PDF images are drawn bottom-up, which is why the height is
 * positive here rather than negative.
 */
export function drawImage(stream: ContentStream, resourceName: string, rect: PageRect): void {
  if (rect.width <= 0 || rect.height <= 0) return;

  stream.scoped((scoped) => {
    scoped.transform(rect.width, 0, 0, rect.height, rect.x, rect.y);
    scoped.drawXObject(resourceName);
  });
}
