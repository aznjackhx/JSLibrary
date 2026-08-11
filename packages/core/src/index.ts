/**
 * Public API.
 *
 * The surface stays deliberately small: `render` plus the option types. Every
 * other module in this package is internal and may change without notice.
 */

import { EmissionContext } from "./emit/emit.js";
import { destination } from "./emit/links.js";
import { buildOutlineTree, collectHeadings, writeOutline } from "./emit/outline.js";
import { paintPagedDocument } from "./emit/pages.js";
import { NotImplementedError, RenderError } from "./errors.js";
import { describeFace, FontError } from "./errors.js";
import type { MeasuredNode } from "./measure/types.js";
import { Font } from "./fonts/font.js";
import { scriptsNeedingShaping, shapingWarning } from "./fonts/shaping.js";
import { FontRegistry, type FontStyle } from "./fonts/resolve.js";
import { measure } from "./measure/index.js";
import {
  resolveOptions,
  type RenderExtensionContext,
  type RenderOptions,
} from "./options.js";
import { parsePageRules } from "./page/atrules.js";
import { pageContextFor, type PageContext } from "./page/context.js";
import { collectStringSetRules } from "./page/string-set.js";
import { PdfDocument } from "./pdf/document.js";
import { PdfDict, textString, type PdfValue } from "./pdf/objects.js";
import { ptToPx } from "./units.js";

export { RenderError, NotImplementedError, FontError } from "./errors.js";
export { resolveOptions } from "./options.js";
export type {
  DocumentMetadata,
  FontInput,
  RenderExtension,
  RenderExtensionContext,
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
/**
 * The PDF object model — unstable, and not part of the supported surface.
 *
 * Exposed as one namespace on the main entry rather than a subpath export so
 * there is exactly one copy of these classes at runtime. `@pkg/pro` builds
 * conformance profiles on them; a second copy from a separately bundled
 * subpath would break every `instanceof` the serialiser performs, which is not
 * a hypothetical — it is what happened when this was a subpath.
 */
export * as pdf from "./pdf/index.js";
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

  // `@page` is invisible to getComputedStyle — no engine applies it outside its
  // own print path — so the document's stylesheets are read directly.
  const pageRules = parsePageRules(element.ownerDocument);

  const contexts = new Map<string, PageContext>();
  const contextFor = (pageIndex: number, blank = false): PageContext => {
    const key = `${pageIndex}:${blank ? "blank" : "content"}`;
    const existing = contexts.get(key);
    if (existing) return existing;

    const built = pageContextFor({
      rules: pageRules,
      pageIndex,
      blank,
      overrides: {
        size: options.pageSize,
        orientation: options.orientation,
        margins: options.margins,
      },
      defaults: {
        // Units matter here: the resolved size is in points, and a bare number
        // is read as CSS pixels, which would shrink every default page by a
        // quarter.
        size: {
          width: `${resolved.page.size.width}pt`,
          height: `${resolved.page.size.height}pt`,
        },
        margins: {
          top: `${resolved.page.margins.top}pt`,
          right: `${resolved.page.margins.right}pt`,
          bottom: `${resolved.page.margins.bottom}pt`,
          left: `${resolved.page.margins.left}pt`,
        },
      },
    });
    contexts.set(key, built);
    return built;
  };

  // Content is laid out once, at the narrowest content width any page offers,
  // so a page with wider margins never has to hold text measured for a wider
  // column. The first three indices cover every combination of :first, :left
  // and :right; a document whose widths vary beyond that is outside what a
  // single measurement pass can serve.
  const measureWidth = Math.min(
    ...[0, 1, 2].map((pageIndex) => contextFor(pageIndex).content.width),
  );

  // `string-set` is invisible to the CSSOM for the same reason `@page` is, so
  // it comes from authored CSS too.
  const stringSetRules = collectStringSetRules(element.ownerDocument);

  const measured = measure(element, {
    width: ptToPx(measureWidth),
    precise: resolved.textMode === "precise",
    stringSetRules,
  });

  // Said once per render, after measurement so it is driven by the text that
  // actually laid out rather than by markup that may be hidden. Rendering
  // continues: a document with one Arabic word in an otherwise Latin report
  // should still produce its PDF, and the caller decides what to do about it.
  const unshaped = scriptsNeedingShaping(textOf(measured.document.root));
  const warning = shapingWarning(unshaped);
  if (warning) console.warn(warning);

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

  const extensionContext = (): RenderExtensionContext => ({
    document: pdf,
    fonts: context.embeddedFonts,
    metadata: resolved.metadata,
  });

  // Before anything is painted: a conformance profile may need to claim
  // catalog entries or reserve objects ahead of the page tree.
  for (const extension of resolved.extensions) {
    extension.prepare?.(extensionContext());
  }

  const paged = paintPagedDocument(pdf, measured.document, context, {
    contextFor,
    stranding: {
      ...(resolved.orphans === undefined ? {} : { orphans: resolved.orphans }),
      ...(resolved.widows === undefined ? {} : { widows: resolved.widows }),
    },
    strings: measured.strings,
    links: resolved.links,
  });

  // Named destinations, so an id is addressable by name — `report.pdf#sec-2`
  // — and not only through the link that happens to point at it.
  //
  // Written as a name *tree* under /Names rather than the older /Dests
  // dictionary: the tree is the form PDF 1.2 onwards prefers, and readers
  // (pdf.js among them) look there first. Entries must be sorted by key, which
  // is what makes a tree searchable.
  if (paged.destinations.size > 0) {
    const names: PdfValue[] = [];
    for (const id of [...paged.destinations.keys()].sort()) {
      names.push(textString(id), paged.destinations.get(id) as PdfValue);
    }

    const tree = pdf.add(new PdfDict([["Names", names]]));
    pdf.catalogExtra.set("Names", pdf.add(new PdfDict([["Dests", tree]])));
  }

  if (resolved.outline) {
    const headings = collectHeadings(measured.document.root);
    const outlineRef = writeOutline(pdf, buildOutlineTree(headings), {
      destinationFor: (heading) => {
        const found = paged.locate(heading.y);
        if (!found) return undefined;

        const transform = paged.transformFor(found.index);
        return destination(found.page, transform.x(heading.x), transform.y(heading.y));
      },
    });
    if (outlineRef) pdf.catalogExtra.set("Outlines", outlineRef);
  }

  context.finish();

  // After painting, so an extension sees the fonts actually embedded and the
  // pages actually produced.
  for (const extension of resolved.extensions) {
    extension.finish?.(extensionContext());
  }

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
    const weight = font.weight ?? 400;
    const style = (font.style ?? "normal") as FontStyle;

    // Parsing is the step that fails on a caller's mistake — the wrong file,
    // a compressed one, a fetch that returned an error page — and the parser
    // knows nothing about which face it was handed.
    let parsed;
    try {
      parsed = Font.parse(font.data);
    } catch (cause) {
      throw new FontError(describeFace(font.family, weight, style), cause);
    }

    registry.register({ family: font.family, weight, style, font: parsed });
  }

  return registry;
}

/** Every character the measured tree will paint, concatenated. */
function textOf(node: MeasuredNode): string {
  if (node.kind === "text") return node.lines.map((line) => line.text).join("");
  return node.children.map((child) => textOf(child)).join("");
}
