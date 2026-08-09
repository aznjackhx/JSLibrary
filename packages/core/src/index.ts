/**
 * Public API.
 *
 * The surface stays deliberately small: `render` plus the option types. Every
 * other module in this package is internal and may change without notice.
 */

import { EmissionContext, paintDocument } from "./emit/emit.js";
import { NotImplementedError, RenderError } from "./errors.js";
import { Font } from "./fonts/font.js";
import { FontRegistry, type FontStyle } from "./fonts/resolve.js";
import { measure } from "./measure/index.js";
import { resolveOptions, type RenderOptions } from "./options.js";
import { PdfDocument } from "./pdf/document.js";
import { ptToPx } from "./units.js";

export { RenderError, NotImplementedError } from "./errors.js";
export { resolveOptions } from "./options.js";
export type {
  DocumentMetadata,
  FontInput,
  RenderOptions,
  ResolvedOptions,
  TextMode,
} from "./options.js";
export type {
  Margins,
  MarginsInput,
  NamedPageSize,
  Orientation,
  PageGeometry,
  PageSize,
  PageSizeInput,
  Rect,
} from "./page/geometry.js";
export { pageGeometry } from "./page/geometry.js";
export type { Length, Pt } from "./units.js";
export { ptToPx, pxToPt, toPt } from "./units.js";

/**
 * Render a live DOM element to a PDF byte stream.
 *
 * Pipeline: measure into a hidden container sized to the page content box,
 * fragment into page containers and let the browser reflow each, extract final
 * geometry, emit PDF operators.
 *
 * Fonts must be supplied as bytes. The browser will not hand back the bytes of
 * a font it has already loaded, and fetching them ourselves would break the
 * no-network guarantee that makes this library usable offline and behind a
 * corporate firewall.
 */
export async function render(
  element: Element,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new NotImplementedError(
      "Rendering outside a browser (this library uses the browser as its layout engine)",
    );
  }

  const resolved = resolveOptions(options);
  const registry = buildRegistry(resolved.fonts);

  // Measurement reads pixels and intrinsic sizes from the page's own images, so
  // they have to be decoded first. An image that is still loading has no
  // intrinsic size, and a browser lays out its alt text instead — which is how
  // a 120px image measures as 38px of text.
  await decodeImages(element);

  const { content } = resolved.page;

  // The container is sized to the page's content box, so the browser breaks
  // lines exactly where they will fall on the page.
  const measured = measure(element, {
    width: ptToPx(content.width),
    precise: resolved.textMode === "precise",
  });

  const pdf = new PdfDocument({
    info: {
      title: resolved.metadata.title,
      author: resolved.metadata.author,
      subject: resolved.metadata.subject,
      keywords: resolved.metadata.keywords,
      creationDate: resolved.metadata.creationDate,
    },
  });

  const context = new EmissionContext({
    document: pdf,
    registry,
    images: measured.images,
    precise: resolved.textMode === "precise",
  });

  // One page until fragmentation lands in M5. Content taller than the page is
  // painted anyway rather than silently truncated, so the overflow is visible
  // instead of mysterious.
  const page = pdf.addPage({
    width: resolved.page.size.width,
    height: resolved.page.size.height,
  });

  paintDocument(page, measured.document, context, content);
  context.finish();

  return pdf.toBytes();
}

/**
 * Wait for the images inside an element to finish decoding.
 *
 * A broken image rejects rather than resolving; that is not fatal — it is
 * skipped and the rest of the document still renders — so failures are
 * swallowed deliberately.
 */
async function decodeImages(element: Element): Promise<void> {
  const images = [
    ...(element instanceof HTMLImageElement ? [element] : []),
    ...element.querySelectorAll("img"),
  ];

  await Promise.all(
    images.map(async (image) => {
      if (image.complete && image.naturalWidth > 0) return;
      try {
        await image.decode();
      } catch {
        // Broken or cross-origin without CORS: rendered without it.
      }
    }),
  );
}

function buildRegistry(fonts: RenderOptions["fonts"]): FontRegistry {
  const registry = new FontRegistry();

  if (!fonts || fonts.length === 0) {
    throw new RenderError(
      "No fonts supplied. Pass the font files your content uses via options.fonts — " +
        "the browser does not expose the bytes of fonts it has loaded, and this library " +
        "makes no network requests.",
    );
  }

  for (const font of fonts) {
    registry.register({
      family: font.family,
      weight: font.weight ?? 400,
      style: (font.style ?? "normal") as FontStyle,
      font: Font.parse(font.data),
    });
  }

  return registry;
}
