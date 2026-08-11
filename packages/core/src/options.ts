/**
 * Public option surface and its normalised counterpart.
 *
 * `RenderOptions` is what callers pass; `ResolvedOptions` is what the pipeline
 * consumes — every length in points, every default filled in. Nothing
 * downstream reads `RenderOptions` directly.
 */

import {
  pageGeometry,
  type MarginsInput,
  type Orientation,
  type PageGeometry,
  type PageSizeInput,
} from "./page/geometry.js";

/**
 * How precisely glyphs are positioned.
 *
 * - `precise` reads per-cluster x-positions from `Range.getClientRects()` and
 *   emits explicit adjustments, so the PDF matches the screen glyph for glyph.
 * - `fast` emits one positioned run per line box and lets PDF advance widths
 *   handle intra-line spacing.
 */
export type TextMode = "precise" | "fast";

export interface DocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: readonly string[];
  /**
   * Creation timestamp written to the document info dictionary.
   *
   * Pin this to make output byte-identical across runs; visual regression
   * testing depends on it. Defaults to the current time.
   */
  readonly creationDate?: Date;
}

/**
 * A font file to make available for rendering.
 *
 * Bytes, not a URL: fetching would break the no-network guarantee, and the
 * browser will not hand back the bytes of a font it has already loaded.
 */
export interface FontInput {
  readonly family: string;
  readonly data: Uint8Array;
  /** CSS numeric weight. Defaults to 400. */
  readonly weight?: number;
  /** Defaults to `normal`. */
  readonly style?: "normal" | "italic" | "oblique";
}

export interface RenderOptions {
  readonly pageSize?: PageSizeInput;
  readonly orientation?: Orientation;
  readonly margins?: MarginsInput;
  readonly textMode?: TextMode;
  readonly metadata?: DocumentMetadata;
  /** Font files the content needs. Required: nothing can be drawn without one. */
  readonly fonts?: readonly FontInput[];
  /**
   * Minimum lines left at the foot of a page, overriding the CSS `orphans`
   * property for every block.
   *
   * Firefox implements neither `orphans` nor `widows`, so `getComputedStyle`
   * reports nothing there and the CSS default of 2 is used. Set this where a
   * document needs a different value and must paginate the same way on every
   * engine.
   */
  readonly orphans?: number;
  /** Minimum lines carried onto the next page. See `orphans`. */
  readonly widows?: number;
  /**
   * Emit link annotations for `<a href>` and destinations for in-document
   * anchors. Default true.
   */
  readonly links?: boolean;
  /** Emit a PDF outline (bookmarks) built from heading hierarchy. Default true. */
  readonly outline?: boolean;
  /**
   * Extensions that may inspect and add to the document as it is built.
   *
   * This is the one seam in an otherwise closed API, and it exists for exactly
   * one reason: conformance profiles like PDF/A cannot be applied to finished
   * bytes without a full PDF parser. They have to participate while the object
   * graph is being assembled. `@pkg/pro` is built on this hook; nothing in
   * core uses it.
   */
  readonly extensions?: readonly RenderExtension[];
}

export interface ResolvedOptions {
  readonly page: PageGeometry;
  readonly textMode: TextMode;
  readonly fonts: readonly FontInput[];
  readonly orphans: number | undefined;
  readonly widows: number | undefined;
  readonly links: boolean;
  readonly outline: boolean;
  readonly extensions: readonly RenderExtension[];
  readonly metadata: {
    readonly title: string | undefined;
    readonly author: string | undefined;
    readonly subject: string | undefined;
    readonly keywords: readonly string[];
    readonly creationDate: Date;
  };
}

export function resolveOptions(options: RenderOptions = {}): ResolvedOptions {
  const metadata = options.metadata ?? {};

  return {
    page: pageGeometry(options.pageSize, options.orientation, options.margins),
    // Precise is the default: correctness first, with `fast` as an opt-in.
    textMode: options.textMode ?? "precise",
    fonts: options.fonts ?? [],
    orphans: options.orphans,
    widows: options.widows,
    links: options.links ?? true,
    outline: options.outline ?? true,
    extensions: options.extensions ?? [],
    metadata: {
      title: metadata.title,
      author: metadata.author,
      subject: metadata.subject,
      keywords: metadata.keywords ?? [],
      creationDate: metadata.creationDate ?? new Date(),
    },
  };
}

/**
 * A stage that participates in building the document.
 *
 * Both hooks are optional and both run in the order the extensions were given.
 * An extension that throws stops the render: it asked to shape the output, so
 * failing quietly would produce a file that claims a conformance it does not
 * have.
 */
export interface RenderExtension {
  /** Identifies the extension in errors. */
  readonly name: string;
  /** Runs before any page is painted. */
  readonly prepare?: (context: RenderExtensionContext) => void;
  /** Runs after every page is painted, before the bytes are written. */
  readonly finish?: (context: RenderExtensionContext) => void;
}

/** What an extension is given. */
export interface RenderExtensionContext {
  /** The document being assembled. */
  readonly document: import("./pdf/document.js").PdfDocument;
  /** Fonts embedded so far, so a profile can check or constrain them. */
  readonly fonts: readonly import("./fonts/font.js").Font[];
  /** Metadata the caller supplied, already resolved. */
  readonly metadata: ResolvedOptions["metadata"];
}
