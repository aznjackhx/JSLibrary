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

export interface RenderOptions {
  readonly pageSize?: PageSizeInput;
  readonly orientation?: Orientation;
  readonly margins?: MarginsInput;
  readonly textMode?: TextMode;
  readonly metadata?: DocumentMetadata;
}

export interface ResolvedOptions {
  readonly page: PageGeometry;
  readonly textMode: TextMode;
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
    page: pageGeometry(options.pageSize, options.orientation ?? "portrait", options.margins),
    // Precise is the default: correctness first, with `fast` as an opt-in.
    textMode: options.textMode ?? "precise",
    metadata: {
      title: metadata.title,
      author: metadata.author,
      subject: metadata.subject,
      keywords: metadata.keywords ?? [],
      creationDate: metadata.creationDate ?? new Date(),
    },
  };
}
